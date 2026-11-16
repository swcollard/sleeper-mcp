import { describe, expect, it } from "vitest";
import {
  gameStatusFor,
  parseSchedule,
  type Schedule,
  type StatusPlayer,
} from "./gameStatus.js";

const NOW = Date.UTC(2026, 10, 15, 18); // Sunday 1pm ET
const HOUR = 60 * 60 * 1000;

const player = (overrides: Partial<StatusPlayer> = {}): StatusPlayer => ({
  player_id: "p1",
  position: "QB",
  team: "KC",
  status: "Active",
  injury_status: null,
  ...overrides,
});

const schedule = (): Schedule =>
  parseSchedule([
    // Week 10: KC's game is over, PIT's is on, DAL's is ahead
    {
      week: 10,
      home: "KC",
      away: "DEN",
      status: "complete",
      start_time: NOW - 5 * HOUR,
    },
    {
      week: 10,
      home: "PIT",
      away: "CIN",
      status: "in_game",
      start_time: NOW - HOUR,
    },
    {
      week: 10,
      home: "DAL",
      away: "PHI",
      status: "pre_game",
      start_time: NOW + 3 * HOUR,
    },
    // SF only plays in week 9, so it's on bye in week 10
    {
      week: 9,
      home: "SF",
      away: "SEA",
      status: "complete",
      start_time: NOW - 7 * 24 * HOUR,
    },
  ])!;

describe("parseSchedule", () => {
  it("indexes games by week and by both teams", () => {
    const s = schedule();

    expect([...s.weeks].sort((a, b) => a - b)).toEqual([9, 10]);
    expect(s.teams.has("KC")).toBe(true);
    expect(s.teams.has("DEN")).toBe(true);
    expect(s.game(10, "KC")).toBe(s.game(10, "DEN"));
    expect(s.game(10, "SF")).toBeUndefined();
  });

  it("accepts epoch seconds, epoch milliseconds and ISO kickoffs", () => {
    const iso = "2026-11-15T18:00:00.000Z";
    const s = parseSchedule([
      { week: 1, home: "A", away: "B", start_time: NOW },
      { week: 1, home: "C", away: "D", start_time: NOW / 1000 },
      { week: 1, home: "E", away: "F", start_time: iso },
      { week: 1, home: "G", away: "H", start_time: "garbage" },
      { week: 1, home: "I", away: "J" },
    ])!;

    expect(s.game(1, "A")?.kickoff).toBe(NOW);
    expect(s.game(1, "C")?.kickoff).toBe(NOW);
    expect(s.game(1, "E")?.kickoff).toBe(Date.parse(iso));
    expect(s.game(1, "G")?.kickoff).toBeNull();
    expect(s.game(1, "I")?.kickoff).toBeNull();
  });

  it("maps Sleeper's status words, tolerating variants", () => {
    const progress = (status: unknown) =>
      parseSchedule([{ week: 1, home: "A", away: "B", status }])!.game(1, "A")
        ?.progress;

    expect(progress("pre_game")).toBe("not_started");
    expect(progress("in_game")).toBe("in_progress");
    expect(progress("In Progress")).toBe("in_progress");
    expect(progress("complete")).toBe("final");
    expect(progress("Final")).toBe("final");
    expect(progress("delayed")).toBe("unknown");
    expect(progress(undefined)).toBe("unknown");
  });

  it("treats LA, WSH and JAC like LAR, WAS and JAX", () => {
    const s = parseSchedule([{ week: 1, home: "LAR", away: "WAS" }])!;

    expect(s.game(1, "LA")).toBeDefined();
    expect(s.game(1, "WSH")).toBeDefined();
    expect(s.teams.has("JAX")).toBe(false);
  });

  it("skips malformed games, and is undefined when none are usable", () => {
    const s = parseSchedule([
      null,
      { week: 1, home: "A" },
      { home: "A", away: "B" },
      { week: 1.5, home: "A", away: "B" },
      { week: 2, home: "C", away: "D" },
    ])!;
    expect([...s.weeks]).toEqual([2]);

    expect(parseSchedule([])).toBeUndefined();
    expect(parseSchedule([{ week: 1 }])).toBeUndefined();
    expect(parseSchedule(null)).toBeUndefined();
    expect(parseSchedule({ error: "nope" })).toBeUndefined();
  });
});

