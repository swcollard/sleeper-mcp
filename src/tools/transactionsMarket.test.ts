// Tests get_league_transactions, get_trending_players and get_free_agents
// end to end, through the Worker's fetch handler (which validates output
// with the cfworker validator)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../worker.js";

const PLAYERS = {
  "4046": {
    full_name: "Patrick Mahomes",
    position: "QB",
    fantasy_positions: ["QB"],
    team: "KC",
    active: true,
    search_rank: 5,
  },
  "6794": {
    full_name: "Justin Jefferson",
    position: "WR",
    fantasy_positions: ["WR"],
    team: "MIN",
    active: true,
    search_rank: 3,
  },
  "9509": {
    full_name: "Bijan Robinson",
    position: "RB",
    fantasy_positions: ["RB"],
    team: "ATL",
    active: true,
    search_rank: 1,
    injury_status: "IR",
  },
  "5555": {
    full_name: "Waiver Wire",
    position: "WR",
    fantasy_positions: ["WR"],
    team: "NYJ",
    active: true,
    search_rank: 40,
    injury_status: "Questionable",
  },
  "7777": {
    full_name: "Free Tight End",
    position: "TE",
    fantasy_positions: ["TE"],
    team: "DAL",
    active: true,
    search_rank: 60,
  },
  "1111": {
    full_name: "Some Kicker",
    position: "K",
    fantasy_positions: ["K"],
    team: "BAL",
    active: true,
    search_rank: 2,
  },
  KC: {
    first_name: "Kansas City",
    last_name: "Chiefs",
    position: "DEF",
    fantasy_positions: ["DEF"],
    team: "KC",
    active: true,
    search_rank: 100,
  },
};

const ROSTERS = [
  { roster_id: 1, owner_id: "u1", players: ["4046"], reserve: ["9509"] },
  { roster_id: 2, owner_id: "u2", players: ["6794"], taxi: null },
];

const TRANSACTIONS = [
  {
    type: "free_agent",
    status: "complete",
    created: Date.UTC(2026, 8, 22),
    roster_ids: [1],
    adds: null,
    drops: { "5555": 1 },
    draft_picks: [],
    waiver_budget: [],
    settings: null,
    metadata: null,
  },
  {
    type: "trade",
    status: "complete",
    created: Date.UTC(2026, 8, 23),
    roster_ids: [1, 2],
    adds: null,
    drops: null,
    draft_picks: [
      {
        season: "2027",
        round: 1,
        roster_id: 2,
        previous_owner_id: 2,
        owner_id: 1,
      },
    ],
    waiver_budget: [{ sender: 1, receiver: 2, amount: 20 }],
    settings: null,
    metadata: null,
  },
  {
    type: "waiver",
    status: "failed",
    created: Date.UTC(2026, 8, 21),
    roster_ids: [2],
    adds: { "5555": 2 },
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    settings: { waiver_bid: 7 },
    metadata: { notes: "This player was claimed by another owner." },
  },
];

const ROUTES: Record<string, unknown> = {
  "/v1/state/nfl": { week: 3 },
  "/v1/players/nfl": PLAYERS,
  "/v1/players/nfl/trending/add": [
    { player_id: "5555", count: 900 },
    { player_id: "6794", count: 500 },
    { player_id: "0000", count: 100 },
  ],
  "/v1/league/L1": {
    league_id: "L1",
    roster_positions: ["QB", "RB", "WR", "FLEX", "DEF", "BN", "IR"],
  },
  "/v1/league/L1/users": [
    { user_id: "u1", display_name: "Alice", metadata: { team_name: "Aces" } },
    { user_id: "u2", display_name: "Bob" },
  ],
  "/v1/league/L1/rosters": ROSTERS,
  "/v1/league/L1/transactions/1": [],
  "/v1/league/L1/transactions/3": TRANSACTIONS,
};

/** A route value that makes Sleeper answer 503. */
const FAIL = Symbol("fail");

const stubSleeper = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const { pathname } = new URL(String(input));
    const routes = { ...ROUTES, ...overrides };
    if (pathname.startsWith("/v1/league/missing")) return Response.json(null);
    if (!(pathname in routes)) {
      return new Response("not stubbed", { status: 404 });
    }
    const value = routes[pathname];
    return value === FAIL
      ? new Response("", { status: 503 })
      : Response.json(value);
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

