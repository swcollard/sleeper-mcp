import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../worker.js";
import { GAME_STATUS_TIMEOUT_MS } from "./context.js";

const NOW = Date.UTC(2026, 10, 15, 18); // Sunday 1pm ET, week 10
const HOUR = 60 * 60 * 1000;

const PLAYERS = {
  "1": {
    full_name: "Patrick Mahomes",
    position: "QB",
    team: "KC",
    status: "Active",
  },
  "2": {
    full_name: "Joe Burrow",
    position: "QB",
    team: "CIN",
    status: "Active",
  },
  "3": {
    full_name: "Jalen Hurts",
    position: "QB",
    team: "PHI",
    status: "Active",
    injury_status: "Out",
  },
  "4": {
    full_name: "Brock Purdy",
    position: "QB",
    team: "SF",
    status: "Active",
  },
  "5": {
    full_name: "Free Agent",
    position: "WR",
    team: null,
    status: "Inactive",
  },
  "6": {
    full_name: "CeeDee Lamb",
    position: "WR",
    team: "DAL",
    status: "Active",
  },
  DAL: {
    first_name: "Dallas",
    last_name: "Cowboys",
    position: "DEF",
    team: "DAL",
  },
};

const SCHEDULE = [
  {
    week: 10,
    home: "KC",
    away: "DEN",
    status: "complete",
    start_time: NOW - 5 * HOUR,
  },
  {
    week: 10,
    home: "PIT",
    away: "CIN",
    status: "in_game",
    start_time: NOW - HOUR,
  },
  {
    week: 10,
    home: "DAL",
    away: "PHI",
    status: "pre_game",
    start_time: NOW + 3 * HOUR,
  },
  {
    week: 9,
    home: "SF",
    away: "SEA",
    status: "complete",
    start_time: NOW - 7 * 24 * HOUR,
  },
];

const SCHEDULE_URL = "https://api.sleeper.com/schedule/nfl/regular/2026";

const stubSleeper = (schedule: () => Response | Promise<Response>) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === SCHEDULE_URL) return schedule();
    if (url.endsWith("/players/nfl")) return Response.json(PLAYERS);
    if (url.endsWith("/v1/state/nfl")) {
      return Response.json({
        week: 10,
        season: "2026",
        season_type: "regular",
      });
    }
    if (url.endsWith("/league/L1/users")) {
      return Response.json([
        { user_id: "u1", username: "a", display_name: "Alice" },
      ]);
    }
    if (url.endsWith("/league/L1/rosters")) {
      return Response.json([{ roster_id: 1, owner_id: "u1", settings: {} }]);
    }
    if (url.endsWith("/league/L1/matchups/10")) {
      return Response.json([
        {
          roster_id: 1,
          matchup_id: 1,
          points: 0,
          starters: ["1", "2", "3", "4", "5", "6", "DAL", "0"],
          players: ["1", "2", "3", "4", "5", "6", "DAL"],
          players_points: { "1": 0, "2": 0, "3": 0 },
        },
      ]);
    }
    return new Response("not stubbed", { status: 404 });
  });