describe("gameStatusFor", () => {
  it("is final once the game is over, with no kickoff", () => {
    expect(gameStatusFor(player(), 10, schedule(), NOW)).toEqual({
      status: "final",
    });
  });

  it("is in_progress during the game, with its kickoff", () => {
    expect(gameStatusFor(player({ team: "CIN" }), 10, schedule(), NOW)).toEqual(
      {
        status: "in_progress",
        kickoff: new Date(NOW - HOUR).toISOString(),
      },
    );
  });

  it("is not_started before kickoff, with its kickoff", () => {
    expect(gameStatusFor(player({ team: "DAL" }), 10, schedule(), NOW)).toEqual(
      {
        status: "not_started",
        kickoff: new Date(NOW + 3 * HOUR).toISOString(),
      },
    );
  });

  it("is bye when the team has no game that week", () => {
    expect(gameStatusFor(player({ team: "SF" }), 10, schedule(), NOW)).toEqual({
      status: "bye",
    });
  });

  it("is out for a player ruled out, unless the game is over", () => {
    const out = player({ team: "DAL", injury_status: "Out" });

    expect(gameStatusFor(out, 10, schedule(), NOW)?.status).toBe("out");
    expect(
      gameStatusFor({ ...out, team: "KC" }, 10, schedule(), NOW)?.status,
    ).toBe("final");
  });

  it("doesn't call a questionable or doubtful player out", () => {
    for (const injury_status of ["Questionable", "Doubtful"]) {
      expect(
        gameStatusFor(
          player({ team: "DAL", injury_status }),
          10,
          schedule(),
          NOW,
        )?.status,
      ).toBe("not_started");
    }
  });

  it("is inactive for free agents and players off the active roster", () => {
    expect(gameStatusFor(player({ team: null }), 10, schedule(), NOW)).toEqual({
      status: "inactive",
    });
    expect(
      gameStatusFor(
        player({ team: "DAL", status: "Injured Reserve", injury_status: "IR" }),
        10,
        schedule(),
        NOW,
      ),
    ).toEqual({ status: "inactive" });
  });

  it("tells a bye apart from not_started even for a player ruled out", () => {
    expect(
      gameStatusFor(
        player({ team: "SF", injury_status: "Out" }),
        10,
        schedule(),
        NOW,
      )?.status,
    ).toBe("bye");
  });

  it("uses a team defense's id as its team", () => {
    const defense = player({
      player_id: "DAL",
      position: "DEF",
      team: null,
    });

    expect(gameStatusFor(defense, 10, schedule(), NOW)?.status).toBe(
      "not_started",
    );
  });

  it("falls back to the kickoff when the game's status is unrecognized", () => {
    const s = parseSchedule([
      { week: 1, home: "A", away: "B", status: "???", start_time: NOW + HOUR },
      { week: 1, home: "C", away: "D", status: "???", start_time: NOW - HOUR },
      { week: 1, home: "E", away: "F" },
    ])!;

    expect(gameStatusFor(player({ team: "A" }), 1, s, NOW)?.status).toBe(
      "not_started",
    );
    // Kicked off, but no way to say whether it's still on
    expect(gameStatusFor(player({ team: "C" }), 1, s, NOW)).toBeUndefined();
    expect(gameStatusFor(player({ team: "E" }), 1, s, NOW)).toBeUndefined();
  });

  it("is undefined when it can't be told, rather than guessing", () => {
    // No player, no schedule, or a week the schedule doesn't cover
    expect(gameStatusFor(undefined, 10, schedule(), NOW)).toBeUndefined();
    expect(gameStatusFor(player(), 10, undefined, NOW)).toBeUndefined();
    expect(gameStatusFor(player(), 11, schedule(), NOW)).toBeUndefined();
    // A team the schedule has never heard of must not read as a bye
    expect(
      gameStatusFor(player({ team: "XYZ" }), 10, schedule(), NOW),
    ).toBeUndefined();
  });
});
