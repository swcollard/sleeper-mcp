import { describe, expect, it } from "vitest";
import { isAuthorized, parseApiKeys, type GetHeader } from "./auth.js";

describe("parseApiKeys", () => {
  it("splits comma-separated keys and drops blanks", () => {
    expect(parseApiKeys(" a, b ,,c ")).toEqual(["a", "b", "c"]);
  });

  it("returns no keys when unset or blank", () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys("")).toEqual([]);
    expect(parseApiKeys(" , ")).toEqual([]);
  });
});

// Builds a header lookup from a plain object, like a real request's headers
const headers =
  (values: Record<string, string | undefined>): GetHeader =>
  (name) =>
    values[name];
const bearer = (authorization: string | undefined) =>
  headers({ authorization });

describe("isAuthorized", () => {
  const keys = ["secret-1", "secret-2"];

  it("accepts a matching Bearer key, case-insensitive on the scheme", async () => {
    expect(await isAuthorized(bearer("Bearer secret-1"), keys)).toBe(true);
    expect(await isAuthorized(bearer("bearer secret-2"), keys)).toBe(true);
    expect(await isAuthorized(bearer("  Bearer   secret-1  "), keys)).toBe(
      true,
    );
  });

  it("accepts a matching x-api-key header", async () => {
    expect(await isAuthorized(headers({ "x-api-key": "secret-2" }), keys)).toBe(
      true,
    );
    expect(
      await isAuthorized(headers({ "x-api-key": "  secret-1 " }), keys),
    ).toBe(true);
  });

  it("prefers x-api-key over Authorization when both are sent", async () => {
    // e.g. a client sending its own OAuth token alongside the API key
    expect(
      await isAuthorized(
        headers({ "x-api-key": "secret-1", authorization: "Bearer oauth" }),
        keys,
      ),
    ).toBe(true);
    expect(
      await isAuthorized(
        headers({ "x-api-key": "wrong", authorization: "Bearer secret-1" }),
        keys,
      ),
    ).toBe(false);
  });

  it("rejects missing, malformed and wrong keys", async () => {
    for (const header of [
      undefined,
      "",
      "Bearer",
      "Bearer ",
      "secret-1",
      "Basic secret-1",
      "Bearer secret-",
      "Bearer secret-1x",
      "Bearer SECRET-1",
    ]) {
      expect(await isAuthorized(bearer(header), keys), String(header)).toBe(
        false,
      );
    }
    for (const apiKey of ["", "  ", "secret-", "Bearer secret-1"]) {
      expect(
        await isAuthorized(headers({ "x-api-key": apiKey }), keys),
        apiKey,
      ).toBe(false);
    }
  });

  it("rejects everything when there are no keys", async () => {
    expect(await isAuthorized(bearer("Bearer anything"), [])).toBe(false);
    expect(await isAuthorized(headers({ "x-api-key": "anything" }), [])).toBe(
      false,
    );
  });
});
