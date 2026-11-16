import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlayerDirectory } from "../players.js";
import { buildScoreboard } from "../scoreboard.js";
import type { MatchupEntry, Roster, User } from "../sleeper.js";
import {
  jsonResult,
  READ_ONLY,
  type GameStatusLookup,
  type ToolContext,
} from "./context.js";
import { gameStatusSchema, weekSchema } from "./schemas.js";

export function registerScoreboardTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_matchup_scoreboard",
    {
      title: "Get Matchup Scoreboard for Sleeper Fantasy League",
      description:
        "Fetches a week's fantasy football matchups and their scores in a Sleeper league, with team and player names. Defaults to the current week. A starter with 0 points may be on bye, yet to play or injured, so starters_game_status says which (bye, not_started, in_progress, final, out or inactive, with the kickoff time for games not over); only final means a 0 is a real score. It is left out when the schedule can't be loaded.",
      annotations: READ_ONLY,
      inputSchema: {
        league_id: ctx.leagueIdInput,
        week: weekSchema,
      },
      outputSchema: {
        scoreboard: z.array(
          z.object({
            matchup_id: z
              .number()
              .nullable()
              .describe(
                "Null for the group of rosters with no opponent this week (e.g. eliminated from the playoffs)",
              ),
            week: z.number(),
            entries: z.array(
              z.object({
                user_name: z.string(),
                team_name: z.string(),
                starters: z.array(z.string()),
                players: z.array(z.string()),
                total_points: z.number(),
                players_points: z.record(z.string(), z.number()),
                starters_points: z.record(z.string(), z.number()),
                starters_game_status: z
                  .record(z.string(), gameStatusSchema)
                  .optional()
                  .describe(
                    "Each starter's game status, by player name like starters_points",
                  ),
                matchup_id: z.number().nullable(),
              }),
            ),
          }),
        ),
      },
    },
    async (args) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const week = await ctx.resolveWeek(args.week);
      const [usersResponse, rostersResponse, matchupResponse, players, games]: [
        User[],
        Roster[],
        MatchupEntry[],
        PlayerDirectory | undefined,
        GameStatusLookup | undefined,
      ] = await Promise.all([
        ctx.callLeagueApi(league_id, "users"),
        ctx.callLeagueApi(league_id, "rosters"),
        ctx.callLeagueApi(league_id, `matchups/${week}`),
        ctx.tryGetPlayers(),
        ctx.tryGetGameStatuses(week),
      ]);

      const matchupList = buildScoreboard(
        usersResponse,
        rostersResponse,
        matchupResponse,
        players?.idToName ?? new Map(),
        week,
        players && games
          ? (id) => games.forPlayer(players.byId.get(id))
          : undefined,
      );

      return jsonResult({ scoreboard: matchupList });
    },
  );
}
