import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../worker.js";

const SLEEPER = "https://api.sleeper.app/v1";

const league = (league_id: string, rec: number | undefined) => ({
  league_id,
  name: `League ${league_id}`,
  season: "2026",
  season_type: "regular",
  status: "in_season",
  sport: "nfl",
  total_rosters: 10,
  roster_positions: ["QB", "RB", "WR", "BN"],
  scoring_settings: rec === undefined ? { pass_td: 4 } : { rec, pass_td: 4 },
  settings: { waiver_type: 2 },
  draft_id: "D1",
  previous_league_id: null,
  avatar: null,
});

const stubSleeper = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${SLEEPER}/state/nfl`) {
      return Response.json({ season: "2026", league_season: "2027" });
    }
    if (url === `${SLEEPER}/user/alice_1`) {
      return Response.json({
        user_id: "123",
        username: "alice_1",
        display_name: "Alice",
        avatar: null,
      });
    }
    if (url.startsWith(`${SLEEPER}/user/123/leagues/nfl/`)) {
      return Response.json([
        league("L1", 1),
        league("L2", 0.5),
        league("L3", undefined),
        league("L4", 0.25),
      ]);
    }
    if (url.startsWith(`${SLEEPER}/user/`)) return Response.json(null);
    return new Response("not stubbed", { status: 404 });
  });

const callTool = (id: number, name: string, args: Record<string, unknown>) =>
  new Request("https://worker.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

describe("find_user_leagues", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const find = async (args: Record<string, unknown>) => {
    const fetchFn = stubSleeper();
    const handle = createFetchHandler({ fetchFn });
    const body = await (
      await handle(callTool(1, "find_user_leagues", args))
    ).json();
    return { body, urls: fetchFn.mock.calls.map(([url]) => String(url)) };
  };

  it("lists the user's leagues with their scoring type", async () => {
    const { body } = await find({ username: "alice_1", season: "2025" });

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toEqual({
      user: { user_id: "123", username: "alice_1", display_name: "Alice" },
      season: "2025",
      leagues: [
        ["L1", "ppr"],
        ["L2", "half_ppr"],
        ["L3", "standard"],
        ["L4", "custom (0.25 per reception)"],
      ].map(([league_id, scoring_type]) => ({
        league_id,
        name: `League ${league_id}`,
        season: "2026",
        status: "in_season",
        total_rosters: 10,
        scoring_type,
      })),
    });
  });

  it("uses the given season without fetching the NFL state", async () => {
    const { urls } = await find({ username: "alice_1", season: "2025" });

    expect(urls).toEqual([
      `${SLEEPER}/user/alice_1`,
      `${SLEEPER}/user/123/leagues/nfl/2025`,
    ]);
  });

  it("defaults the season to the NFL state's league_season", async () => {
    const { body, urls } = await find({ username: "alice_1" });

    expect(body.result.structuredContent.season).toBe("2027");
    expect(urls).toContain(`${SLEEPER}/state/nfl`);
    expect(urls).toContain(`${SLEEPER}/user/123/leagues/nfl/2027`);
  });

  it("reports an unknown user", async () => {
    const { body, urls } = await find({ username: "nobody", season: "2025" });

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain(
      "Could not find Sleeper user nobody",
    );
    expect(urls.some((url) => url.includes("/leagues/"))).toBe(false);
  });

  it("rejects usernames and seasons that could rewrite the request", async () => {
    for (const args of [
      { username: "../state/nfl" },
      { username: "alice?x=1" },
      { username: "" },
      { username: "a".repeat(41) },
      { username: "alice_1", season: "../../players/nfl" },
      { username: "alice_1", season: "25" },
      { username: "alice_1", season: 2025 },
    ]) {
      const { body, urls } = await find(args);
      expect(
        body.result?.isError ?? body.error,
        JSON.stringify(args),
      ).toBeTruthy();
      expect(urls).toEqual([]);
    }
  });
});
