/**
 * Parses the API_KEY setting: one key, or several separated by commas so a
 * new key can be rolled out before the old one is removed. Returns an empty
 * list when unset, which disables the check.
 */
export function parseApiKeys(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

const sha256 = async (value: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

/** Looks up a request header by lowercase name. */
export type GetHeader = (name: string) => string | null | undefined;

/**
 * Returns the API key a request sent: the `x-api-key` header if present,
 * otherwise the token from `Authorization: Bearer <key>`. x-api-key wins so
 * that a client can send it alongside an unrelated Authorization header.
 */
export function getProvidedApiKey(getHeader: GetHeader): string | undefined {
  const apiKey = getHeader("x-api-key")?.trim();
  if (apiKey) return apiKey;
  const authorization = getHeader("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || undefined;
}

/**
 * Checks the request's API key (see getProvidedApiKey) against the allowed
 * keys. Compares fixed-length hashes in constant time, and checks every key,
 * so response timing doesn't reveal how much of a key matched.
 */
export async function isAuthorized(
  getHeader: GetHeader,
  apiKeys: readonly string[],
): Promise<boolean> {
  const providedKey = getProvidedApiKey(getHeader);
  if (!providedKey) return false;

  const provided = await sha256(providedKey);
  let authorized = false;
  for (const key of apiKeys) {
    const expected = await sha256(key);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i]! ^ provided[i]!;
    }
    authorized ||= diff === 0;
  }
  return authorized;
}

export const UNAUTHORIZED_BODY = {
  jsonrpc: "2.0",
  error: {
    code: -32001,
    message:
      "Unauthorized: missing or invalid API key. Send it in an x-api-key header or as Authorization: Bearer <key>.",
  },
  id: null,
} as const;