const call = async (
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

const handlerFor = (schedule: () => Response | Promise<Response>) => {
  const fetchFn = stubSleeper(schedule);
  return {
    fetchFn,
    handle: createFetchHandler({ fetchFn, now: () => NOW }),
  };
};

describe("game status in tools", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("get_matchup_scoreboard", () => {
    it("says why each starter has the points they have", async () => {
      const { handle } = handlerFor(() => Response.json(SCHEDULE));

      const result = await call(handle, "get_matchup_scoreboard", {
        league_id: "L1",
      });

      expect(result.isError).toBeUndefined();
      const entry = result.structuredContent.scoreboard[0].entries[0];
      expect(entry.starters_game_status).toEqual({
        "Patrick Mahomes": { status: "final" },
        "Joe Burrow": {
          status: "in_progress",
          kickoff: new Date(NOW - HOUR).toISOString(),
        },
        "Jalen Hurts": {
          status: "out",
          kickoff: new Date(NOW + 3 * HOUR).toISOString(),
        },
        "Brock Purdy": { status: "bye" },
        "Free Agent": { status: "inactive" },
        "CeeDee Lamb": {
          status: "not_started",
          kickoff: new Date(NOW + 3 * HOUR).toISOString(),
        },
        "Dallas Cowboys": {
          status: "not_started",
          kickoff: new Date(NOW + 3 * HOUR).toISOString(),
        },
      });
    });

    it("fetches the schedule once alongside the existing requests", async () => {
      const { handle, fetchFn } = handlerFor(() => Response.json(SCHEDULE));

      await call(handle, "get_matchup_scoreboard", { league_id: "L1" });

      const urls = fetchFn.mock.calls.map(([url]) => String(url));
      expect(urls.filter((url) => url === SCHEDULE_URL)).toHaveLength(1);
    });

    it("still answers, without statuses, when the schedule fails", async () => {
      for (const schedule of [
        () => new Response("nope", { status: 404 }),
        () => Response.json({ message: "moved" }),
        () => Response.json([]),
        () => Response.json(null),
        () => new Response("<html>", { status: 200 }),
      ]) {
        const { handle } = handlerFor(schedule);

        const result = await call(handle, "get_matchup_scoreboard", {
          league_id: "L1",
        });

        expect(result.isError).toBeUndefined();
        const entry = result.structuredContent.scoreboard[0].entries[0];
        expect(entry.starters).toContain("Patrick Mahomes");
        expect(entry).not.toHaveProperty("starters_game_status");
      }
    });

    it("doesn't wait longer than the timeout for a hanging schedule", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { handle } = handlerFor(() => new Promise<Response>(() => {}));

      const pending = call(handle, "get_matchup_scoreboard", {
        league_id: "L1",
      });
      await vi.advanceTimersByTimeAsync(GAME_STATUS_TIMEOUT_MS);
      const result = await pending;

      expect(result.isError).toBeUndefined();
      expect(
        result.structuredContent.scoreboard[0].entries[0],
      ).not.toHaveProperty("starters_game_status");
    });
  });

  describe("get_player_details", () => {
    it("adds game_status and the week it is for", async () => {
      const { handle } = handlerFor(() => Response.json(SCHEDULE));

      const result = await call(handle, "get_player_details", {
        player_ids: ["1", "4", "nope"],
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.week).toBe(10);
      expect(
        result.structuredContent.players.map(
          (p: { name: string; game_status: unknown }) => [
            p.name,
            p.game_status,
          ],
        ),
      ).toEqual([
        ["Patrick Mahomes", { status: "final" }],
        ["Brock Purdy", { status: "bye" }],
      ]);
      expect(result.structuredContent.not_found).toEqual(["nope"]);
    });

    it("judges an earlier week by that week's games", async () => {
      const { handle } = handlerFor(() => Response.json(SCHEDULE));

      const result = await call(handle, "get_player_details", {
        player_ids: ["4", "1"],
        week: 9,
      });

      expect(result.structuredContent.week).toBe(9);
      expect(
        result.structuredContent.players.map(
          (p: { game_status: unknown }) => p.game_status,
        ),
      ).toEqual([{ status: "final" }, { status: "bye" }]);
    });

    it("leaves game_status out for a week the schedule doesn't cover", async () => {
      const { handle } = handlerFor(() => Response.json(SCHEDULE));

      const result = await call(handle, "get_player_details", {
        player_ids: ["1"],
        week: 17,
      });

      expect(result.structuredContent.week).toBe(17);
      expect(result.structuredContent.players[0]).not.toHaveProperty(
        "game_status",
      );
    });

    it("still returns player details when the schedule fails", async () => {
      const { handle } = handlerFor(
        () => new Response("down", { status: 503 }),
      );

      const result = await call(handle, "get_player_details", {
        player_ids: ["1"],
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).not.toHaveProperty("week");
      expect(result.structuredContent.players).toHaveLength(1);
      expect(result.structuredContent.players[0]).not.toHaveProperty(
        "game_status",
      );
    });

    it("rejects a week outside 1-18", async () => {
      const { handle } = handlerFor(() => Response.json(SCHEDULE));

      for (const week of [0, 19]) {
        const result = await call(handle, "get_player_details", {
          player_ids: ["1"],
          week,
        });
        expect(result.isError, String(week)).toBe(true);
      }
    });
  });
});
