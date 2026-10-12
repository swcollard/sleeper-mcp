export const PLAYER_DATA_URL = "https://api.sleeper.app/v1/players/nfl";

/** A player record from Sleeper's /players/nfl endpoint (fields we use). */
export type Player = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
};

export type PlayerDirectory = {
  idToName: ReadonlyMap<string, string>;
  nameToId: ReadonlyMap<string, string>;
};

/**
 * Builds id <-> name lookups from Sleeper's player data. Team defenses have
 * no full_name (e.g. id "KC" is first_name "Kansas City", last_name
 * "Chiefs"), so the name falls back to first + last; records with no name at
 * all are skipped.
 */
export function buildPlayerDirectory(
  players: Record<string, Player>,
): PlayerDirectory {
  const idToName = new Map<string, string>();
  const nameToId = new Map<string, string>();
  for (const [id, player] of Object.entries(players)) {
    const name =
      player.full_name ||
      [player.first_name, player.last_name].filter(Boolean).join(" ");
    if (!name) continue;
    idToName.set(id, name);
    nameToId.set(name, id);
  }
  return { idToName, nameToId };
}

/** Fetches Sleeper's full player list (several MB; Sleeper asks for at most one call per day). */
export async function fetchPlayers(
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, Player>> {
  const response = await fetchFn(PLAYER_DATA_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch NFL data: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}
