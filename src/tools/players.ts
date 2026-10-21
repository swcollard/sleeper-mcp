import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchPlayers } from "../playerSearch.js";
import type { PlayerInfo } from "../players.js";
import { jsonResult, type ToolContext } from "./context.js";
import { playerInfoSchema, playerSummarySchema } from "./schemas.js";

/** At most this many players per get_player_details call. */
const MAX_DETAIL_IDS = 100;

// Player ids are numeric strings, or a team abbreviation for a defense ("KC")
const playerIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,16}$/, "player ids must be short and alphanumeric");

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
          playerSummarySchema.extend({ status: playerInfoSchema.shape.status }),
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

      return jsonResult({ players });
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

      return jsonResult(result);
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
        throw new Error(`Could not find player ${name}`);
      }
      return jsonResult({ player_id: id });
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
        throw new Error(`Could not find player with id ${id}`);
      }
      return jsonResult({ player_name: name });
    },
  );
}
