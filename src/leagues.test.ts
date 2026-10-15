import { describe, expect, it } from "vitest";
import { leagueDetails, scoringType, waiverType } from "./leagues.js";
import type { League } from "./sleeper.js";

const league: League = {
  league_id: "L1",
  name: "The League",
  season: "2025",
  season_type: "regular",
  status: "in_season",
  sport: "nfl",
  total_rosters: 12,
  roster_positions: ["QB", "RB", "WR", "FLEX", "BN"],
  scoring_settings: { rec: 0.5, pass_td: 4 },
  settings: {
    playoff_teams: 6,
    playoff_week_start: 15,
    waiver_type: 2,
    waiver_budget: 100,
    trade_deadline: 11,
  },
  draft_id: "D1",
  previous_league_id: null,
  avatar: null,
};

describe("scoringType", () => {
  it("names PPR, half-PPR and standard scoring", () => {
    expect(scoringType({ rec: 1 })).toBe("ppr");
    expect(scoringType({ rec: 0.5 })).toBe("half_ppr");
    expect(scoringType({ rec: 0 })).toBe("standard");
    expect(scoringType({ pass_td: 4 })).toBe("standard");
  });

  it("labels any other points per reception as custom", () => {
    expect(scoringType({ rec: 0.25 })).toBe("custom (0.25 per reception)");
    expect(scoringType({ rec: 2 })).toBe("custom (2 per reception)");
  });
});

describe("waiverType", () => {
  it("names known waiver types and passes others through", () => {
    expect(waiverType(0)).toBe("rolling");
    expect(waiverType(1)).toBe("reverse_standings");
    expect(waiverType(2)).toBe("faab");
    expect(waiverType(7)).toBe("unknown (7)");
    expect(waiverType(undefined)).toBeNull();
    expect(waiverType(null)).toBeNull();
  });
});

describe("leagueDetails", () => {
  it("picks out the league's settings", () => {
    expect(leagueDetails(league)).toEqual({
      league_id: "L1",
      name: "The League",
      season: "2025",
      status: "in_season",
      total_rosters: 12,
      scoring_type: "half_ppr",
      roster_positions: ["QB", "RB", "WR", "FLEX", "BN"],
      scoring_settings: { rec: 0.5, pass_td: 4 },
      playoff_teams: 6,
      playoff_week_start: 15,
      waiver_type: "faab",
      waiver_budget: 100,
      trade_deadline: 11,
    });
  });

  it("returns null for missing settings", () => {
    const details = leagueDetails({ ...league, settings: {} });
    expect(details).toMatchObject({
      playoff_teams: null,
      playoff_week_start: null,
      waiver_type: null,
      waiver_budget: null,
      trade_deadline: null,
    });
  });
});
