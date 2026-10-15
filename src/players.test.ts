import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPlayerDirectory,
  createPlayerCache,
  fetchPlayers,
  nameKey,
  normalizeName,
  PLAYER_DATA_MAX_AGE_MS,
  slimPlayers,
  type PlayerDirectory,
} from "./players.js";

describe("buildPlayerDirectory", () => {
  it("maps ids to names and back", () => {
    const { idToName, findByName } = buildPlayerDirectory(
      { "4046": { full_name: "Patrick Mahomes" } },
      0,
    );

    expect(idToName.get("4046")).toBe("Patrick Mahomes");
    expect(findByName("Patrick Mahomes").map((p) => p.player_id)).toEqual([
      "4046",
    ]);
  });

  it("names team defenses, which have no full_name, from first + last name", () => {
    const { idToName, findByName } = buildPlayerDirectory(
      { KC: { first_name: "Kansas City", last_name: "Chiefs" } },
      0,
    );

    expect(idToName.get("KC")).toBe("Kansas City Chiefs");
    expect(findByName("Kansas City Chiefs")[0]?.player_id).toBe("KC");
  });

  it("skips records with no name", () => {
    const { byId, idToName } = buildPlayerDirectory({ X: {} }, 0);

    expect(byId.size).toBe(0);
    expect(idToName.size).toBe(0);
  });

  it("keeps player details, with nulls for missing fields", () => {
    const { byId } = buildPlayerDirectory(
      {
        "4046": {
          full_name: "Patrick Mahomes",
          position: "QB",
          fantasy_positions: ["QB"],
          team: "KC",
          injury_status: "Questionable",
          search_rank: 12,
          active: true,
        },
        "1": { full_name: "Retired Guy" },
      },
      0,
    );

    expect(byId.get("4046")).toMatchObject({
      player_id: "4046",
      name: "Patrick Mahomes",
      position: "QB",
      team: "KC",
      injury_status: "Questionable",
      search_rank: 12,
      active: true,
      age: null,
    });
    expect(byId.get("1")).toMatchObject({
      position: null,
      fantasy_positions: [],
      team: null,
      active: false,
    });
  });

  it("finds names ignoring case, punctuation and suffixes", () => {
    const { findByName } = buildPlayerDirectory(
      {
        "1": { full_name: "A.J. Brown" },
        "2": { full_name: "Amon-Ra St. Brown" },
        "3": { full_name: "Marvin Harrison Jr." },
      },
      0,
    );

    for (const [query, id] of [
      ["aj brown", "1"],
      ["A. J. Brown", "1"],
      ["Amon Ra St Brown", "2"],
      ["marvin harrison", "3"],
      ["Marvin Harrison Jr", "3"],
    ]) {
      expect(findByName(query!)[0]?.player_id, query).toBe(id);
    }
    expect(findByName("Brown")).toEqual([]);
  });

  it("keeps every player who shares a name, most relevant first", () => {
    const { findByName } = buildPlayerDirectory(
      {
        old: { full_name: "Mike Williams", search_rank: 1, active: false },
        backup: { full_name: "Mike Williams", search_rank: 400, active: true },
        unranked: { full_name: "Mike Williams", active: true },
        starter: { full_name: "Mike Williams", search_rank: 90, active: true },
      },
      0,
    );

    expect(findByName("Mike Williams").map((p) => p.player_id)).toEqual([
      "starter",
      "backup",
      "unranked",
      "old",
    ]);
  });
});

describe("normalizeName", () => {
  it("strips accents and splits on punctuation", () => {
    expect(normalizeName("D'Andre Swift")).toBe("dandre swift");
    expect(normalizeName("José  Ramírez-Smith III")).toBe("jose ramirez smith");
    expect(nameKey("A. J. Brown")).toBe("ajbrown");
  });
});

describe("slimPlayers", () => {
  it("round-trips through buildPlayerDirectory", () => {
    const full = buildPlayerDirectory(
      {
        "4046": {
          full_name: "Patrick Mahomes",
          position: "QB",
          fantasy_positions: ["QB"],
          team: "KC",
          search_rank: 12,
          active: true,
          // A field we don't use is dropped
          college: "Texas Tech",
        } as never,
        KC: { first_name: "Kansas City", last_name: "Chiefs", position: "DEF" },
        X: {},
      },
      0,
    );

    const slim = slimPlayers(full);

    expect(slim).toEqual({
      "4046": {
        full_name: "Patrick Mahomes",
        position: "QB",
        fantasy_positions: ["QB"],
        team: "KC",
        search_rank: 12,
        active: true,
      },
      KC: { full_name: "Kansas City Chiefs", position: "DEF" },
    });
    expect([...buildPlayerDirectory(slim, 0).byId]).toEqual([...full.byId]);
  });
});

describe("fetchPlayers", () => {
  it("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(fetchPlayers(fetchFn)).rejects.toThrow(
      "Failed to fetch NFL data: 503 Service Unavailable",
    );
  });
});

describe("createPlayerCache", () => {
  const directory = (fetchedAt: number) => buildPlayerDirectory({}, fetchedAt);
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000_000;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads once for concurrent callers", async () => {
    const load = vi.fn(async () => directory(now()));
    const getPlayers = createPlayerCache(load, { now });

    const [a, b] = await Promise.all([getPlayers(), getPlayers()]);

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries on the next call until the first load succeeds", async () => {
    const load = vi
      .fn<() => Promise<PlayerDirectory>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(directory(now()));
    const getPlayers = createPlayerCache(load, { now });

    await expect(getPlayers()).rejects.toThrow("down");
    await expect(getPlayers()).resolves.toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves stale data while reloading it in the background", async () => {
    const first = directory(now());
    const second = directory(now() + PLAYER_DATA_MAX_AGE_MS + 1);
    const load = vi
      .fn<() => Promise<PlayerDirectory>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const getPlayers = createPlayerCache(load, { now });
    await getPlayers();

    clock += PLAYER_DATA_MAX_AGE_MS - 1;
    expect(await getPlayers()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);

    clock += 2;
    expect(await getPlayers()).toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () => expect(await getPlayers()).toBe(second));
  });

  it("waits retryAfterMs between reloads that leave the data stale", async () => {
    // e.g. Sleeper is down and the loader falls back to an old file
    const stale = directory(now() - PLAYER_DATA_MAX_AGE_MS - 1);
    const load = vi.fn(async () => stale);
    const getPlayers = createPlayerCache(load, { now, retryAfterMs: 1000 });
    await getPlayers();
    await getPlayers();
    expect(load).toHaveBeenCalledTimes(1);

    clock += 1001;
    await getPlayers();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the old data when a background reload fails", async () => {
    const first = directory(now());
    const load = vi
      .fn<() => Promise<PlayerDirectory>>()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("down"));
    const getPlayers = createPlayerCache(load, { now });
    await getPlayers();

    clock += PLAYER_DATA_MAX_AGE_MS + 1;
    expect(await getPlayers()).toBe(first);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(await getPlayers()).toBe(first);
  });
});
