import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlayersFromFile } from "./playerFile.js";
import { PLAYER_DATA_MAX_AGE_MS } from "./players.js";

const OLD = { "1": { full_name: "Old Player" } };
const NEW = { "2": { full_name: "New Player" } };

describe("loadPlayersFromFile", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sleeper-players-"));
    file = path.join(dir, "nfl.json");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Writes the file with a modified time `ageMs` before now. */
  const writeFile = async (data: unknown, ageMs: number) => {
    await fs.writeFile(file, JSON.stringify(data));
    const mtime = new Date(Date.now() - ageMs);
    await fs.utimes(file, mtime, mtime);
  };

  const sleeper = (data: unknown) => vi.fn(async () => Response.json(data));
  const sleeperDown = () =>
    vi.fn(async () => new Response("", { status: 503 }));

  it("uses a fresh file without calling Sleeper", async () => {
    await writeFile(OLD, 60_000);
    const fetchFn = sleeper(NEW);

    const players = await loadPlayersFromFile(file, { fetchFn });

    expect(players.idToName.get("1")).toBe("Old Player");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(Date.now() - players.fetchedAt).toBeGreaterThanOrEqual(59_000);
  });

  it("downloads and saves the data when the file is missing", async () => {
    const players = await loadPlayersFromFile(file, { fetchFn: sleeper(NEW) });

    expect(players.idToName.get("2")).toBe("New Player");
    expect(JSON.parse(await fs.readFile(file, "utf-8"))).toEqual(NEW);
  });

  it("replaces a file more than a day old", async () => {
    await writeFile(OLD, PLAYER_DATA_MAX_AGE_MS + 60_000);
    const now = Date.now();

    const players = await loadPlayersFromFile(file, {
      fetchFn: sleeper(NEW),
      now: () => now,
    });

    expect(players.idToName.get("2")).toBe("New Player");
    expect(players.fetchedAt).toBe(now);
    expect(JSON.parse(await fs.readFile(file, "utf-8"))).toEqual(NEW);
  });

  it("falls back to an old file when Sleeper is down", async () => {
    await writeFile(OLD, PLAYER_DATA_MAX_AGE_MS + 60_000);

    const players = await loadPlayersFromFile(file, { fetchFn: sleeperDown() });

    expect(players.idToName.get("1")).toBe("Old Player");
    // Still stale, so the player cache tries again later
    expect(Date.now() - players.fetchedAt).toBeGreaterThan(
      PLAYER_DATA_MAX_AGE_MS,
    );
  });

  it("fails with no file when Sleeper is down", async () => {
    await expect(
      loadPlayersFromFile(file, { fetchFn: sleeperDown() }),
    ).rejects.toThrow("Failed to fetch NFL data");
  });

  it("keeps downloaded data when the file can't be written", async () => {
    const players = await loadPlayersFromFile(
      path.join(dir, "missing-dir", "nfl.json"),
      { fetchFn: sleeper(NEW) },
    );

    expect(players.idToName.get("2")).toBe("New Player");
    expect(console.error).toHaveBeenCalled();
  });
});
