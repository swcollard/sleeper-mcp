import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";

// lru-cache captures `performance` at import time, which fake timers can't
// reach, so drive its clock from the (faked) Date instead.
const fakeClock = { now: () => Date.now() };

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), init);

describe("createApiClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the parsed JSON body", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ week: 7 }));
    const callApi = createApiClient({ fetchFn });

    expect(await callApi("https://example.test/a")).toEqual({ week: 7 });
    expect(fetchFn).toHaveBeenCalledWith("https://example.test/a");
  });

  it("serves repeat requests for the same URL from cache", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ n: 1 }));
    const callApi = createApiClient({ fetchFn });

    await callApi("https://example.test/a");
    await callApi("https://example.test/a");

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("caches each URL separately", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    const callApi = createApiClient({ fetchFn });

    await callApi("https://example.test/a");
    await callApi("https://example.test/b");

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("refetches once the TTL has expired", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    const callApi = createApiClient({
      fetchFn,
      ttlMs: 30_000,
      perf: fakeClock,
    });

    await callApi("https://example.test/a");
    vi.advanceTimersByTime(29_000);
    await callApi("https://example.test/a");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await callApi("https://example.test/a");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-2xx response and does not cache the failure", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("nope", { status: 404, statusText: "Not Found" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const callApi = createApiClient({ fetchFn });

    await expect(callApi("https://example.test/a")).rejects.toThrow(
      "Failed to fetch data. HTTP status: 404 Not Found",
    );
    expect(await callApi("https://example.test/a")).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
