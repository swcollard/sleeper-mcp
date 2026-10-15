import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { leagueIdSchema, weekSchema, type ToolContext } from "./context.js";

export function registerLeagueTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_league_rosters",
    {
      title: "Get Rosters for Sleeper Fantasy League",
      description:
        "Fetches a list of fantasy football rosters from the Sleeper API for a given league id.",
      inputSchema: {
        league_id: ctx.leagueIdInput,
      },
      outputSchema: {
        rosters: z.array(
          z.object({
            roster_id: z.number(),
            starters: z
              .array(z.string())
              .nullable()
              .describe(
                "Null before the draft. The list of player ids in the starting lineup. Can use get_player_name tool to swap with names",
              ),
            players: z
              .array(z.string())
              .nullable()
              .describe(
                "Null before the draft. The list of player ids in the roster. Can use get_player_name tool to swap with names. Any ID in players but not starters is assumed to be on the bench.",
              ),
            owner_id: z
              .string()
              .nullable()
              .describe("Null if the team has no owner (orphaned)"),
            league_id: leagueIdSchema,
            settings: z.object({
              wins: z.number(),
              waiver_position: z.number(),
              waiver_budget_used: z.number(),
              total_moves: z.number(),
              ties: z.number(),
              losses: z.number(),
              fpts_decimal: z.number(),
              fpts_against_decimal: z.number(),
              fpts_against: z.number(),
              fpts: z.number(),
            }),
          }),
        ),
      },
    },
    async (args) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const rostersResponse = await ctx.callLeagueApi(league_id, "rosters");

      return {
        content: [
          {
            type: "text",
            text: `${JSON.stringify({ rosters: rostersResponse }, null, 3)}`,
          },
        ],
        structuredContent: { rosters: rostersResponse },
      };
    },
  );

  server.registerTool(
    "get_league_users",
    {
      title: "Get Users for Sleeper Fantasy League",
      description:
        "Fetches a list of fantasy football users from the Sleeper API for a given league id, this provides metatdata to be combined with the get_league_rosters tool to get a full picture of the existing league.",
      inputSchema: {
        league_id: ctx.leagueIdInput,
      },
      outputSchema: {
        users: z.array(
          z.object({
            user_id: z.string(),
            display_name: z.string(),
            metadata: z
              .object({
                team_name: z.string().optional(),
              })
              .optional()
              .describe("Absent, or without team_name, if no team name is set"),
          }),
        ),
      },
    },
    async (args) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const usersResponse = await ctx.callLeagueApi(league_id, "users");

      return {
        content: [
          {
            type: "text",
            text: `${JSON.stringify({ users: usersResponse }, null, 3)}`,
          },
        ],
        structuredContent: { users: usersResponse },
      };
    },
  );

  server.registerTool(
    "get_league_matchups",
    {
      title: "Get Matchups for Sleeper Fantasy League",
      description:
        "Fetches a list of fantasy football matchups from the Sleeper API for a given league id. Rosters with the same matchup_id are going head to head. The week is provided by get_nfl_state.",
      inputSchema: {
        league_id: ctx.leagueIdInput,
        week: weekSchema,
      },
      outputSchema: {
        rosters: z.array(
          z.object({
            roster_id: z.number(),
            starters: z
              .array(z.string())
              .nullable()
              .describe(
                "Null before the draft. The list of player ids in the starting lineup. Can use get_player_name tool to swap with names",
              ),
            players: z
              .array(z.string())
              .nullable()
              .describe(
                "Null before the draft. The list of player ids in the roster. Can use get_player_name tool to swap with names. Any ID in players but not starters is assumed to be on the bench.",
              ),
            matchup_id: z
              .number()
              .nullable()
              .describe(
                "Null if the roster has no opponent this week (e.g. eliminated from the playoffs)",
              ),
            points: z.number(),
            players_points: z
              .record(z.string(), z.number())
              .describe("A map of Player ID to their current number of points"),
          }),
        ),
      },
    },
    async ({ week, ...args }) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const matchupResponse = await ctx.callLeagueApi(
        league_id,
        `matchups/${week}`,
      );

      return {
        content: [
          {
            type: "text",
            text: `${JSON.stringify({ rosters: matchupResponse }, null, 3)}`,
          },
        ],
        structuredContent: { rosters: matchupResponse },
      };
    },
  );
}
