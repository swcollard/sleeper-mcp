import { describe, expect, it } from "vitest";
import { isAuthorized, parseApiKeys } from "./auth.js";

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

describe("isAuthorized", () => {
  const keys = ["secret-1", "secret-2"];

  it("accepts a matching Bearer key, case-insensitive on the scheme", async () => {
    expect(await isAuthorized("Bearer secret-1", keys)).toBe(true);
    expect(await isAuthorized("bearer secret-2", keys)).toBe(true);
    expect(await isAuthorized("  Bearer   secret-1  ", keys)).toBe(true);
  });

  it("rejects missing, malformed and wrong keys", async () => {
    for (const header of [
      undefined,
      null,
      "",
      "Bearer",
      "Bearer ",
      "secret-1",
      "Basic secret-1",
      "Bearer secret-",
      "Bearer secret-1x",
      "Bearer SECRET-1",
    ]) {
      expect(await isAuthorized(header, keys), String(header)).toBe(false);
    }
  });

  it("rejects everything when there are no keys", async () => {
    expect(await isAuthorized("Bearer anything", [])).toBe(false);
  });
});
