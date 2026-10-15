import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { createApiClient } from "./api.js";
import { isAuthorized, parseApiKeys, UNAUTHORIZED_BODY } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import {
  buildPlayerDirectory,
  fetchPlayers,
  type PlayerDirectory,
} from "./players.js";

/** The subset of Cloudflare's KVNamespace this worker uses. */
type KVNamespaceLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
};

export type Env = {
  /**
   * Optional KV namespace for caching player names across isolates. Without
   * it, each isolate downloads Sleeper's player list on first use.
   */
  PLAYERS_KV?: KVNamespaceLike;
  /**
   * Comma-separated API keys; requests must send one as
   * `Authorization: Bearer <key>`. Set with `wrangler secret put API_KEY`.
   * When unset, the server accepts all requests.
   */
  API_KEY?: string;
};

const PLAYERS_KV_KEY = "players:id-to-name";
const PLAYERS_KV_TTL_SECONDS = 24 * 60 * 60;

/**
 * Loads player names, preferring the KV copy. Only id -> name is stored in KV
 * so later isolates parse a few hundred KB instead of the full player list.
 */
async function loadPlayers(
  env: Env,
  fetchFn: typeof fetch,
): Promise<PlayerDirectory> {
  // KV is only a cache: on any KV error, fall back to Sleeper
  let cached: Record<string, string> | null | undefined;
  try {
    cached = (await env.PLAYERS_KV?.get(PLAYERS_KV_KEY, "json")) as
      | Record<string, string>
      | null
      | undefined;
  } catch (error) {
    console.error("Error reading player names from KV:", error);
  }
  if (cached) {
    return buildPlayerDirectory(
      Object.fromEntries(
        Object.entries(cached).map(([id, full_name]) => [id, { full_name }]),
      ),
    );
  }

  const players = buildPlayerDirectory(await fetchPlayers(fetchFn));
  try {
    // Concurrent isolates may race to write this key; KV rate-limits writes
    // to one per second per key, so a failed put is expected and harmless.
    await env.PLAYERS_KV?.put(
      PLAYERS_KV_KEY,
      JSON.stringify(Object.fromEntries(players.idToName)),
      { expirationTtl: PLAYERS_KV_TTL_SECONDS },
    );
  } catch (error) {
    console.error("Error writing player names to KV:", error);
  }
  return players;
}

const jsonRpcError = (status: number, code: number, message: string) =>
  Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status },
  );

/**
 * Creates the Worker's fetch handler. Module-level state (API cache, player
 * names) lives as long as the isolate and is shared across requests.
 */
export function createFetchHandler({
  fetchFn = fetch,
}: { fetchFn?: typeof fetch } = {}) {
  const callApi = createApiClient({ fetchFn });
  const jsonSchemaValidator = new CfWorkerJsonSchemaValidator();
  let playersPromise: Promise<PlayerDirectory> | undefined;
  let warnedNoApiKey = false;

  return async function handleFetch(
    request: Request,
    env: Env = {},
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    const apiKeys = parseApiKeys(env.API_KEY);
    if (apiKeys.length === 0) {
      if (!warnedNoApiKey) {
        console.warn("API_KEY is not set; accepting unauthenticated requests");
        warnedNoApiKey = true;
      }
    } else if (
      !(await isAuthorized(request.headers.get("authorization"), apiKeys))
    ) {
      return Response.json(UNAUTHORIZED_BODY, {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed.");
    }

    const getPlayers = () => {
      playersPromise ??= loadPlayers(env, fetchFn).catch((error) => {
        // Let the next call retry rather than caching the failure
        playersPromise = undefined;
        throw error;
      });
      return playersPromise;
    };

    // Stateless mode: a fresh server and transport per request
    const server = createMcpServer({
      callApi,
      getPlayers,
      jsonSchemaValidator,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    try {
      // See server.ts for why the cast is needed
      await server.connect(transport as Transport);
      return await transport.handleRequest(request);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      return jsonRpcError(500, -32603, "Internal server error");
    }
  };
}

const handleFetch = createFetchHandler();

export default {
  fetch: (request: Request, env: Env) => handleFetch(request, env),
};
