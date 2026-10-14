import { LRUCache } from "lru-cache";

interface CacheEntry {
  data: any;
  timestamp: number;
}

export type ApiClientOptions = {
  max?: number;
  ttlMs?: number;
  fetchFn?: typeof fetch;
  /** Clock used for TTL expiry; override in tests. */
  perf?: { now(): number };
};

/**
 * Returns a JSON GET helper that caches successful responses by URL for
 * `ttlMs`. Non-2xx responses throw and are never cached.
 */
export function createApiClient({
  max = 1000,
  ttlMs = 30 * 1000,
  fetchFn = fetch,
  perf,
}: ApiClientOptions = {}) {
  const cache = new LRUCache<string, CacheEntry>({
    max,
    ttl: ttlMs,
    ...(perf && { perf }),
  });

  return async function callApi(url: string) {
    const cached = cache.get(url);
    if (cached) {
      console.log(`CACHED ${url}`);
      return cached.data;
    }
    console.log(`GET ${url}`);
    const response = await fetchFn(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch data. HTTP status: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();

    cache.set(url, { data, timestamp: Date.now() });

    return data;
  };
}
