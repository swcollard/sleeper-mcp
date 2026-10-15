import { describe, expect, it } from "vitest";
import { buildPlayerDirectory } from "./players.js";
import { buildRosterOwners } from "./rosterOwners.js";
import type { Roster, User } from "./sleeper.js";
import { buildLeagueTeams } from "./teams.js";

const users: User[] = [
  {
    user_id: "u1",
    username: "alice",
    display_name: "Alice",
    metadata: { team_name: "Alice's Aces" },
  },
  { user_id: "u2", username: "bob", display_name: "Bob" },
];

const roster = (overrides: Partial<Roster>): Roster => ({
  roster_id: 1,
  owner_id: "u1",
  players: [],
  starters: [],
  league_id: "L1",
  ...overrides,
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
    ...overrides.settings,
  },
});

const { byId: players } = buildPlayerDirectory(
  {
    p1: {
      full_name: "Patrick Mahomes",
      position: "QB",
      team: "KC",
    },
    p2: {
      full_name: "Travis Kelce",
      position: "TE",
      team: "KC",
      injury_status: "Questionable",
    },
    p3: { full_name: "Josh Allen", position: "QB", team: "BUF" },
    p4: { full_name: "Christian McCaffrey", position: "RB", team: "SF" },
    p5: { full_name: "Rookie Guy", position: "WR", team: "NYJ" },
  },
  0,
);

describe("buildRosterOwners", () => {
  it("maps roster ids to owner and team names, blank when unknown", () => {
    const owners = buildRosterOwners(users, [
      roster({ roster_id: 1, owner_id: "u1" }),
      roster({ roster_id: 2, owner_id: "u2" }),
      roster({ roster_id: 3, owner_id: "gone" }),
      roster({ roster_id: 4, owner_id: null }),
    ]);

    expect([...owners]).toEqual([
      [1, { owner_name: "Alice", team_name: "Alice's Aces" }],
      [2, { owner_name: "Bob", team_name: "" }],
      [3, { owner_name: "", team_name: "" }],
      [4, { owner_name: "", team_name: "" }],
    ]);
  });
});

describe("buildLeagueTeams", () => {
  it("joins each roster to its owner, record and points", () => {
    const [team] = buildLeagueTeams(
      users,
      [
        roster({
          settings: {
            wins: 5,
            losses: 2,
            ties: 1,
            fpts: 1012,
            fpts_decimal: 34,
            fpts_against: 987,
            fpts_against_decimal: 6,
          } as Roster["settings"],
        }),
      ],
      players,
    );

    expect(team).toMatchObject({
      roster_id: 1,
      owner_name: "Alice",
      team_name: "Alice's Aces",
      record: { wins: 5, losses: 2, ties: 1 },
      points_for: 1012.34,
      points_against: 987.06,
    });
  });

  it("treats missing points fields as 0", () => {
    const [team] = buildLeagueTeams(
      users,
      [roster({ settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } as never })],
      players,
    );

    expect(team).toMatchObject({ points_for: 0, points_against: 0 });
  });

  it("splits players into starters, bench, reserve and taxi", () => {
    const [team] = buildLeagueTeams(
      users,
      [
        roster({
          players: ["p1", "p2", "p3", "p4", "p5"],
          starters: ["p1", "p2"],
          reserve: ["p4"],
          taxi: ["p5"],
        }),
      ],
      players,
    );

    expect(team?.starters).toEqual([
      {
        player_id: "p1",
        name: "Patrick Mahomes",
        position: "QB",
        team: "KC",
        injury_status: null,
      },
      {
        player_id: "p2",
        name: "Travis Kelce",
        position: "TE",
        team: "KC",
        injury_status: "Questionable",
      },
    ]);
    expect(team?.bench.map((p) => p.name)).toEqual(["Josh Allen"]);
    expect(team?.reserve.map((p) => p.name)).toEqual(["Christian McCaffrey"]);
    expect(team?.taxi.map((p) => p.name)).toEqual(["Rookie Guy"]);
  });

  it('shows "0" in starters as an empty slot, not a player', () => {
    const [team] = buildLeagueTeams(
      users,
      [roster({ players: ["p1", "p3"], starters: ["p1", "0", "p3"] })],
      players,
    );

    expect(team?.starters.map((p) => p?.name ?? null)).toEqual([
      "Patrick Mahomes",
      null,
      "Josh Allen",
    ]);
    expect(team?.bench).toEqual([]);
  });

  it("falls back to the id for unknown players", () => {
    const [team] = buildLeagueTeams(
      users,
      [roster({ players: ["p1", "999"], starters: ["999"] })],
      new Map(),
    );

    expect(team?.starters).toEqual([
      {
        player_id: "999",
        name: "999",
        position: null,
        team: null,
        injury_status: null,
      },
    ]);
    expect(team?.bench.map((p) => p.name)).toEqual(["p1"]);
  });

  it("treats null player lists (before the draft) as empty", () => {
    const [team] = buildLeagueTeams(
      users,
      [roster({ players: null, starters: null, reserve: null, taxi: null })],
      players,
    );

    expect(team).toMatchObject({
      starters: [],
      bench: [],
      reserve: [],
      taxi: [],
    });
  });

  it("orders teams by roster_id and blanks names it can't resolve", () => {
    const teams = buildLeagueTeams(
      users,
      [
        roster({ roster_id: 3, owner_id: null }),
        roster({ roster_id: 1, owner_id: "u2" }),
        roster({ roster_id: 2, owner_id: "gone" }),
      ],
      players,
    );

    expect(teams.map((t) => [t.roster_id, t.owner_name, t.team_name])).toEqual([
      [1, "Bob", ""],
      [2, "", ""],
      [3, "", ""],
    ]);
  });
});
