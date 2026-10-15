import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../worker.js";

const PLAYERS = {
  "4046": { full_name: "Patrick Mahomes", position: "QB", team: "KC" },
  "4881": {
    full_name: "Lamar Jackson",
    position: "QB",
    team: "BAL",
    injury_status: "Out",
  },
};

const settings = (fpts: number, fpts_decimal: number) => ({
  fpts,
  fpts_decimal,
  fpts_against: 900,
  fpts_against_decimal: 5,
  wins: 3,
  losses: 1,
  ties: 0,
  total_moves: 0,
  waiver_position: 1,
  waiver_budget_used: 0,
});

const ROSTERS = [
  {
    roster_id: 2,
    owner_id: null,
    players: null,
    starters: null,
    league_id: "L1",
    settings: settings(0, 0),
  },
  {
    roster_id: 1,
    owner_id: "u1",
    players: ["4046", "4881", "9999"],
    starters: ["4046", "0"],
    reserve: ["4881"],
    taxi: null,
    league_id: "L1",
    settings: settings(1001, 50),
  },
];

const stubSleeper = ({ playersDown = false } = {}) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/players/nfl")) {
      return playersDown
        ? new Response("", { status: 503 })
        : Response.json(PLAYERS);
    }
    if (url.includes("/league/missing/")) return Response.json(null);
    if (url.endsWith("/league/L1/users")) {
      return Response.json([
        {
          user_id: "u1",
          username: "alice",
          display_name: "Alice",
          metadata: { team_name: "Aces" },
        },
      ]);
    }
    if (url.endsWith("/league/L1/rosters")) return Response.json(ROSTERS);
    return new Response("not stubbed", { status: 404 });
  });

const callTool = async (
  handle: ReturnType<typeof createFetchHandler>,
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
        params: { name: "get_league_teams", arguments: args },
      }),
    }),
  );
  return (await response.json()).result;
};

const ALICE = {
  roster_id: 1,
  owner_name: "Alice",
  team_name: "Aces",
  record: { wins: 3, losses: 1, ties: 0 },
  points_for: 1001.5,
  points_against: 900.05,
  starters: [
    {
      player_id: "4046",
      name: "Patrick Mahomes",
      position: "QB",
      team: "KC",
      injury_status: null,
    },
    null,
  ],
  bench: [
    {
      player_id: "9999",
      name: "9999",
      position: null,
      team: null,
      injury_status: null,
    },
  ],
  reserve: [
    {
      player_id: "4881",
      name: "Lamar Jackson",
      position: "QB",
      team: "BAL",
      injury_status: "Out",
    },
  ],
  taxi: [],
};

describe("get_league_teams", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns every team with named players, by roster_id", async () => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });

    const result = await callTool(handle, { league_id: "L1" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      teams: [
        ALICE,
        {
          roster_id: 2,
          owner_name: "",
          team_name: "",
          record: { wins: 3, losses: 1, ties: 0 },
          points_for: 0,
          points_against: 900.05,
          starters: [],
          bench: [],
          reserve: [],
          taxi: [],
        },
      ],
    });
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent,
    );
  });

  it("returns one team by roster_id, or an error if there's none", async () => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });

    const one = await callTool(handle, { league_id: "L1", roster_id: 1 });
    expect(one.structuredContent).toEqual({ teams: [ALICE] });

    const none = await callTool(handle, { league_id: "L1", roster_id: 7 });
    expect(none.isError).toBe(true);
    expect(none.content[0].text).toContain("League L1 has no roster 7");
  });

  it("falls back to player ids when player data can't load", async () => {
    const handle = createFetchHandler({
      fetchFn: stubSleeper({ playersDown: true }),
    });

    const result = await callTool(handle, { league_id: "L1", roster_id: 1 });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.teams[0].starters[0]).toEqual({
      player_id: "4046",
      name: "4046",
      position: null,
      team: null,
      injury_status: null,
    });
  });

  it("reports an unknown league", async () => {
    const handle = createFetchHandler({ fetchFn: stubSleeper() });

    const result = await callTool(handle, { league_id: "missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Could not find league missing");
  });
});
