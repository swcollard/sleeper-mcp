import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./context.js";

export function registerPlayerTools(server: McpServer, ctx: ToolContext) {
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
