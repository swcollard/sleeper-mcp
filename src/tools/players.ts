import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchPlayers } from "../playerSearch.js";
import type { PlayerInfo } from "../players.js";
import type { ToolContext } from "./context.js";

/** At most this many players per get_player_details call. */
const MAX_DETAIL_IDS = 100;

// Player ids are numeric strings, or a team abbreviation for a defense ("KC")
const playerIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,16}$/, "player ids must be short and alphanumeric");

const playerInfoSchema = z.object({
  player_id: z.string(),
  name: z.string(),
  position: z.string().nullable(),
  fantasy_positions: z
    .array(z.string())
    .describe("Positions the player can fill in fantasy lineups"),
  team: z.string().nullable().describe("NFL team abbreviation; null if none"),
  number: z.number().nullable(),
  status: z
    .string()
    .nullable()
    .describe('e.g. "Active", "Inactive", "Injured Reserve"'),
  injury_status: z
    .string()
    .nullable()
    .describe('e.g. "Questionable", "Out", "IR"; null when healthy'),
  injury_body_part: z.string().nullable(),
  age: z.number().nullable(),
  years_exp: z.number().nullable(),
  depth_chart_position: z.string().nullable(),
  depth_chart_order: z
    .number()
    .nullable()
    .describe("1 for the starter at depth_chart_position"),
  search_rank: z
    .number()
    .nullable()
    .describe("Sleeper's overall ranking, lower is better"),
  active: z.boolean(),
}) satisfies z.ZodType<PlayerInfo>;

export function registerPlayerTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "search_players",
    {
      title: "Search Players",
      description:
        'Searches NFL players and team defenses by name, tolerating partial names ("mahomes", "pat mah") and small typos. Defenses match by team name, nickname or abbreviation ("Chiefs", "KC"). Returns the best matches first; use the player_id with other tools.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(100)
          .describe("The player's name, or part of it"),
        position: z
          .string()
          .max(10)
          .optional()
          .describe('Only players at this position, e.g. "QB", "WR", "DEF"'),
        team: z
          .string()
          .max(10)
          .optional()
          .describe(
            'Only players on this NFL team, e.g. "KC"; "FA" for free agents',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of results, default 10"),
      },
      outputSchema: {
        players: z.array(
          playerInfoSchema.pick({
            player_id: true,
            name: true,
            position: true,
            team: true,
            status: true,
            injury_status: true,
          }),
        ),
      },
    },
    async ({ query, position, team, limit }) => {
      console.log(`search_players for ${query}`);
      const players = searchPlayers(await ctx.getPlayers(), query, {
        position,
        team,
        limit,
      }).map((p) => ({
        player_id: p.player_id,
        name: p.name,
        position: p.position,
        team: p.team,
        status: p.status,
        injury_status: p.injury_status,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ players }, null, 2) }],
        structuredContent: { players },
      };
    },
  );

  server.registerTool(
    "get_player_details",
    {
      title: "Get Player Details",
      description: `Fetches details for up to ${MAX_DETAIL_IDS} players by id: position, NFL team, injury status, depth chart, age and experience. Ids that don't match a player are listed in not_found.`,
      inputSchema: {
        player_ids: z.array(playerIdSchema).min(1).max(MAX_DETAIL_IDS),
      },
      outputSchema: {
        as_of: z
          .string()
          .describe(
            "When this player data was downloaded from Sleeper (ISO 8601)",
          ),
        players: z.array(playerInfoSchema),
        not_found: z.array(z.string()),
      },
    },
    async ({ player_ids }) => {
      const directory = await ctx.getPlayers();
      const players: PlayerInfo[] = [];
      const not_found: string[] = [];
      for (const id of new Set(player_ids)) {
        const player = directory.byId.get(id);
        if (player) players.push(player);
        else not_found.push(id);
      }
      const result = {
        as_of: new Date(directory.fetchedAt).toISOString(),
        players,
        not_found,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_player_id",
    {
      title: "Get Player ID",
      description:
        "Given a players full name, fetches the player id used in sleeper. Ignores case, punctuation and suffixes like Jr. If several players share the name, returns the most relevant one (active, then highest ranked).",
      inputSchema: {
        name: z.string(),
      },
      outputSchema: {
        player_id: z.string(),
      },
    },
    async ({ name }) => {
      console.log(`get_player_id for ${name}`);
      const id = (await ctx.getPlayers()).findByName(name)[0]?.player_id;

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
      description:
        "Given a players ID, fetches their full name used in sleeper",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        player_name: z.string(),
      },
    },
    async ({ id }) => {
      console.log(`get_player_name for ${id}`);
      const name = (await ctx.getPlayers()).idToName.get(id);

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
}
