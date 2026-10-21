import { describe, expect, it } from "vitest";
import {
  editDistance,
  searchPlayers,
  type SearchOptions,
} from "./playerSearch.js";
import { buildPlayerDirectory, type Player } from "./players.js";

const player = (
  full_name: string,
  position: string,
  team: string | null,
  search_rank: number,
  extra: Partial<Player> = {},
): Player => ({
  full_name,
  position,
  fantasy_positions: [position],
  team,
  search_rank,
  active: true,
  ...extra,
});

const defense = (team: string, city: string, nickname: string): Player => ({
  first_name: city,
  last_name: nickname,
  position: "DEF",
  fantasy_positions: ["DEF"],
  team,
  active: true,
});

const directory = buildPlayerDirectory(
  {
    mahomes: player("Patrick Mahomes", "QB", "KC", 12),
    freiermuth: player("Pat Freiermuth", "TE", "PIT", 150),
    ptaylor: player("Patrick Taylor", "RB", null, 900),
    ajbrown: player("A.J. Brown", "WR", "PHI", 8),
    stbrown: player("Amon-Ra St. Brown", "WR", "DET", 5),
    mhj: player("Marvin Harrison Jr.", "WR", "ARI", 20),
    mhsr: player("Marvin Harrison", "WR", null, 1, { active: false }),
    borregales: player("Andrés Borregales", "K", "NE", 300),
    jefferson: player("Justin Jefferson", "WR", "MIN", 3),
    vjefferson: player("Van Jefferson", "WR", "TEN", 500),
    mw1: player("Mike Williams", "WR", "PIT", 200),
    mw2: player("Mike Williams", "WR", null, 600),
    samuel: player("Deebo Samuel", "WR", "WAS", 60, {
      fantasy_positions: ["WR", "RB"],
    }),
    agholor: player("Nelson Agholor", "WR", null, 700),
    lockett: player("Tyler Lockett", "WR", null, 50),
    walker: player("Kenneth Walker", "RB", "SEA", 30),
    nolen: player("Walter Nolen", "DL", "ARI", 10),
    KC: defense("KC", "Kansas City", "Chiefs"),
    NE: defense("NE", "New England", "Patriots"),
  },
  0,
);

const search = (query: string, options?: SearchOptions) =>
  searchPlayers(directory, query, options).map((p) => p.player_id);

