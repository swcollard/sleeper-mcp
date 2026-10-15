import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./context.js";

export function registerStateTools(server: McpServer, ctx: ToolContext) {
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
      const stateResponse = await ctx.getNflState();
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
}
