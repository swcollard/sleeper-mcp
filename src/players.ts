export const PLAYER_DATA_URL = "https://api.sleeper.app/v1/players/nfl";

/** Sleeper asks for at most one call per day to /players/nfl. */
export const PLAYER_DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A player record from Sleeper's /players/nfl endpoint (fields we use). The
 * slim copies we cache (see slimPlayers) have the same shape, so both load
 * through buildPlayerDirectory.
 */
export type Player = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  number?: number | null;
  /** e.g. "Active", "Inactive", "Injured Reserve" */
  status?: string | null;
  /** e.g. "Questionable", "Out", "IR"; null when healthy */
  injury_status?: string | null;
  injury_body_part?: string | null;
  age?: number | null;
  years_exp?: number | null;
  depth_chart_position?: string | null;
  depth_chart_order?: number | null;
  /** Sleeper's overall ranking, lower is better; 9999999 when unranked */
  search_rank?: number | null;
  active?: boolean | null;
};

/** A player as the tools see it: always named, with nulls for missing fields. */
export type PlayerInfo = {
  player_id: string;
  name: string;
  position: string | null;
  fantasy_positions: string[];
  team: string | null;
  number: number | null;
  status: string | null;
  injury_status: string | null;
  injury_body_part: string | null;
  age: number | null;
  years_exp: number | null;
  depth_chart_position: string | null;
  depth_chart_order: number | null;
  search_rank: number | null;
  active: boolean;
};

export type PlayerDirectory = {
  byId: ReadonlyMap<string, PlayerInfo>;
  idToName: ReadonlyMap<string, string>;
  /**
   * Players whose name matches, ignoring case, punctuation and suffixes like
   * "Jr." (see nameKey). Several players can share a name, so this returns
   * all of them, best first (see compareRelevance). Empty when none match.
   */
  findByName(name: string): readonly PlayerInfo[];
  /** When Sleeper's data was downloaded, in ms since the epoch. */
  fetchedAt: number;
};

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Lowercases a name and strips accents, punctuation and generational
 * suffixes, leaving space-separated words: "Amon-Ra St. Brown" becomes
 * "amon ra st brown", "Marvin Harrison Jr." becomes "marvin harrison".
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !NAME_SUFFIXES.has(word))
    .join(" ");
}

/**
 * The key findByName matches on: normalizeName without spaces, so "A.J.
 * Brown", "AJ Brown" and "A. J. Brown" all match.
 */
export function nameKey(name: string): string {
  return normalizeName(name).replaceAll(" ", "");
}

/**
 * Orders players most relevant first: active before inactive, then by
 * Sleeper's search_rank (unranked last). Use it to break ties between
 * players with the same name or equally good search matches.
 */
export function compareRelevance(a: PlayerInfo, b: PlayerInfo): number {
  return (
    Number(b.active) - Number(a.active) ||
    (a.search_rank ?? Infinity) - (b.search_rank ?? Infinity)
  );
}

/**
 * Team defenses have no full_name (e.g. id "KC" is first_name "Kansas City",
 * last_name "Chiefs"), so the name falls back to first + last.
 */
function playerName(player: Player): string {
  return (
    player.full_name ||
    [player.first_name, player.last_name].filter(Boolean).join(" ")
  );
}

function toPlayerInfo(player_id: string, name: string, p: Player): PlayerInfo {
  return {
    player_id,
    name,
    position: p.position ?? null,
    fantasy_positions: p.fantasy_positions ?? [],
    team: p.team ?? null,
    number: p.number ?? null,
    status: p.status ?? null,
    injury_status: p.injury_status ?? null,
    injury_body_part: p.injury_body_part ?? null,
    age: p.age ?? null,
    years_exp: p.years_exp ?? null,
    depth_chart_position: p.depth_chart_position ?? null,
    depth_chart_order: p.depth_chart_order ?? null,
    search_rank: p.search_rank ?? null,
    active: p.active ?? false,
  };
}

/**
 * Builds player lookups from Sleeper's player data, or a slim copy of it.
 * Records with no name at all are skipped.
 */
export function buildPlayerDirectory(
  players: Record<string, Player>,
  fetchedAt: number,
): PlayerDirectory {
  const byId = new Map<string, PlayerInfo>();
  const idToName = new Map<string, string>();
  const byNameKey = new Map<string, PlayerInfo[]>();
  for (const [id, player] of Object.entries(players)) {
    const name = playerName(player);
    if (!name) continue;
    const info = toPlayerInfo(id, name, player);
    byId.set(id, info);
    idToName.set(id, name);

    const key = nameKey(name);
    const sameName = byNameKey.get(key);
    if (sameName) sameName.push(info);
    else byNameKey.set(key, [info]);
  }
  for (const sameName of byNameKey.values()) {
    sameName.sort(compareRelevance);
  }
  return {
    byId,
    idToName,
    findByName: (name) => byNameKey.get(nameKey(name)) ?? [],
    fetchedAt,
  };
}

/**
 * Reduces Sleeper's player list to the fields in Player, dropping nameless
 * records and empty fields, for caching. The name is stored as full_name.
 */
export function slimPlayers(
  directory: PlayerDirectory,
): Record<string, Player> {
  const slim: Record<string, Player> = {};
  for (const [id, info] of directory.byId) {
    // player_id is the record's key, so it isn't stored again
    const { player_id, name, fantasy_positions, ...rest } = info;
    const player: Player = { full_name: name };
    if (fantasy_positions.length) player.fantasy_positions = fantasy_positions;
    for (const [field, value] of Object.entries(rest)) {
      if (value !== null && value !== false) {
        (player as Record<string, unknown>)[field] = value;
      }
    }
    slim[id] = player;
  }
  return slim;
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

export type PlayerCacheOptions = {
  /** Reload once the loaded data is older than this. */
  maxAgeMs?: number;
  /** After a reload, wait this long before trying again if data is still stale. */
  retryAfterMs?: number;
  now?: () => number;
};

/**
 * Wraps a player loader so it runs once and its result is shared. Until the
 * first load succeeds, every call retries it. After that, calls return the
 * loaded data immediately, and once it is older than maxAgeMs a reload runs
 * in the background, at most once per retryAfterMs (so a stale fallback from
 * load, like an old file when Sleeper is down, doesn't retry every call).
 */
export function createPlayerCache(
  load: () => Promise<PlayerDirectory>,
  {
    maxAgeMs = PLAYER_DATA_MAX_AGE_MS,
    retryAfterMs = 15 * 60 * 1000,
    now = Date.now,
  }: PlayerCacheOptions = {},
): () => Promise<PlayerDirectory> {
  let current: PlayerDirectory | undefined;
  let pending: Promise<PlayerDirectory> | undefined;
  let lastAttempt = -Infinity;

  const reload = () => {
    lastAttempt = now();
    pending ??= load()
      .then((directory) => (current = directory))
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  return async function getPlayers() {
    if (!current) return reload();
    if (
      !pending &&
      now() - current.fetchedAt > maxAgeMs &&
      now() - lastAttempt > retryAfterMs
    ) {
      reload().catch((error) =>
        console.error("Error refreshing player data:", error),
      );
    }
    return current;
  };
}
