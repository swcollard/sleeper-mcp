import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "./worker.js";

const PLAYERS = {
  "4046": { full_name: "Patrick Mahomes" },
  KC: { first_name: "Kansas City", last_name: "Chiefs" },
};

const stubSleeper = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/players/nfl")) return Response.json(PLAYERS);
    if (url.includes("/league/missing/")) return Response.json(null);
    if (url.endsWith("/users")) {
      return Response.json([{ user_id: "u1", display_name: "Alice" }]);
    }
    return new Response("not stubbed", { status: 404 });
  });

const mcpRequest = (id: number, method: string, params: unknown = {}) =>
  new Request("https://worker.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

const callTool = (id: number, name: string, args: Record<string, unknown>) =>
  mcpRequest(id, "tools/call", { name, arguments: args });

describe("worker fetch handler", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 off the /mcp path and 405 for non-POST", async () => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });

    expect((await handle(new Request("https://worker.test/"))).status).toBe(
      404,
    );
    expect(
      (await handle(new Request("https://worker.test/mcp"))).status,
    ).toBe(405);
  });

  it("serves concurrent requests, each with its own server", async () => {
    const fetchFn = stubSleeper();
    const handle = createFetchHandler({ fetchFn });

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        handle(callTool(i, "get_player_name", { id: "4046" })),
      ),
    );

    for (const [i, response] of responses.entries()) {
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.id).toBe(i);
      expect(body.result.structuredContent).toEqual({
        player_name: "Patrick Mahomes",
      });
    }
    // Player data is loaded once and shared across requests
    expect(
      fetchFn.mock.calls.filter(([url]) => String(url).endsWith("/players/nfl")),
    ).toHaveLength(1);
  });

  it("validates structured output without the default ajv validator", async () => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });

    const response = await handle(
      callTool(1, "get_league_users", { league_id: "L1" }),
    );
    const body = await response.json();

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toEqual({
      users: [{ user_id: "u1", display_name: "Alice" }],
    });
  });

  it("retries loading player data after a failure", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json(PLAYERS));
    const handle = createFetchHandler({ fetchFn });

    const failed = await (
      await handle(callTool(1, "get_player_id", { name: "Patrick Mahomes" }))
    ).json();
    expect(failed.result.isError).toBe(true);

    const ok = await (
      await handle(callTool(2, "get_player_id", { name: "Patrick Mahomes" }))
    ).json();
    expect(ok.result.structuredContent).toEqual({ player_id: "4046" });
  });

  it("caches player names in KV and reuses them in a new isolate", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => {
        const value = store.get(key);
        return value === undefined ? null : JSON.parse(value);
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    };
    const env = { PLAYERS_KV: kv };

    const first = createFetchHandler({ fetchFn: stubSleeper() });
    await first(callTool(1, "get_player_name", { id: "KC" }), env);
    expect(kv.put).toHaveBeenCalledTimes(1);

    const fetchFn = stubSleeper();
    const second = createFetchHandler({ fetchFn });
    const body = await (
      await second(callTool(2, "get_player_id", { name: "Kansas City Chiefs" }), env)
    ).json();

    expect(body.result.structuredContent).toEqual({ player_id: "KC" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("falls back to Sleeper when KV reads and writes fail", async () => {
    const kv = {
      get: vi.fn().mockRejectedValue(new Error("KV unavailable")),
      put: vi.fn().mockRejectedValue(new Error("429 Too Many Requests")),
    };
    const fetchFn = stubSleeper();
    const handle = createFetchHandler({ fetchFn });

    const body = await (
      await handle(callTool(1, "get_player_name", { id: "4046" }), {
        PLAYERS_KV: kv,
      })
    ).json();

    expect(body.result.structuredContent).toEqual({
      player_name: "Patrick Mahomes",
    });
    expect(kv.put).toHaveBeenCalledTimes(1);

    // The loaded directory is kept, so Sleeper isn't asked again
    await handle(callTool(2, "get_player_name", { id: "KC" }), {
      PLAYERS_KV: kv,
    });
    expect(
      fetchFn.mock.calls.filter(([url]) => String(url).endsWith("/players/nfl")),
    ).toHaveLength(1);
  });

  it("reports an unknown league instead of failing on a null body", async () => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });

    for (const [id, name, args] of [
      [1, "get_league_users", { league_id: "missing" }],
      [2, "get_matchup_scoreboard", { league_id: "missing", week: 1 }],
    ] as const) {
      const body = await (await handle(callTool(id, name, args))).json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain(
        "Could not find league missing",
      );
    }
  });

  it("rejects league ids and weeks that could rewrite the request", async () => {
    const fetchFn = stubSleeper();
    const handle = createFetchHandler({ fetchFn });

    for (const [id, args] of [
      [1, { league_id: "../../state/nfl?x=", week: 1 }],
      [2, { league_id: "L1", week: 1.5 }],
      [3, { league_id: "L1", week: -1 }],
    ] as const) {
      const body = await (
        await handle(callTool(id, "get_league_matchups", args))
      ).json();
      expect(body.result?.isError ?? body.error).toBeTruthy();
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
