import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import * as fs from "fs";

// Create an MCP server
const server = new McpServer({
  name: "sleeper-mcp-server",
  version: "1.0.0",
});

interface PlayerData {
  status: string;
  full_name: string;
  team: string;
}

const playerNameToId: Map<string, string> = new Map();
const playerIdToName: Map<string, string> = new Map();

const jsonFilePath = "/tmp/nfl.json";

try {
  const rawData = fs.readFileSync(jsonFilePath, "utf-8");
  const parsedData: Record<string, PlayerData> = JSON.parse(rawData); // Parse and cast to MyData interface

  for (const [key, playerData] of Object.entries(parsedData)) {
    playerNameToId.set(playerData.full_name, key);
    playerIdToName.set(key, playerData.full_name);
  }
} catch (error) {
  console.error("Error reading or parsing JSON file:", error);
}

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
    const response = await fetch(NFL_STATE_URL);

    if (!response.ok) {
      // Handle non-200 responses by throwing an error
      throw new Error(
        `Failed to fetch NFL state. HTTP status: ${response.status} ${response.statusText}`,
      );
    }
    // Parse the JSON response
    const structuredContent = await response.json();
    // Return the response in the expected tool output format
    return {
      content: [
        {
          type: "text",
          text: `${JSON.stringify(structuredContent, null, 2)}`,
        },
      ],
      structuredContent: structuredContent,
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
    const id = playerNameToId.get(name);

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
    const name = playerIdToName.get(id);

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

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000");
app
  .listen(port, () => {
    console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
