import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../worker.js";

const PLAYERS = {
  "4046": {
    full_name: "Patrick Mahomes",
    position: "QB",
    fantasy_positions: ["QB"],
    team: "KC",
    status: "Active",
    injury_status: "Questionable",
    age: 31,
    search_rank: 12,
    active: true,
  },
  "1234": { full_name: "Pat Freiermuth", position: "TE", team: "PIT" },
  KC: { first_name: "Kansas City", last_name: "Chiefs", position: "DEF" },
};

const stubSleeper = () =>
  vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith("/players/nfl")
      ? Response.json(PLAYERS)
      : new Response("not stubbed", { status: 404 }),
  );

const callTool = async (
  handle: ReturnType<typeof createFetchHandler>,
  name: string,
  args: Record<string, unknown>,
) => {
  const response = await handle(
    new Request("https://worker.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  return (await response.json()).result;
};

describe("player tools", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("search_players", () => {
    it("returns compact matches, best first", async () => {
      const handle = createFetchHandler({ fetchFn: stubSleeper() });

      const result = await callTool(handle, "search_players", { query: "pat" });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        players: [
          {
            player_id: "4046",
            name: "Patrick Mahomes",
            position: "QB",
            team: "KC",
            status: "Active",
            injury_status: "Questionable",
          },
          {
            player_id: "1234",
            name: "Pat Freiermuth",
            position: "TE",
            team: "PIT",
            status: null,
            injury_status: null,
          },
        ],
      });
      expect(JSON.parse(result.content[0].text)).toEqual(
        result.structuredContent,
      );
    });

    it("applies filters and limit, and finds defenses", async () => {
      const handle = createFetchHandler({ fetchFn: stubSleeper() });
      const ids = async (args: Record<string, unknown>) =>
        (
          await callTool(handle, "search_players", args)
        ).structuredContent.players.map(
          (p: { player_id: string }) => p.player_id,
        );

      expect(await ids({ query: "pat", position: "te" })).toEqual(["1234"]);
      expect(await ids({ query: "pat", team: "kc" })).toEqual(["4046"]);
      expect(await ids({ query: "pat", limit: 1 })).toEqual(["4046"]);
      expect(await ids({ query: "chiefs" })).toEqual(["KC"]);
      expect(await ids({ query: "mahomse" })).toEqual(["4046"]);
    });

    it("rejects out-of-range limits", async () => {
      const handle = createFetchHandler({ fetchFn: stubSleeper() });

      for (const limit of [0, 51, 2.5]) {
        const result = await callTool(handle, "search_players", {
          query: "pat",
          limit,
        });
        expect(result.isError, String(limit)).toBe(true);
      }
    });
  });

  describe("get_player_details", () => {
    it("returns details for known ids and lists the rest", async () => {
      const handle = createFetchHandler({
        fetchFn: stubSleeper(),
        now: () => Date.UTC(2026, 9, 15, 12),
      });

      const result = await callTool(handle, "get_player_details", {
        player_ids: ["4046", "nope", "KC", "4046"],
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        as_of: "2026-10-15T12:00:00.000Z",
        players: [
          {
            player_id: "4046",
            name: "Patrick Mahomes",
            position: "QB",
            fantasy_positions: ["QB"],
            team: "KC",
            number: null,
            status: "Active",
            injury_status: "Questionable",
            injury_body_part: null,
            age: 31,
            years_exp: null,
            depth_chart_position: null,
            depth_chart_order: null,
            search_rank: 12,
            active: true,
          },
          expect.objectContaining({
            player_id: "KC",
            name: "Kansas City Chiefs",
            position: "DEF",
          }),
        ],
        not_found: ["nope"],
      });
    });

    it("rejects bad ids and more than 100 of them", async () => {
      const handle = createFetchHandler({ fetchFn: stubSleeper() });

      for (const player_ids of [
        [],
        ["../state"],
        ["x".repeat(17)],
        Array.from({ length: 101 }, (_, i) => String(i)),
      ]) {
        const result = await callTool(handle, "get_player_details", {
          player_ids,
        });
        expect(result.isError).toBe(true);
      }
      const ok = await callTool(handle, "get_player_details", {
        player_ids: Array.from({ length: 100 }, (_, i) => String(i)),
      });
      expect(ok.structuredContent.not_found).toHaveLength(100);
    });
  });

  it("keeps get_player_id and get_player_name working", async () => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });

    expect(
      (await callTool(handle, "get_player_id", { name: "patrick mahomes" }))
        .structuredContent,
    ).toEqual({ player_id: "4046" });
    expect(
      (await callTool(handle, "get_player_name", { id: "KC" }))
        .structuredContent,
    ).toEqual({ player_name: "Kansas City Chiefs" });
  });
});
