import { LRUCache } from "lru-cache";

export type ApiClientOptions = {
  max?: number;
  ttlMs?: number;
  /** Abort a request to Sleeper that takes longer than this. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  /** Clock used for TTL expiry; override in tests. */
  perf?: { now(): number };
};

/**
 * Returns a JSON GET helper that caches successful responses by URL for
 * `ttlMs`, and shares one request between concurrent calls for a URL.
 * Non-2xx responses throw and are never cached.
 */
export function createApiClient({
  max = 1000,
  ttlMs = 30 * 1000,
  timeoutMs = 10 * 1000,
  fetchFn = fetch,
  perf,
}: ApiClientOptions = {}) {
  // Wrapped because lru-cache can't store Sleeper's `null` responses
  const cache = new LRUCache<string, { data: unknown }>({
    max,
    ttl: ttlMs,
    ...(perf && { perf }),
    fetchMethod: async (url, _stale, { signal }) => {
      console.log(`GET ${url}`);
      const response = await fetchFn(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!response.ok) {
        throw new Error(
          `GET ${url} failed: ${response.status} ${response.statusText}`,
        );
      }
      return { data: await response.json() };
    },
  });

  return async function callApi(url: string): Promise<any> {
    return (await cache.fetch(url))?.data;
  };
}
