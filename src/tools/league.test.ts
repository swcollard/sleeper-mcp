import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../worker.js";

const LEAGUE = {
  league_id: "L1",
  name: "The League",
  season: "2026",
  season_type: "regular",
  status: "pre_draft",
  sport: "nfl",
  total_rosters: 12,
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"],
  scoring_settings: { rec: 1, pass_td: 4, rush_yd: 0.1 },
  settings: {
    playoff_teams: 6,
    playoff_week_start: 15,
    waiver_type: 0,
    waiver_budget: 100,
    trade_deadline: 11,
    // Fields get_league leaves out
    num_teams: 12,
    max_keepers: 1,
  },
  draft_id: "D1",
  previous_league_id: null,
  avatar: null,
};

const stubSleeper = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://api.sleeper.app/v1/league/L1") {
      return Response.json(LEAGUE);
    }
    if (url === "https://api.sleeper.app/v1/league/L2") {
      return Response.json({ ...LEAGUE, league_id: "L2", settings: {} });
    }
    if (url.includes("/league/")) return Response.json(null);
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

describe("get_league", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getLeague = async (
    args: Record<string, unknown>,
    env: Record<string, string> = {},
  ) => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });
    return (await handle(callTool(1, "get_league", args), env)).json();
  };

  it("returns the league's settings", async () => {
    const body = await getLeague({ league_id: "L1" });

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toEqual({
      league_id: "L1",
      name: "The League",
      season: "2026",
      status: "pre_draft",
      total_rosters: 12,
      scoring_type: "ppr",
      roster_positions: LEAGUE.roster_positions,
      scoring_settings: { rec: 1, pass_td: 4, rush_yd: 0.1 },
      playoff_teams: 6,
      playoff_week_start: 15,
      waiver_type: "rolling",
      waiver_budget: 100,
      trade_deadline: 11,
    });
    expect(JSON.parse(body.result.content[0].text)).toEqual(
      body.result.structuredContent,
    );
  });

  it("returns nulls for settings Sleeper leaves out", async () => {
    const body = await getLeague({ league_id: "L2" });

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toMatchObject({
      playoff_teams: null,
      waiver_type: null,
      trade_deadline: null,
    });
  });

  it("uses the default league", async () => {
    const body = await getLeague({}, { DEFAULT_LEAGUE_ID: "L1" });
    expect(body.result.structuredContent.league_id).toBe("L1");
  });

  it("reports an unknown league", async () => {
    const body = await getLeague({ league_id: "missing" });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain(
      "Could not find league missing",
    );
  });

  it("points to find_user_leagues when no league is given", async () => {
    const body = await getLeague({});
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("find_user_leagues");
  });
});
