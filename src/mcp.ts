import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";
import type { PlayerDirectory } from "./players.js";
import { createToolContext } from "./tools/context.js";
import { registerLeagueTools } from "./tools/league.js";
import { registerPlayerTools } from "./tools/players.js";
import { registerScoreboardTools } from "./tools/scoreboard.js";
import { registerStateTools } from "./tools/state.js";
import { registerUserTools } from "./tools/users.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { registerMarketTools } from "./tools/market.js";

export type McpServerDeps = {
  /** Cached JSON GET helper, see createApiClient. */
  callApi: (url: string) => Promise<any>;
  /** Resolves player lookups; may load them lazily. */
  getPlayers: () => Promise<PlayerDirectory>;
  /** League id the league tools use when called without one. */
  defaultLeagueId?: string | undefined;
  /** Override the SDK's default (ajv) validator, which Workers can't run. */
  jsonSchemaValidator?: jsonSchemaValidator;
};

/**
 * Creates an MCP server with all Sleeper tools registered. An McpServer can
 * only be connected to one transport at a time, so stateless HTTP handlers
 * must create one per request; callApi and getPlayers carry the shared state.
 *
 * Each module in ./tools registers one group of tools.
 */
export function createMcpServer({
  callApi,
  getPlayers,
  defaultLeagueId,
  jsonSchemaValidator,
}: McpServerDeps): McpServer {
  const server = new McpServer(
    {
      name: "sleeper-mcp-server",
      version: "1.0.0",
    },
    jsonSchemaValidator ? { jsonSchemaValidator } : {},
  );
  const ctx = createToolContext({ callApi, getPlayers, defaultLeagueId });

  registerStateTools(server, ctx);
  registerPlayerTools(server, ctx);
  registerLeagueTools(server, ctx);
  registerScoreboardTools(server, ctx);
  registerUserTools(server, ctx);
  registerTransactionTools(server, ctx);
  registerMarketTools(server, ctx);

  return server;
}
