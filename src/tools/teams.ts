import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlayerDirectory } from "../players.js";
import type { Roster, User } from "../sleeper.js";
import { buildLeagueTeams } from "../teams.js";
import { jsonResult, type ToolContext } from "./context.js";

const teamPlayerSchema = z.object({
  player_id: z.string(),
  name: z.string(),
  position: z.string().nullable(),
  team: z.string().nullable().describe("NFL team abbreviation; null if none"),
  injury_status: z
    .string()
    .nullable()
    .describe('e.g. "Questionable", "Out", "IR"; null when healthy'),
});

export function registerTeamTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_league_teams",
    {
      title: "Get Teams in a Sleeper Fantasy League",
      description:
        "Fetches every team in a Sleeper league, or one team by roster_id: its owner, team name, record, points, and players by name, split into starters, bench, IR (reserve) and taxi squad.",
      inputSchema: {
        league_id: ctx.leagueIdInput,
        roster_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Only return this team. Omit for every team in the league.",
          ),
      },
      outputSchema: {
        teams: z.array(
          z.object({
            roster_id: z.number(),
            owner_name: z
              .string()
              .describe(
                "The owner's display name; empty if the team has no owner",
              ),
            team_name: z
              .string()
              .describe("Empty if the owner hasn't set a team name"),
            record: z.object({
              wins: z.number(),
              losses: z.number(),
              ties: z.number(),
            }),
            points_for: z.number(),
            points_against: z.number(),
            starters: z
              .array(teamPlayerSchema.nullable())
              .describe("In lineup slot order; null for an empty slot"),
            bench: z.array(teamPlayerSchema),
            reserve: z.array(teamPlayerSchema).describe("Players on IR"),
            taxi: z.array(teamPlayerSchema),
          }),
        ),
      },
    },
    async ({ roster_id, ...args }) => {
      const league_id = ctx.resolveLeagueId(args.league_id);
      const [usersResponse, rostersResponse, players]: [
        User[],
        Roster[],
        PlayerDirectory | undefined,
      ] = await Promise.all([
        ctx.callLeagueApi(league_id, "users"),
        ctx.callLeagueApi(league_id, "rosters"),
        ctx.tryGetPlayers(),
      ]);

      const rosters =
        roster_id === undefined
          ? rostersResponse
          : rostersResponse.filter((r) => r.roster_id === roster_id);
      if (!rosters.length && roster_id !== undefined) {
        throw new Error(`League ${league_id} has no roster ${roster_id}`);
      }
      const teams = buildLeagueTeams(
        usersResponse,
        rosters,
        players?.byId ?? new Map(),
      );

      return jsonResult({ teams });
    },
  );
}
