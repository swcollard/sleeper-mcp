import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import { createApiClient } from "./api.js";
import { isAuthorized, parseApiKeys, UNAUTHORIZED_BODY } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import { loadPlayersFromFile } from "./playerFile.js";
import { createPlayerCache } from "./players.js";

//----
// Load Player Data
//----

const PLAYER_DATA_FILE_PATH = process.env.PLAYER_DATA_FILE || "/tmp/nfl.json";

// Refreshed in the background once the data is a day old
const getPlayers = createPlayerCache(() =>
  loadPlayersFromFile(PLAYER_DATA_FILE_PATH),
);
// Load at startup rather than on the first request; on failure, player tools
// retry the load when called
getPlayers().catch((error) =>
  console.error("Error loading player data:", error),
);

const callApi = createApiClient();

const DEFAULT_LEAGUE_ID = process.env.DEFAULT_LEAGUE_ID;

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
  // Each client can pick its league in the URL it connects to
  const leagueParam = req.query.league_id;
  const server = createMcpServer({
    callApi,
    getPlayers,
    defaultLeagueId:
      (typeof leagueParam === "string" && leagueParam) ||
      DEFAULT_LEAGUE_ID ||
      undefined,
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
