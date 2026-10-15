import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlayerDirectory } from "../players.js";
import { buildScoreboard } from "../scoreboard.js";
import type { MatchupEntry, Roster, User } from "../sleeper.js";
import { weekSchema, type ToolContext } from "./context.js";

export function registerScoreboardTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_matchup_scoreboard",
    {
      title:
        "Get current weeks matchups and scores for a Sleeper Fantasy League",
      description:
        "Fetches a list of fantasy football matchups and their scores from the Sleeper API for a given league id. The week is provided by get_nfl_state.",
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
    async ({ week, ...args }) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const [usersResponse, rostersResponse, matchupResponse, players]: [
        User[],
        Roster[],
        MatchupEntry[],
        PlayerDirectory | undefined,
      ] = await Promise.all([
        ctx.callLeagueApi(league_id, "users"),
        ctx.callLeagueApi(league_id, "rosters"),
        ctx.callLeagueApi(league_id, `matchups/${week}`),
        // Player names are a nicety here; fall back to ids if they can't load
        ctx.getPlayers().catch((error) => {
          console.error("Error loading player data:", error);
          return undefined;
        }),
      ]);

      const matchupList = buildScoreboard(
        usersResponse,
        rostersResponse,
        matchupResponse,
        players?.idToName ?? new Map(),
        week,
      );

      // Return the response in the expected tool output format
      return {
        content: [
          {
            type: "text",
            text: `${JSON.stringify({ scoreboard: matchupList }, null, 5)}`,
          },
        ],
        structuredContent: { scoreboard: matchupList },
      };
    },
  );
}
