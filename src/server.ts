import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import * as fs from "fs";
import { createApiClient } from "./api.js";
import { isAuthorized, parseApiKeys, UNAUTHORIZED_BODY } from "./auth.js";
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

const PLAYER_DATA_FILE_PATH = process.env.PLAYER_DATA_FILE || "/tmp/nfl.json";

async function readCachedPlayers(): Promise<Record<string, Player>> {
  if (fs.existsSync(PLAYER_DATA_FILE_PATH)) {
    return JSON.parse(fs.readFileSync(PLAYER_DATA_FILE_PATH, "utf-8"));
  }
  const data = await fetchPlayers();
  try {
    fs.writeFileSync(PLAYER_DATA_FILE_PATH, JSON.stringify(data), "utf-8");
  } catch (error) {
    // The file is only a cache; keep the data we already fetched
    console.error("Error writing player data file:", error);
  }
  return data;
}

async function loadPlayers(): Promise<PlayerDirectory> {
  try {
    return buildPlayerDirectory(await readCachedPlayers());
  } catch (error) {
    console.error("Error loading player data:", error);
    return buildPlayerDirectory({});
  }
}

const players = await loadPlayers();
const callApi = createApiClient();

//----
// HTTP server
//----

const apiKeys = parseApiKeys(process.env.API_KEY);
if (apiKeys.length === 0) {
  console.warn("API_KEY is not set; accepting unauthenticated requests");
}

const app = express();

// Checked before parsing the body, so unauthenticated requests do no work
app.use("/mcp", async (req, res, next) => {
  if (
    apiKeys.length === 0 ||
    (await isAuthorized(req.get("authorization"), apiKeys))
  ) {
    next();
    return;
  }
  res.status(401).set("WWW-Authenticate", "Bearer").json(UNAUTHORIZED_BODY);
});

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
