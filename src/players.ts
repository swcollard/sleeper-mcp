export const PLAYER_DATA_URL = "https://api.sleeper.app/v1/players/nfl";

/** A player record from Sleeper's /players/nfl endpoint (fields we use). */
export type Player = {
  full_name?: string;
};

export type PlayerDirectory = {
  idToName: ReadonlyMap<string, string>;
  nameToId: ReadonlyMap<string, string>;
};

/** Builds id <-> name lookups from Sleeper's player data. */
export function buildPlayerDirectory(
  players: Record<string, Player>,
): PlayerDirectory {
  const idToName = new Map<string, string>();
  const nameToId = new Map<string, string>();
  for (const [id, player] of Object.entries(players)) {
    const name = player.full_name;
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
