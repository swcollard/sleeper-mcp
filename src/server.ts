import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import * as fs from "fs";
import { createApiClient } from "./api.js";
import { createMcpServer } from "./mcp.js";
import {
  buildPlayerDirectory,
  fetchPlayers,
  type Player,
  type PlayerDirectory,
} from "./players.js";

//----
// Load Player Data
//----

const PLAYER_DATA_FILE_PATH = "/tmp/nfl.json";

async function loadPlayers(): Promise<PlayerDirectory> {
  try {
    if (!fs.existsSync(PLAYER_DATA_FILE_PATH)) {
      const data = await fetchPlayers();
      fs.writeFileSync(PLAYER_DATA_FILE_PATH, JSON.stringify(data), "utf-8");
    }
    const rawData = fs.readFileSync(PLAYER_DATA_FILE_PATH, "utf-8");
    const parsedData: Record<string, Player> = JSON.parse(rawData);
    return buildPlayerDirectory(parsedData);
  } catch (error) {
    console.error("Error reading or parsing JSON file:", error);
    return buildPlayerDirectory({});
  }
}

const players = await loadPlayers();
const callApi = createApiClient();

//----
// HTTP server
//----

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Stateless mode: an McpServer can only be connected to one transport at a
  // time, so concurrent requests each need their own server and transport.
  const server = createMcpServer({
    callApi,
    getPlayers: async () => players,
  });
  const transport = new StreamableHTTPServerTransport({
    // Omitting sessionIdGenerator runs the transport in stateless mode
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    // The SDK types `onclose` as optional-or-undefined, which conflicts with
    // `exactOptionalPropertyTypes`; the cast is safe at runtime.
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const port = parseInt(process.env.PORT || "3000");
app
  .listen(port, () => {
    console.log(`Sleeper MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