/** Calls a tool and returns its result, with the fetches it made. */
const callTool = async (
  name: string,
  args: Record<string, unknown>,
  {
    overrides,
    env,
  }: { overrides?: Record<string, unknown>; env?: Record<string, string> } = {},
) => {
  const fetchFn = stubSleeper(overrides);
  const handle = createFetchHandler({ fetchFn });
  const body = await (
    await handle(mcpRequest(1, "tools/call", { name, arguments: args }), env)
  ).json();
  const urls = fetchFn.mock.calls.map(([url]) => String(url));
  return { result: body.result, error: body.error, urls };
};

describe("transaction and market tools", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get_league_transactions", () => {
    it("summarizes the current week's transactions, newest first", async () => {
      const { result, urls } = await callTool("get_league_transactions", {
        league_id: "L1",
      });

      expect(result.isError).toBeUndefined();
      expect(urls).toContain(
        "https://api.sleeper.app/v1/league/L1/transactions/3",
      );
      expect(result.structuredContent).toEqual({
        week: 3,
        transactions: [
          {
            type: "trade",
            status: "complete",
            created: "2026-09-23T00:00:00.000Z",
            teams: [{ team: "Aces" }, { team: "Bob" }],
            draft_picks: [
              {
                season: "2027",
                round: 1,
                original_team: "Bob",
                from_team: "Bob",
                to_team: "Aces",
              },
            ],
            faab: [{ from_team: "Aces", to_team: "Bob", amount: 20 }],
          },
          {
            type: "free_agent",
            status: "complete",
            created: "2026-09-22T00:00:00.000Z",
            teams: [{ team: "Aces", drops: ["Waiver Wire"] }],
          },
          {
            type: "waiver",
            status: "failed",
            created: "2026-09-21T00:00:00.000Z",
            teams: [{ team: "Bob", adds: ["Waiver Wire"] }],
            waiver_bid: 7,
            notes: "This player was claimed by another owner.",
          },
        ],
      });
      expect(JSON.parse(result.content[0].text)).toEqual(
        result.structuredContent,
      );
    });

    it("filters by type and fetches the given week", async () => {
      const { result, urls } = await callTool("get_league_transactions", {
        league_id: "L1",
        week: 3,
        type: "waiver",
      });

      expect(
        result.structuredContent.transactions.map(
          (t: { type: string }) => t.type,
        ),
      ).toEqual(["waiver"]);
      // The week was given, so the NFL state isn't needed
      expect(urls).not.toContain("https://api.sleeper.app/v1/state/nfl");
    });

    it("uses week 1 in the preseason, when Sleeper's week is 0", async () => {
      const { result, urls } = await callTool(
        "get_league_transactions",
        { league_id: "L1" },
        { overrides: { "/v1/state/nfl": { week: 0 } } },
      );

      expect(result.structuredContent).toEqual({ week: 1, transactions: [] });
      expect(urls).toContain(
        "https://api.sleeper.app/v1/league/L1/transactions/1",
      );
    });

    it("falls back to player ids when player data can't load", async () => {
      const { result } = await callTool(
        "get_league_transactions",
        { league_id: "L1", type: "free_agent" },
        { overrides: { "/v1/players/nfl": FAIL } },
      );

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.transactions[0].teams).toEqual([
        { team: "Aces", drops: ["5555"] },
      ]);
    });

    it("rejects weeks and types that could rewrite the request", async () => {
      for (const args of [
        { league_id: "L1", week: 19 },
        { league_id: "L1", week: 0 },
        { league_id: "L1", week: 2.5 },
        { league_id: "L1", type: "../users" },
      ]) {
        const { result, error, urls } = await callTool(
          "get_league_transactions",
          args,
        );
        expect(result?.isError ?? error, JSON.stringify(args)).toBeTruthy();
        expect(urls).toEqual([]);
      }
    });

    it("reports an unknown league", async () => {
      const { result } = await callTool("get_league_transactions", {
        league_id: "missing",
        week: 1,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Could not find league missing");
    });
  });

  describe("get_trending_players", () => {
    it("adds player details and who has them in the league", async () => {
      const { result, urls } = await callTool("get_trending_players", {
        type: "add",
        league_id: "L1",
      });

      expect(result.isError).toBeUndefined();
      expect(urls).toContain(
        "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=25",
      );
      expect(result.structuredContent).toEqual({
        type: "add",
        lookback_hours: 24,
        league_id: "L1",
        players: [
          {
            player_id: "5555",
            name: "Waiver Wire",
            position: "WR",
            team: "NYJ",
            injury_status: "Questionable",
            count: 900,
            rostered_by: null,
          },
          {
            player_id: "6794",
            name: "Justin Jefferson",
            position: "WR",
            team: "MIN",
            injury_status: null,
            count: 500,
            rostered_by: "Bob",
          },
          // Unknown to the player data
          {
            player_id: "0000",
            name: "0000",
            position: null,
            team: null,
            injury_status: null,
            count: 100,
            rostered_by: null,
          },
        ],
      });
    });

    it("leaves out rosters without a league", async () => {
      const { result, urls } = await callTool(
        "get_trending_players",
        { type: "drop", lookback_hours: 168, limit: 100 },
        { overrides: { "/v1/players/nfl/trending/drop": [] } },
      );

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        type: "drop",
        lookback_hours: 168,
        players: [],
      });
      expect(urls).toEqual([
        "https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=168&limit=100",
        "https://api.sleeper.app/v1/players/nfl",
      ]);
    });

    it("checks the default league, but doesn't fail if it can't load", async () => {
      const withDefault = await callTool(
        "get_trending_players",
        { type: "add" },
        { env: { DEFAULT_LEAGUE_ID: "L1" } },
      );
      expect(withDefault.result.structuredContent.league_id).toBe("L1");
      expect(withDefault.result.structuredContent.players[1].rostered_by).toBe(
        "Bob",
      );

      const missing = await callTool(
        "get_trending_players",
        { type: "add" },
        { env: { DEFAULT_LEAGUE_ID: "missing" } },
      );
      expect(missing.result.isError).toBeUndefined();
      expect(missing.result.structuredContent.league_id).toBeUndefined();
      expect(
        missing.result.structuredContent.players[0].rostered_by,
      ).toBeUndefined();
    });

    it("fails for an explicit league that doesn't exist", async () => {
      const { result } = await callTool("get_trending_players", {
        type: "add",
        league_id: "missing",
      });
      expect(result.isError).toBe(true);
    });

    it("rejects inputs out of range", async () => {
      for (const args of [
        { type: "trade" },
        { type: "add", lookback_hours: 0 },
        { type: "add", lookback_hours: 169 },
        { type: "add", limit: 101 },
        { type: "add", limit: 1.5 },
      ]) {
        const { result, error, urls } = await callTool(
          "get_trending_players",
          args,
        );
        expect(result?.isError ?? error, JSON.stringify(args)).toBeTruthy();
        expect(urls).toEqual([]);
      }
    });
  });

  describe("get_free_agents", () => {
    it("lists unrostered players the league can start, best first", async () => {
      const { result } = await callTool("get_free_agents", {
        league_id: "L1",
      });

      expect(result.isError).toBeUndefined();
      // Bijan Robinson is on IR (reserve), and the league starts no kicker
      expect(result.structuredContent).toEqual({
        positions: ["QB", "RB", "WR", "TE", "DEF"],
        players: [
          {
            player_id: "5555",
            name: "Waiver Wire",
            position: "WR",
            team: "NYJ",
            injury_status: "Questionable",
            search_rank: 40,
            may_be_on_waivers: true,
          },
          {
            player_id: "7777",
            name: "Free Tight End",
            position: "TE",
            team: "DAL",
            injury_status: null,
            search_rank: 60,
            may_be_on_waivers: false,
          },
          {
            player_id: "KC",
            name: "Kansas City Chiefs",
            position: "DEF",
            team: "KC",
            injury_status: null,
            search_rank: 100,
            may_be_on_waivers: false,
          },
        ],
      });
    });

    it("filters by position and limits the count", async () => {
      const { result } = await callTool("get_free_agents", {
        league_id: "L1",
        position: "flex",
        limit: 1,
      });

      expect(result.structuredContent.positions).toEqual(["RB", "WR", "TE"]);
      expect(
        result.structuredContent.players.map((p: { name: string }) => p.name),
      ).toEqual(["Waiver Wire"]);
    });

    it("explains a position the league doesn't start", async () => {
      const { result } = await callTool("get_free_agents", {
        league_id: "L1",
        position: "K",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Its positions are QB, RB, WR, TE, DEF",
      );
    });

    it("fails when player data can't load", async () => {
      const { result } = await callTool(
        "get_free_agents",
        { league_id: "L1" },
        { overrides: { "/v1/players/nfl": FAIL } },
      );
      expect(result.isError).toBe(true);
    });

    it("rejects invalid input", async () => {
      for (const args of [
        { league_id: "L1", limit: 0 },
        { league_id: "L1", position: "../x" },
      ]) {
        const { result, error, urls } = await callTool("get_free_agents", args);
        expect(result?.isError ?? error, JSON.stringify(args)).toBeTruthy();
        expect(urls).toEqual([]);
      }
    });
  });
});
