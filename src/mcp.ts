import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";
import { z } from "zod";
import type { PlayerDirectory } from "./players.js";
import {
  buildScoreboard,
  type Roster,
  type User,
  type MatchupEntry,
} from "./scoreboard.js";

// Sleeper league ids are numeric strings; restricting the charset keeps model
// input from rewriting the request path (e.g. "../state/nfl").
const leagueIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]+$/, "league_id must be alphanumeric");

const weekSchema = z
  .number()
  .int()
  .min(1)
  .max(18)
  .describe(
    "The week of the league to fetch matchups for. The current week can be fetched from get_nfl_state if the user does not request a specific week.",
  );

export type McpServerDeps = {
  /** Cached JSON GET helper, see createApiClient. */
  callApi: (url: string) => Promise<any>;
  /** Resolves the player id <-> name lookups; may load them lazily. */
  getPlayers: () => Promise<PlayerDirectory>;
  /** Override the SDK's default (ajv) validator, which Workers can't run. */
  jsonSchemaValidator?: jsonSchemaValidator;
};

/**
 * Creates an MCP server with all Sleeper tools registered. An McpServer can
 * only be connected to one transport at a time, so stateless HTTP handlers
 * must create one per request; callApi and getPlayers carry the shared state.
 */
export function createMcpServer({
  callApi,
  getPlayers,
  jsonSchemaValidator,
}: McpServerDeps): McpServer {
  const server = new McpServer(
    {
      name: "sleeper-mcp-server",
      version: "1.0.0",
    },
    jsonSchemaValidator ? { jsonSchemaValidator } : {},
  );

  /**
   * Fetches a league sub-resource. Sleeper answers an unknown league id with
   * 200 and a `null` body, so treat that as not found.
   */
  const callLeagueApi = async (league_id: string, path: string) => {
    const data = await callApi(
      `https://api.sleeper.app/v1/league/${encodeURIComponent(league_id)}/${path}`,
    );
    if (data == null) {
      throw new Error(`Could not find league ${league_id}`);
    }
    return data;
  };

  // Get NFL State
  const NFL_STATE_URL = "https://api.sleeper.app/v1/state/nfl";

  server.registerTool(
    "get_nfl_state",
    {
      title: "Get NFL State",
      description:
        "Fetches the current week, season, and related state information for the NFL from the Sleeper API.",
      inputSchema: {},
      outputSchema: {
        week: z.number(),
        season_type: z.string(),
        season_start_date: z.string(),
        season: z.string(),
        previous_season: z.string(),
        leg: z.number(),
        league_season: z.string(),
        league_create_season: z.string(),
        display_week: z.number(),
        season_has_scores: z.boolean(),
      },
    },
    async () => {
      const stateResponse = await callApi(NFL_STATE_URL);
      // Return the response in the expected tool output format
      return {
        content: [
          {
            type: "text",
            text: `${JSON.stringify(stateResponse, null, 2)}`,
          },
        ],
        structuredContent: stateResponse,
      };
    },
  );

  server.registerTool(
    "get_player_id",
    {
      title: "Get Player ID",
      description:
        "Given a players full name, fetches the player id used in sleeper",
      inputSchema: {
        name: z.string(),
      },
      outputSchema: {
        player_id: z.string(),
      },
    },
    async ({ name }) => {
      console.log(`get_player_id for ${name}`);
      const id = (await getPlayers()).nameToId.get(name);

      if (!id) {
        // Handle not found error
        throw new Error(`Could not find player ${name}`);
      }
      // Return the response in the expected tool output format
      return {
        content: [
          {
            type: "text",
            text: id,
          },
        ],
        structuredContent: {
          player_id: id,
        },
      };
    },
  );

  server.registerTool(
    "get_player_name",
    {
      title: "Get Player Name",
      description: "Given a players ID, fetches their full name used in sleeper",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        player_name: z.string(),
      },
    },
    async ({ id }) => {
      console.log(`get_player_name for ${id}`);
      const name = (await getPlayers()).idToName.get(id);

      if (!name) {
        // Handle not found error
        throw new Error(`Could not find player with id ${id}`);
      }
      // Return the response in the expected tool output format
      return {
        content: [
          {
            type: "text",
            text: name,
          },
        ],
        structuredContent: {
          player_name: name,
        },
      };
    },
  );

  server.registerTool(
    "get_league_rosters",
    {
      title: "Get Rosters for Sleeper Fantasy League",
      description:
        "Fetches a list of fantasy football rosters from the Sleeper API for a given league id. Ask the user for their league id.",
      inputSchema: {
        league_id: leagueIdSchema,
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
    async ({ league_id }) => {
      const rostersResponse = await callLeagueApi(league_id, "rosters");

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
        "Fetches a list of fantasy football users from the Sleeper API for a given league id, this provides metatdata to be combined with the get_league_rosters tool to get a full picture of the existing league. Ask the user for their league id.",
      inputSchema: {
        league_id: leagueIdSchema,
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
    async ({ league_id }) => {
      const usersResponse = await callLeagueApi(league_id, "users");

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
        "Fetches a list of fantasy football matchups from the Sleeper API for a given league id. Rosters with the same matchup_id are going head to head. Ask the user for their league id. The week is provided by get_nfl_state.",
      inputSchema: {
        league_id: leagueIdSchema,
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
    async ({ league_id, week }) => {
      const matchupResponse = await callLeagueApi(league_id, `matchups/${week}`);

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

  //---------
  // Rich tools
  //---------
  server.registerTool(
    "get_matchup_scoreboard",
    {
      title: "Get current weeks matchups and scores for a Sleeper Fantasy League",
      description:
        "Fetches a list of fantasy football matchups and their scores from the Sleeper API for a given league id. Ask the user for their league id. The week is provided by get_nfl_state.",
      inputSchema: {
        league_id: leagueIdSchema,
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
    async ({ league_id, week }) => {
      const [usersResponse, rostersResponse, matchupResponse, players]: [
        User[],
        Roster[],
        MatchupEntry[],
        PlayerDirectory | undefined,
      ] = await Promise.all([
        callLeagueApi(league_id, "users"),
        callLeagueApi(league_id, "rosters"),
        callLeagueApi(league_id, `matchups/${week}`),
        // Player names are a nicety here; fall back to ids if they can't load
        getPlayers().catch((error) => {
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

  return server;
}
