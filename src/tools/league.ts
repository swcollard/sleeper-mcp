import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { leagueDetails } from "../leagues.js";
import type { League } from "../sleeper.js";
import { jsonResult, type ToolContext } from "./context.js";
import { leagueIdSchema, leagueSummaryFields, weekSchema } from "./schemas.js";

export function registerLeagueTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_league",
    {
      title: "Get Settings for Sleeper Fantasy League",
      description:
        "Fetches a fantasy football league's settings from the Sleeper API: its name, season, status, lineup slots, scoring, playoff format, waivers and trade deadline.",
      inputSchema: {
        league_id: ctx.leagueIdInput,
      },
      outputSchema: {
        ...leagueSummaryFields,
        roster_positions: z
          .array(z.string())
          .describe(
            'Lineup slots, e.g. ["QB", "RB", "RB", "WR", "FLEX", "BN"]; BN is the bench, IR injured reserve',
          ),
        scoring_settings: z
          .record(z.string(), z.number())
          .describe("Points per stat, e.g. { pass_td: 4, rec: 1 }"),
        playoff_teams: z.number().nullable(),
        playoff_week_start: z
          .number()
          .nullable()
          .describe("The first week of the playoffs"),
        waiver_type: z
          .string()
          .nullable()
          .describe(
            '"rolling", "reverse_standings", "faab" (bidding), or "unknown (N)" for a value Sleeper isn\'t known to use',
          ),
        waiver_budget: z
          .number()
          .nullable()
          .describe("Each team's FAAB budget; only used with faab waivers"),
        trade_deadline: z
          .number()
          .nullable()
          .describe(
            "The last week trades are allowed; a week after the season (like 99) means no deadline",
          ),
      },
    },
    async (args) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const league: League = await ctx.callLeagueApi(league_id);
      const details = leagueDetails(league);

      return jsonResult(details);
    },
  );

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
              fpts_decimal: z.number().optional(),
              fpts_against_decimal: z.number().optional(),
              fpts_against: z.number().optional(),
              fpts: z.number().optional(),
            }),
          }),
        ),
      },
    },
    async (args) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      return jsonResult({
        rosters: await ctx.callLeagueApi(league_id, "rosters"),
      });
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
      return jsonResult({
        users: await ctx.callLeagueApi(league_id, "users"),
      });
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
      return jsonResult({
        rosters: await ctx.callLeagueApi(league_id, `matchups/${week}`),
      });
    },
  );
}
