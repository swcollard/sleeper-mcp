import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import { createApiClient } from "./api.js";
import { isAuthorized, parseApiKeys, UNAUTHORIZED_BODY } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import { loadPlayersFromFile } from "./playerFile.js";
import { createPlayerCache } from "./players.js";

const PLAYER_DATA_FILE_PATH = process.env.PLAYER_DATA_FILE || "/tmp/nfl.json";

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

const apiKeys = parseApiKeys(process.env.API_KEY);
if (apiKeys.length === 0) {
  console.warn("API_KEY is not set; accepting unauthenticated requests");
}

const app = express();

// Checked before parsing the body, so unauthenticated requests do no work
app.use("/mcp", async (req, res, next) => {
  if (
    apiKeys.length === 0 ||
    (await isAuthorized((name) => req.get(name), apiKeys))
  ) {
    next();
    return;
  }
  res.status(401).set("WWW-Authenticate", "Bearer").json(UNAUTHORIZED_BODY);
});

app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Stateless mode: a fresh server and transport per request
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

const port = parseInt(process.env.PORT || "3000", 10);
const httpServer = app
  .listen(port, () => {
    console.log(`Sleeper MCP Server running on http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
