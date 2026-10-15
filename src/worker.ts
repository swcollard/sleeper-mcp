import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { createApiClient } from "./api.js";
import { isAuthorized, parseApiKeys, UNAUTHORIZED_BODY } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import {
  buildPlayerDirectory,
  createPlayerCache,
  fetchPlayers,
  PLAYER_DATA_MAX_AGE_MS,
  slimPlayers,
  type Player,
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
   * Optional KV namespace for caching player data across isolates. Without
   * it, each isolate downloads Sleeper's player list on first use.
   */
  PLAYERS_KV?: KVNamespaceLike;
  /**
   * Comma-separated API keys; requests must send one as `x-api-key: <key>`
   * or `Authorization: Bearer <key>`. Set with `wrangler secret put API_KEY`.
   * When unset, the server accepts all requests.
   */
  API_KEY?: string;
  /**
   * League the league tools use when called without a league_id. A client's
   * `?league_id=` query parameter on the MCP URL takes precedence.
   */
  DEFAULT_LEAGUE_ID?: string;
};

// Bump the version whenever the stored shape changes, so new code never reads
// an old copy
const PLAYERS_KV_KEY = "players:v2";
const PLAYERS_KV_TTL_SECONDS = PLAYER_DATA_MAX_AGE_MS / 1000;

type CachedPlayers = {
  /** When the data was downloaded from Sleeper, in ms since the epoch */
  fetched_at: number;
  players: Record<string, Player>;
};

/**
 * Loads players, preferring the KV copy. KV holds a slim copy (see
 * slimPlayers) so later isolates parse much less than the full player list.
 */
async function loadPlayers(
  env: Env,
  fetchFn: typeof fetch,
  now: () => number,
): Promise<PlayerDirectory> {
  // KV is only a cache: on any KV error, fall back to Sleeper
  let cached: CachedPlayers | null | undefined;
  try {
    cached = (await env.PLAYERS_KV?.get(PLAYERS_KV_KEY, "json")) as
      | CachedPlayers
      | null
      | undefined;
  } catch (error) {
    console.error("Error reading player data from KV:", error);
  }
  if (cached) {
    return buildPlayerDirectory(cached.players, cached.fetched_at);
  }

  const players = buildPlayerDirectory(await fetchPlayers(fetchFn), now());
  try {
    // Concurrent isolates may race to write this key; KV rate-limits writes
    // to one per second per key, so a failed put is expected and harmless.
    const value: CachedPlayers = {
      fetched_at: players.fetchedAt,
      players: slimPlayers(players),
    };
    await env.PLAYERS_KV?.put(PLAYERS_KV_KEY, JSON.stringify(value), {
      expirationTtl: PLAYERS_KV_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Error writing player data to KV:", error);
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
 * data) lives as long as the isolate and is shared across requests.
 */
export function createFetchHandler({
  fetchFn = fetch,
  now = Date.now,
}: { fetchFn?: typeof fetch; now?: () => number } = {}) {
  const callApi = createApiClient({ fetchFn });
  const jsonSchemaValidator = new CfWorkerJsonSchemaValidator();
  let getPlayers: (() => Promise<PlayerDirectory>) | undefined;
  let warnedNoApiKey = false;

  return async function handleFetch(
    request: Request,
    env: Env = {},
  ): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
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
      !(await isAuthorized((name) => request.headers.get(name), apiKeys))
    ) {
      return Response.json(UNAUTHORIZED_BODY, {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed.");
    }

    // An isolate serves a single Worker, so env is the same on every request
    getPlayers ??= createPlayerCache(() => loadPlayers(env, fetchFn, now), {
      now,
    });

    // Stateless mode: a fresh server and transport per request
    const server = createMcpServer({
      callApi,
      getPlayers,
      jsonSchemaValidator,
      // Each client can pick its league in the URL it connects to
      defaultLeagueId:
        searchParams.get("league_id") || env.DEFAULT_LEAGUE_ID || undefined,
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
