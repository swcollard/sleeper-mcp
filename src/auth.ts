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

/**
 * Checks an `Authorization: Bearer <key>` header against the allowed keys.
 * Compares fixed-length hashes in constant time, and checks every key, so
 * response timing doesn't reveal how much of a key matched.
 */
export async function isAuthorized(
  authorizationHeader: string | null | undefined,
  apiKeys: readonly string[],
): Promise<boolean> {
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader?.trim() ?? "");
  if (!match?.[1]) return false;

  const provided = await sha256(match[1].trim());
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
  error: { code: -32001, message: "Unauthorized: missing or invalid API key" },
  id: null,
} as const;
