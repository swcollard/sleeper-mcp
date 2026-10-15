import {
  compareRelevance,
  nameKey,
  normalizeName,
  type PlayerDirectory,
  type PlayerInfo,
} from "./players.js";

export type SearchOptions = {
  /** e.g. "QB"; matches position or fantasy_positions, ignoring case. */
  position?: string | undefined;
  /** e.g. "KC", or "FA" for free agents; ignores case. */
  team?: string | undefined;
  /** Default 10. */
  limit?: number | undefined;
};

/** Typos are only tolerated in query words this long, to avoid noise. */
const MIN_TYPO_LENGTH = 4;
const MAX_TYPOS = 2;

// Match tiers, best first
const EXACT = 0;
const PREFIX = 1;
const TYPO = 2;

type SearchEntry = {
  info: PlayerInfo;
  /** nameKey of the name */
  key: string;
  /** Words of the normalized name, plus a defense's team abbreviation */
  words: string[];
  /** For team defenses: the abbreviation and nickname ("kc", "chiefs") */
  aliases: string[];
};

// Normalizing ~11k names takes a while, so it's done once per directory
const indexes = new WeakMap<ReadonlyMap<string, PlayerInfo>, SearchEntry[]>();

function searchIndex(byId: ReadonlyMap<string, PlayerInfo>): SearchEntry[] {
  let index = indexes.get(byId);
  if (!index) {
    index = [];
    for (const info of byId.values()) {
      const words = normalizeName(info.name).split(" ").filter(Boolean);
      const aliases: string[] = [];
      if (info.position === "DEF") {
        // A defense's id is its team, e.g. "KC" for the Kansas City Chiefs
        const abbreviation = (info.team ?? info.player_id).toLowerCase();
        aliases.push(abbreviation, words.at(-1) ?? abbreviation);
        words.push(abbreviation);
      }
      index.push({ info, key: nameKey(info.name), words, aliases });
    }
    indexes.set(byId, index);
  }
  return index;
}

/** Words that ask for a team defense: "Chiefs defense", "KC D/ST" */
const DEFENSE_WORDS = /(^| )(defense|def|dst|d st)(?= |$)/g;

const normalizePosition = (position: string) => {
  const upper = position.trim().toUpperCase();
  return upper === "DST" || upper === "D/ST" ? "DEF" : upper;
};

/**
 * Finds players whose name looks like the query, best match first:
 *
 * 1. the whole name matches (as in findByName), or a defense's team
 *    abbreviation or nickname does ("KC", "Chiefs")
 * 2. every query word starts a word of the name ("mahomes", "pat mah"), or
 *    the query starts the name with spaces ignored ("amonra")
 * 3. as 2, but query words of 4+ letters may be up to 2 typos off a name
 *    word ("mahomse"); fewer typos rank higher
 *
 * Ties go to the more relevant player (see compareRelevance). Words like
 * "defense" or "DST" in the query limit it to team defenses.
 */
export function searchPlayers(
  directory: Pick<PlayerDirectory, "byId">,
  query: string,
  { position, team, limit = 10 }: SearchOptions = {},
): PlayerInfo[] {
  let normalized = normalizeName(query);
  let wantedPosition = position ? normalizePosition(position) : undefined;
  const withoutDefense = normalized.replace(DEFENSE_WORDS, "").trim();
  if (withoutDefense && withoutDefense !== normalized) {
    normalized = withoutDefense;
    wantedPosition ??= "DEF";
  }
  const queryWords = normalized.split(" ").filter(Boolean);
  if (!queryWords.length) return [];
  const queryKey = queryWords.join("");
  const wantedTeam = team?.trim().toUpperCase();

  const matches: { info: PlayerInfo; tier: number; typos: number }[] = [];
  for (const entry of searchIndex(directory.byId)) {
    const { info } = entry;
    if (
      wantedPosition &&
      info.position?.toUpperCase() !== wantedPosition &&
      !info.fantasy_positions.some((p) => p.toUpperCase() === wantedPosition)
    ) {
      continue;
    }
    // Free agents have no team
    const playerTeam = info.team?.toUpperCase() ?? "FA";
    if (wantedTeam && playerTeam !== wantedTeam) continue;

    if (entry.key === queryKey || entry.aliases.includes(queryKey)) {
      matches.push({ info, tier: EXACT, typos: 0 });
    } else if (entry.key.startsWith(queryKey)) {
      matches.push({ info, tier: PREFIX, typos: 0 });
    } else {
      const typos = matchWords(queryWords, entry.words);
      if (typos >= 0) {
        matches.push({ info, tier: typos ? TYPO : PREFIX, typos });
      }
    }
  }

  return matches
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.typos - b.typos ||
        compareRelevance(a.info, b.info),
    )
    .slice(0, limit)
    .map((m) => m.info);
}

/**
 * Matches every query word to some name word, by prefix or else (for long
 * enough words) within MAX_TYPOS edits. Returns the total number of typos,
 * or -1 if a query word matches nothing.
 */
function matchWords(queryWords: string[], nameWords: string[]): number {
  let total = 0;
  for (const q of queryWords) {
    let best = MAX_TYPOS + 1;
    for (const w of nameWords) {
      if (w.startsWith(q)) {
        best = 0;
        break;
      }
    }
    if (best && q.length >= MIN_TYPO_LENGTH) {
      for (const w of nameWords) {
        // Cheap check first: typos in both of the first two letters are rare
        if (
          q[0] !== w[0] &&
          q[1] !== w[1] &&
          (q[0] !== w[1] || q[1] !== w[0])
        ) {
          continue;
        }
        best = Math.min(best, editDistance(q, w, MAX_TYPOS));
      }
    }
    if (best > MAX_TYPOS) return -1;
    total += best;
  }
  return total;
}

// Reused between calls so the edit distance doesn't allocate per comparison
let rows = [new Int32Array(32), new Int32Array(32), new Int32Array(32)];

/**
 * Edit distance between a and b, counting a swap of adjacent letters as one
 * edit (optimal string alignment). Returns max + 1 once it must exceed max.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (rows[0]!.length <= b.length) {
    rows = rows.map(() => new Int32Array(b.length * 2));
  }
  // The previous two rows of the table, and the one being filled in
  let prev2 = rows[0]!;
  let prev = rows[1]!;
  let cur = rows[2]!;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cb = b.charCodeAt(j - 1);
      let d = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (ca === cb ? 0 : 1),
      );
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === cb
      ) {
        d = Math.min(d, prev2[j - 2]! + 1);
      }
      cur[j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    const filled = cur;
    cur = prev2;
    prev2 = prev;
    prev = filled;
  }
  return Math.min(prev[b.length]!, max + 1);
}
