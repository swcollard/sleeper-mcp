import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchPlayers } from "../playerSearch.js";
import type { GameStatus } from "../gameStatus.js";
import type { PlayerInfo } from "../players.js";
import { jsonResult, READ_ONLY, type ToolContext } from "./context.js";
import {
  gameStatusSchema,
  playerInfoSchema,
  playerSummarySchema,
  weekSchema,
} from "./schemas.js";

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
      annotations: READ_ONLY,
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
      description: `Fetches details for up to ${MAX_DETAIL_IDS} players by id: position, NFL team, injury status, depth chart, age and experience, plus game_status: whether the player's game this week (or the given week) is a bye, not started, in progress or final, which explains a score of 0. Ids that don't match a player are listed in not_found.`,
      annotations: READ_ONLY,
      inputSchema: {
        player_ids: z.array(playerIdSchema).min(1).max(MAX_DETAIL_IDS),
        week: weekSchema.describe(
          "The week game_status is for. Defaults to the current NFL week.",
        ),
      },
      outputSchema: {
        as_of: z
          .string()
          .describe(
            "When this player data was downloaded from Sleeper (ISO 8601)",
          ),
        week: z
          .number()
          .optional()
          .describe(
            "The week game_status is for; left out when the schedule can't be loaded",
          ),
        players: z.array(
          playerInfoSchema.extend({
            game_status: gameStatusSchema
              .optional()
              .describe(
                "Left out when the schedule can't be loaded or doesn't cover this player",
              ),
          }),
        ),
        not_found: z.array(z.string()),
      },
    },
    async ({ player_ids, week }) => {
      const [directory, games] = await Promise.all([
        ctx.getPlayers(),
        ctx.tryGetGameStatuses(week),
      ]);
      const players: (PlayerInfo & { game_status?: GameStatus })[] = [];
      const not_found: string[] = [];
      for (const id of new Set(player_ids)) {
        const player = directory.byId.get(id);
        if (!player) {
          not_found.push(id);
          continue;
        }
        const game_status = games?.forPlayer(player);
        players.push(game_status ? { ...player, game_status } : player);
      }
      const result = {
        as_of: new Date(directory.fetchedAt).toISOString(),
        ...(games && { week: games.week }),
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
        "Fetches the Sleeper player id for a player's full name. Ignores case, punctuation and suffixes like Jr. If several players share the name, returns the most relevant one (active, then highest ranked).",
      annotations: READ_ONLY,
      inputSchema: {
        name: z
          .string()
          .describe('The player\'s full name, e.g. "Patrick Mahomes"'),
      },
      outputSchema: {
        player_id: z.string(),
      },
    },
    async ({ name }) => {
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
      description: "Fetches a player's full name from their Sleeper player id.",
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().describe("The Sleeper player id"),
      },
      outputSchema: {
        player_name: z.string(),
      },
    },
    async ({ id }) => {
      const name = (await ctx.getPlayers()).idToName.get(id);

      if (!name) {
        throw new Error(`Could not find player with id ${id}`);
      }
      return jsonResult({ player_name: name });
    },
  );
}