describe("searchPlayers", () => {
  it("finds a player by full name, last name or the start of each word", () => {
    expect(search("Patrick Mahomes")[0]).toBe("mahomes");
    expect(search("mahomes")).toEqual(["mahomes"]);
    expect(search("pat mah")).toEqual(["mahomes"]);
    expect(search("mahomes patrick")).toEqual(["mahomes"]);
  });

  it("ranks exact names first, then prefixes, then by relevance", () => {
    // All start with "pat"; the unranked Patriots defense goes last
    expect(search("pat")).toEqual(["mahomes", "freiermuth", "ptaylor", "NE"]);
    // An exact name beats a better-ranked prefix match
    expect(search("Patrick Taylor")[0]).toBe("ptaylor");
  });

  it("ignores case, accents and punctuation", () => {
    expect(search("andres borregales")).toEqual(["borregales"]);
    expect(search("BORREGALES")).toEqual(["borregales"]);
    expect(search("Andrés")).toEqual(["borregales"]);
  });

  it("matches initials however they're written", () => {
    for (const query of ["A.J. Brown", "aj brown", "A. J. Brown", "AJ"]) {
      expect(search(query)[0], query).toBe("ajbrown");
    }
    expect(search("amon-ra")).toEqual(["stbrown"]);
    expect(search("amonra")).toEqual(["stbrown"]);
    expect(search("st brown")).toEqual(["stbrown"]);
  });

  it("ignores suffixes like Jr., listing everyone who shares a name", () => {
    // Active first, even though the retired Marvin Harrison is ranked higher
    expect(search("Marvin Harrison Jr.")).toEqual(["mhj", "mhsr"]);
    expect(search("marvin harrison")).toEqual(["mhj", "mhsr"]);
    expect(search("Mike Williams")).toEqual(["mw1", "mw2"]);
  });

  it("puts every player sharing a last name together, best ranked first", () => {
    expect(search("jefferson")).toEqual(["jefferson", "vjefferson"]);
  });

  it("tolerates small typos in longer words, fewest typos first", () => {
    expect(search("mahomse")).toEqual(["mahomes"]);
    expect(search("patrik mahomes")).toEqual(["mahomes"]);
    expect(search("justin jeferson")).toEqual(["jefferson"]);
    expect(search("jeffersen")).toEqual(["jefferson", "vjefferson"]);
    // One typo from "walker" beats two from the better-ranked "walter"
    expect(search("walkr")).toEqual(["walker", "nolen"]);
  });

  it("doesn't allow typos in short words or more than 2 per word", () => {
    expect(search("mak")).toEqual([]);
    expect(search("mxhxmxs")).toEqual([]);
    // "pet" would be one typo from "pat", but it's too short
    expect(search("pet mahomes")).toEqual([]);
  });

  it("puts typo matches after exact and prefix matches", () => {
    // "tyler" is two typos from "taylor"; Lockett is ranked higher
    expect(search("taylor")).toEqual(["ptaylor", "lockett"]);
  });

  it("matches team defenses by name, nickname or abbreviation", () => {
    expect(search("Kansas City Chiefs")).toEqual(["KC"]);
    expect(search("chiefs")).toEqual(["KC"]);
    expect(search("KC")).toEqual(["KC"]);
    expect(search("kansas")).toEqual(["KC"]);
    // The exact abbreviation beats players whose names start with "ne"
    expect(search("NE")[0]).toBe("NE");
    expect(search("NE")).toContain("agholor");
  });

  it("treats words like defense or D/ST as asking for a defense", () => {
    expect(search("Chiefs defense")).toEqual(["KC"]);
    expect(search("KC D/ST")).toEqual(["KC"]);
    expect(search("ne def")).toEqual(["NE"]);
  });

  it("filters by position and team, ignoring case", () => {
    expect(search("pat", { position: "te" })).toEqual(["freiermuth"]);
    expect(search("pat", { team: "kc" })).toEqual(["mahomes"]);
    expect(search("pat", { position: "QB", team: "PIT" })).toEqual([]);
    expect(search("ne", { position: "dst" })).toEqual(["NE"]);
    // Free agents have no team
    expect(search("pat", { team: "FA" })).toEqual(["ptaylor"]);
  });

  it("matches a position filter against fantasy positions too", () => {
    expect(search("deebo", { position: "RB" })).toEqual(["samuel"]);
  });

  it("returns at most limit results", () => {
    expect(search("pat", { limit: 2 })).toEqual(["mahomes", "freiermuth"]);

    const many = buildPlayerDirectory(
      Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [
          `p${i}`,
          player("Mike Williams", "WR", null, i),
        ]),
      ),
      0,
    );
    expect(searchPlayers(many, "mike")).toHaveLength(10);
    expect(searchPlayers(many, "mike", { limit: 50 })).toHaveLength(50);
  });

  it("returns nothing for a query with no name in it", () => {
    expect(search("")).toEqual([]);
    expect(search("Jr.")).toEqual([]);
    expect(search("?!")).toEqual([]);
    expect(search("zzzz")).toEqual([]);
  });

  it("returns player records, reusing the index across searches", () => {
    const [first] = searchPlayers(directory, "mahomes");
    expect(first).toBe(directory.byId.get("mahomes"));
    expect(searchPlayers(directory, "mahomes")[0]).toBe(first);
  });
});

describe("editDistance", () => {
  it("counts insertions, deletions, substitutions and swaps", () => {
    expect(editDistance("mahomes", "mahomes", 2)).toBe(0);
    expect(editDistance("mahoms", "mahomes", 2)).toBe(1);
    expect(editDistance("mahomess", "mahomes", 2)).toBe(1);
    expect(editDistance("mahones", "mahomes", 2)).toBe(1);
    expect(editDistance("mahomse", "mahomes", 2)).toBe(1);
    expect(editDistance("mhaomse", "mahomes", 2)).toBe(2);
  });

  it("stops at max + 1", () => {
    expect(editDistance("abcdef", "uvwxyz", 2)).toBe(3);
    expect(editDistance("a", "abcdefgh", 2)).toBe(3);
  });

  it("handles words longer than its scratch buffers", () => {
    const long = "a".repeat(100);
    expect(editDistance(long, `${long}b`, 2)).toBe(1);
    expect(editDistance("", "", 2)).toBe(0);
  });
});
