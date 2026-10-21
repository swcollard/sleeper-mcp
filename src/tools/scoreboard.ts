import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlayerDirectory } from "../players.js";
import { buildScoreboard } from "../scoreboard.js";
import type { MatchupEntry, Roster, User } from "../sleeper.js";
import { jsonResult, READ_ONLY, type ToolContext } from "./context.js";
import { weekSchema } from "./schemas.js";

export function registerScoreboardTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_matchup_scoreboard",
    {
      title: "Get Matchup Scoreboard for Sleeper Fantasy League",
      description:
        "Fetches a week's fantasy football matchups and their scores in a Sleeper league, with team and player names. Defaults to the current week.",
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
      const [usersResponse, rostersResponse, matchupResponse, players]: [
        User[],
        Roster[],
        MatchupEntry[],
        PlayerDirectory | undefined,
      ] = await Promise.all([
        ctx.callLeagueApi(league_id, "users"),
        ctx.callLeagueApi(league_id, "rosters"),
        ctx.callLeagueApi(league_id, `matchups/${week}`),
        ctx.tryGetPlayers(),
      ]);

      const matchupList = buildScoreboard(
        usersResponse,
        rostersResponse,
        matchupResponse,
        players?.idToName ?? new Map(),
        week,
      );

      return jsonResult({ scoreboard: matchupList });
    },
  );
}
