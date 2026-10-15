import { describe, expect, it } from "vitest";
import {
  droppedPlayerIds,
  findFreeAgents,
  freeAgentPositions,
  leaguePositions,
  rosterIdsByPlayer,
  slotPositions,
  type FreeAgentOptions,
} from "./freeAgents.js";
import { buildPlayerDirectory, type Player } from "./players.js";
import type { Roster, Transaction } from "./sleeper.js";

const roster = (
  roster_id: number,
  lists: Pick<Roster, "players"> & Partial<Pick<Roster, "reserve" | "taxi">>,
): Roster => ({
  roster_id,
  owner_id: `u${roster_id}`,
  starters: [],
  league_id: "L1",
  settings: {
    fpts: 0,
    fpts_decimal: 0,
    fpts_against: 0,
    fpts_against_decimal: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    total_moves: 0,
    waiver_position: 0,
    waiver_budget_used: 0,
  },
  ...lists,
});

const player = (
  full_name: string,
  position: string,
  search_rank: number | null,
  overrides: Partial<Player> = {},
): Player => ({
  full_name,
  position,
  fantasy_positions: [position],
  team: "KC",
  active: true,
  search_rank,
  ...overrides,
});

describe("slotPositions", () => {
  it("maps flex slots to the positions they accept", () => {
    expect(slotPositions("FLEX")).toEqual(["RB", "WR", "TE"]);
    expect(slotPositions("SUPER_FLEX")).toEqual(["QB", "RB", "WR", "TE"]);
    expect(slotPositions("REC_FLEX")).toEqual(["WR", "TE"]);
    expect(slotPositions("WRRB_FLEX")).toEqual(["WR", "RB"]);
    expect(slotPositions("IDP_FLEX")).toEqual(["DL", "LB", "DB"]);
  });

  it("maps position slots to themselves and ignores bench slots", () => {
    for (const slot of ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]) {
      expect(slotPositions(slot)).toEqual([slot]);
    }
    for (const slot of ["BN", "IR", "TAXI", "UNKNOWN"]) {
      expect(slotPositions(slot)).toEqual([]);
    }
  });
});

describe("leaguePositions", () => {
  it("collects every position a lineup can start", () => {
    expect(
      leaguePositions(["QB", "RB", "WR", "REC_FLEX", "K", "BN", "IR"]),
    ).toEqual(new Set(["QB", "RB", "WR", "TE", "K"]));
  });
});

describe("rosterIdsByPlayer", () => {
  it("includes players on reserve and taxi, and handles rosters before the draft", () => {
    expect(
      rosterIdsByPlayer([
        roster(1, { players: ["a", "b"], reserve: ["c"], taxi: null }),
        roster(2, { players: ["d"], taxi: ["e"] }),
        roster(3, { players: null, reserve: null }),
      ]),
    ).toEqual(
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 1],
        ["d", 2],
        ["e", 2],
      ]),
    );
  });
});

describe("droppedPlayerIds", () => {
  it("counts drops from completed transactions only", () => {
    const transactions = [
      { status: "complete", drops: { a: 1, b: 1 } },
      { status: "failed", drops: { c: 2 } },
      { status: "complete", drops: null },
    ] as Transaction[];
    expect(droppedPlayerIds(transactions)).toEqual(new Set(["a", "b"]));
  });
});

describe("freeAgentPositions", () => {
  const slots = ["QB", "RB", "WR", "TE", "FLEX", "DEF", "BN"];

  it("narrows the league's positions to the filter, ignoring case", () => {
    expect(freeAgentPositions(slots)).toEqual(
      new Set(["QB", "RB", "WR", "TE", "DEF"]),
    );
    expect(freeAgentPositions(slots, " def ")).toEqual(new Set(["DEF"]));
    expect(freeAgentPositions(slots, "flex")).toEqual(
      new Set(["RB", "WR", "TE"]),
    );
  });

  it("is empty for a position the league doesn't start", () => {
    expect(freeAgentPositions(slots, "K")).toEqual(new Set());
  });
});

describe("findFreeAgents", () => {
  const directory = buildPlayerDirectory(
    {
      qb1: player("Ranked QB", "QB", 10),
      rb1: player("Top RB", "RB", 5),
      rb2: player("Unranked RB", "RB", 9999999),
      wr1: player("Mid WR", "WR", 50, { injury_status: "Questionable" }),
      wr2: player("No Rank WR", "WR", null),
      k1: player("Kicker", "K", 1),
      def: {
        first_name: "Kansas City",
        last_name: "Chiefs",
        position: "DEF",
        fantasy_positions: ["DEF"],
        team: "KC",
        active: true,
        search_rank: 200,
      },
      gone: player("Retired RB", "RB", 2, { active: false }),
      fa: player("Teamless WR", "WR", 3, { team: null }),
      own1: player("Rostered RB", "RB", 1),
      own2: player("Injured WR", "WR", 1),
      own3: player("Taxi WR", "WR", 1),
    },
    0,
  );
  const options: FreeAgentOptions = {
    roster_positions: ["QB", "RB", "WR", "FLEX", "DEF", "BN", "IR"],
    rosters: [
      roster(1, { players: ["own1"], reserve: ["own2"] }),
      roster(2, { players: null, taxi: ["own3"] }),
    ],
    recentlyDropped: new Set(["wr1"]),
    limit: 25,
  };
  const names = (overrides: Partial<FreeAgentOptions> = {}) =>
    findFreeAgents(directory.byId.values(), { ...options, ...overrides }).map(
      (p) => p.name,
    );

  it("lists unrostered active players at league positions, best ranked first", () => {
    // No kicker (the league starts none), inactive or teamless players, or
    // anyone on a roster, reserve or taxi; unranked players come last
    expect(names()).toEqual([
      "Top RB",
      "Ranked QB",
      "Mid WR",
      "Kansas City Chiefs",
      "Unranked RB",
      "No Rank WR",
    ]);
  });

  it("filters by position and limits the count", () => {
    expect(names({ position: "wr" })).toEqual(["Mid WR", "No Rank WR"]);
    expect(names({ limit: 2 })).toEqual(["Top RB", "Ranked QB"]);
  });

  it("describes each player and flags recent drops", () => {
    const players = findFreeAgents(directory.byId.values(), {
      ...options,
      position: "WR",
    });
    expect(players).toEqual([
      {
        player_id: "wr1",
        name: "Mid WR",
        position: "WR",
        team: "KC",
        injury_status: "Questionable",
        search_rank: 50,
        may_be_on_waivers: true,
      },
      {
        player_id: "wr2",
        name: "No Rank WR",
        position: "WR",
        team: "KC",
        injury_status: null,
        search_rank: null,
        may_be_on_waivers: false,
      },
    ]);
    expect(
      findFreeAgents(directory.byId.values(), { ...options, position: "RB" })
        .map((p) => p.search_rank)
        .at(-1),
    ).toBeNull();
  });
});
