import * as fs from "fs/promises";
import {
  buildPlayerDirectory,
  fetchPlayers,
  PLAYER_DATA_MAX_AGE_MS,
  type Player,
  type PlayerDirectory,
} from "./players.js";

export type PlayerFileOptions = {
  fetchFn?: typeof fetch;
  now?: () => number;
};

const readPlayersFile = async (path: string): Promise<Record<string, Player>> =>
  JSON.parse(await fs.readFile(path, "utf-8"));

/**
 * Loads players from a file of Sleeper's raw player list, used as a cache.
 * When the file is missing or more than a day old (by its modified time),
 * downloads a fresh copy and rewrites it; if that download fails, falls back
 * to the old file rather than failing.
 */
export async function loadPlayersFromFile(
  path: string,
  { fetchFn = fetch, now = Date.now }: PlayerFileOptions = {},
): Promise<PlayerDirectory> {
  const stats = await fs.stat(path).catch(() => undefined);
  if (stats && now() - stats.mtimeMs <= PLAYER_DATA_MAX_AGE_MS) {
    return buildPlayerDirectory(await readPlayersFile(path), stats.mtimeMs);
  }

  let data: Record<string, Player>;
  try {
    data = await fetchPlayers(fetchFn);
  } catch (error) {
    if (!stats) throw error;
    console.error("Error refreshing player data; using the old file:", error);
    return buildPlayerDirectory(await readPlayersFile(path), stats.mtimeMs);
  }
  try {
    await fs.writeFile(path, JSON.stringify(data), "utf-8");
  } catch (error) {
    // The file is only a cache; keep the data we already fetched
    console.error("Error writing player data file:", error);
  }
  return buildPlayerDirectory(data, now());
}
