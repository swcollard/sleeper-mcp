import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  droppedPlayerIds,
  findFreeAgents,
  freeAgentPositions,
  rosterIdsByPlayer,
} from "../freeAgents.js";
import type { PlayerDirectory } from "../players.js";
import {
  SLEEPER_API,
  type League,
  type Roster,
  type Transaction,
  type TrendingPlayer,
  type User,
} from "../sleeper.js";
import { defaultWeek, teamNamesByRoster } from "../transactions.js";
import type { ToolContext } from "./context.js";

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("How many players to return, up to 100. Defaults to 25.");

export function registerMarketTools(server: McpServer, ctx: ToolContext) {
  /** Maps each rostered player id in a league to its team's name. */
  const teamsByPlayer = async (league_id: string) => {
    const [users, rosters]: [User[], Roster[]] = await Promise.all([
      ctx.callLeagueApi(league_id, "users"),
      ctx.callLeagueApi(league_id, "rosters"),
    ]);
    const teams = teamNamesByRoster(users, rosters);
    return new Map(
      [...rosterIdsByPlayer(rosters)].map(([player_id, roster_id]) => [
        player_id,
        teams.get(roster_id) ?? `Team ${roster_id}`,
      ]),
    );
  };

  /**
   * The league get_trending_players checks rosters in. An explicit league
   * must load; the default league is a nicety, so without one, or if it
   * fails to load, this returns undefined.
   */
  const rosteredIn = async (league_id: string | undefined) => {
    if (league_id !== undefined) {
      return { league_id, teams: await teamsByPlayer(league_id) };
    }
    let defaultId: string;
    try {
      defaultId = ctx.resolveLeagueId(undefined);
    } catch {
      return undefined;
    }
    try {
      return { league_id: defaultId, teams: await teamsByPlayer(defaultId) };
    } catch (error) {
      console.error("Error loading the default league:", error);
      return undefined;
    }
  };

  server.registerTool(
    "get_trending_players",
    {
      title: "Get Trending Players on Sleeper",
      description:
        "Fetches the players most added or dropped across all Sleeper leagues over the last lookback_hours. If a league is given (or a default league is set), also says which team in that league has each player, or null for free agents.",
      inputSchema: {
        type: z
          .enum(["add", "drop"])
          .describe("Most added or most dropped players"),
        lookback_hours: z
          .number()
          .int()
          .min(1)
          .max(168)
          .optional()
          .describe("How many hours to look back, up to 168. Defaults to 24."),
        limit: limitSchema,
        league_id: ctx.leagueIdInput.describe(
          `${ctx.leagueIdInput.description} Not required here: without a league, rostered_by is left out.`,
        ),
      },
      outputSchema: {
        type: z.enum(["add", "drop"]),
        lookback_hours: z.number(),
        league_id: z
          .string()
          .optional()
          .describe("The league rostered_by refers to; absent without one"),
        players: z.array(
          z.object({
            player_id: z.string(),
            name: z.string(),
            position: z.string().nullable(),
            team: z.string().nullable().describe("NFL team"),
            injury_status: z.string().nullable(),
            count: z
              .number()
              .describe("Number of adds or drops across Sleeper leagues"),
            rostered_by: z
              .string()
              .nullable()
              .optional()
              .describe(
                "The fantasy team that has the player in the league, or null if available. Absent without a league.",
              ),
          }),
        ),
      },
    },
    async ({ type, lookback_hours = 24, limit = 25, ...args }) => {
      const query = new URLSearchParams({
        lookback_hours: String(lookback_hours),
        limit: String(limit),
      });
      const [trending, players, league]: [
        TrendingPlayer[],
        PlayerDirectory | undefined,
        Awaited<ReturnType<typeof rosteredIn>>,
      ] = await Promise.all([
        ctx.callApi(
          `${SLEEPER_API}/players/nfl/trending/${encodeURIComponent(type)}?${query}`,
        ),
        // Player details are a nicety here; fall back to ids if they can't load
        ctx.getPlayers().catch((error) => {
          console.error("Error loading player data:", error);
          return undefined;
        }),
        rosteredIn(args.league_id),
      ]);

      const result = {
        type,
        lookback_hours,
        ...(league && { league_id: league.league_id }),
        players: trending.map(({ player_id, count }) => {
          const p = players?.byId.get(player_id);
          return {
            player_id,
            name: p?.name ?? player_id,
            position: p?.position ?? null,
            team: p?.team ?? null,
            injury_status: p?.injury_status ?? null,
            count,
            ...(league && {
              rostered_by: league.teams.get(player_id) ?? null,
            }),
          };
        }),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_free_agents",
    {
      title: "Get Free Agents in Sleeper Fantasy League",
      description:
        "Lists the best available players in a Sleeper league: active NFL players at positions the league starts who aren't on any roster (including IR and taxi). Ranked by Sleeper's overall player ranking, not a weekly projection. may_be_on_waivers marks players dropped this week, who may still be on waivers rather than free agents; it's approximate.",
      inputSchema: {
        league_id: ctx.leagueIdInput,
        position: z
          .string()
          .regex(/^[A-Za-z_]{1,20}$/, "position must be letters")
          .optional()
          .describe(
            "Only players at this position, e.g. RB, WR, K, DEF, or a flex slot like FLEX or SUPER_FLEX.",
          ),
        limit: limitSchema,
      },
      outputSchema: {
        positions: z
          .array(z.string())
          .describe("The positions searched (the league's, after the filter)"),
        players: z.array(
          z.object({
            player_id: z.string(),
            name: z.string(),
            position: z.string().nullable(),
            team: z.string().nullable().describe("NFL team"),
            injury_status: z.string().nullable(),
            search_rank: z
              .number()
              .nullable()
              .describe(
                "Sleeper's overall ranking, lower is better; null if unranked",
              ),
            may_be_on_waivers: z.boolean(),
          }),
        ),
      },
    },
    async ({ position, limit = 25, ...args }) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const [league, rosters, transactions, players]: [
        League,
        Roster[],
        Transaction[],
        PlayerDirectory,
      ] = await Promise.all([
        ctx.callLeagueApi(league_id),
        ctx.callLeagueApi(league_id, "rosters"),
        ctx
          .getNflState()
          .then((state) =>
            ctx.callLeagueApi(league_id, `transactions/${defaultWeek(state)}`),
          ),
        // Unlike other tools, this can't work without player data
        ctx.getPlayers(),
      ]);

      const positions = freeAgentPositions(league.roster_positions, position);
      if (positions.size === 0) {
        throw new Error(
          `No ${position} can start in this league. Its positions are ${[...freeAgentPositions(league.roster_positions)].join(", ")}.`,
        );
      }
      const result = {
        positions: [...positions],
        players: findFreeAgents(players.byId.values(), {
          roster_positions: league.roster_positions,
          rosters,
          recentlyDropped: droppedPlayerIds(transactions),
          position,
          limit,
        }),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
}
