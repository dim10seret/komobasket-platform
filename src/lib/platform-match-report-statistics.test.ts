import { describe, expect, it } from "vitest";
import type { MatchState } from "../../komocontrol/shared/match-engine/types/match-state";
import { matchReportEfficiency, matchReportShootingPercentage, projectPlatformMatchReportStatistics } from "./platform-match-report-statistics";

const statistics = { points: 8, twoPointAttempts: 3, twoPointMade: 2, threePointAttempts: 2, threePointMade: 1, freeThrowAttempts: 2, freeThrowMade: 1, turnovers: 1, personalFouls: 2, technicalFouls: 0, disruptiveFouls: 0, flagrantFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 2, defensiveRebounds: 3, assists: 4, steals: 1, blocks: 1 };
const foulState = { total: 2, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE" as const };
const player = (playerId: string, shirtNumber: "4" | "7", displayName: string, onCourt: boolean) => ({ playerId, shirtNumber, displayName, onCourt, team: "HOME" as const, foulState, statistics });
const teamStatistics = { twoPointAttempts: 3, twoPointMade: 2, threePointAttempts: 2, threePointMade: 1, freeThrowAttempts: 2, freeThrowMade: 1, turnovers: 1, personalFouls: 2, technicalFouls: 0, disruptiveFouls: 0, flagrantFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 3, defensiveRebounds: 4, assists: 4, steals: 1, blocks: 1 };
const state = (finished: boolean): MatchState => ({ id: "run-1", rules: {} as MatchState["rules"], period: { kind: "REGULATION", index: 4 }, clock: 0, clockRunning: false, started: true, possession: null, alternatingPossession: "HOME", finished, lastProcessedSequence: 10, home: { id: "h", name: "ΛΕΚΑΒΕΞ", side: "HOME", score: 8, timeouts: 0, teamFouls: 2, discipline: {} as MatchState["home"]["discipline"], players: [player("p1", "7", "ΘΕΟΔΟΣΗΣ ΤΑΒΛΑΡΙΔΗΣ", true), player("p2", "4", "ΑΛΛΟΣ ΠΑΙΚΤΗΣ", false)], statistics: teamStatistics }, away: { id: "a", name: "JUGOPIASTIKA", side: "AWAY", score: 7, timeouts: 0, teamFouls: 2, discipline: {} as MatchState["away"]["discipline"], players: [], statistics: teamStatistics } });
const simpleStatistics = { points: 9, twoPointAttempts: 2, twoPointMade: 2, threePointAttempts: 1, threePointMade: 1, freeThrowAttempts: 5, freeThrowMade: 2, turnovers: 0, personalFouls: 1, technicalFouls: 0, disruptiveFouls: 0, flagrantFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, steals: 0, blocks: 0 };
const simpleTeamStatistics = { twoPointAttempts: 2, twoPointMade: 2, threePointAttempts: 1, threePointMade: 1, freeThrowAttempts: 5, freeThrowMade: 2, turnovers: 0, personalFouls: 1, technicalFouls: 0, disruptiveFouls: 0, flagrantFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, steals: 0, blocks: 0 };
const simpleState = (finished: boolean): MatchState => {
  const base = state(finished);
  return {
    ...base,
    home: {
      ...base.home,
      score: 9,
      teamFouls: 1,
      players: [{ ...base.home.players[0], foulState: { ...base.home.players[0].foulState, total: 1 }, statistics: simpleStatistics }],
      statistics: simpleTeamStatistics,
    },
  };
};

describe("finalized Match Report statistics projection", () => {
  const projection = projectPlatformMatchReportStatistics(state(false), state(true));
  it("uses finalized Run roster order", () => expect(projection.home.players.map((item) => item.shirtNumber)).toEqual(["7", "4"]));
  it("preserves starter identity from the initial snapshot", () => expect(projection.home.players.map((item) => item.starter)).toEqual([true, false]));
  it("projects player PTS", () => expect(projection.home.players[0].statistics.points).toBe(8));
  it("projects 2PT made and attempts", () => expect(projection.home.players[0].statistics).toMatchObject({ twoPointMade: 2, twoPointAttempts: 3 }));
  it("projects 3PT made and attempts", () => expect(projection.home.players[0].statistics).toMatchObject({ threePointMade: 1, threePointAttempts: 2 }));
  it("projects FT made and attempts", () => expect(projection.home.players[0].statistics).toMatchObject({ freeThrowMade: 1, freeThrowAttempts: 2 }));
  it("projects OREB, DREB and REB", () => expect(projection.home.players[0].statistics).toMatchObject({ offensiveRebounds: 2, defensiveRebounds: 3, rebounds: 5 }));
  it("projects AST, STL and BLK", () => expect(projection.home.players[0].statistics).toMatchObject({ assists: 4, steals: 1, blocks: 1 }));
  it("projects TO and authoritative player foul total", () => expect(projection.home.players[0].statistics).toMatchObject({ turnovers: 1, fouls: 2 }));
  it("uses the KomoControl EFF meaning", () => expect(projection.home.players[0].statistics.efficiency).toBe(15));
  it("uses authoritative team state for totals", () => expect(projection.home.totals).toMatchObject({ points: 8, offensiveRebounds: 3, defensiveRebounds: 4, rebounds: 7 }));
  it("derives percentages only from makes and attempts", () => expect(matchReportShootingPercentage(3, 4)).toBe("75%"));
  it("shows a dash when attempts are zero", () => expect(matchReportShootingPercentage(0, 0)).toBe("-"));
  it("rejects a non-final state", () => expect(() => projectPlatformMatchReportStatistics(state(false), state(false))).toThrow("MATCH_REPORT_STATE_INCONSISTENT"));
  it("keeps efficiency formula independently testable", () => expect(matchReportEfficiency({ ...projection.home.players[0].statistics, efficiency: undefined as never, fouls: undefined as never })).toBe(15));
});

describe("SIMPLE Match Report numeric statistics policy", () => {
  const projection = projectPlatformMatchReportStatistics(simpleState(false), simpleState(true));
  const line = projection.home.players[0].statistics;

  it("keeps unrecorded box-score facts as numeric zero", () => expect(line).toMatchObject({ offensiveRebounds: 0, defensiveRebounds: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 }));
  it("keeps made-only field goals as 2/2 and 1/1", () => expect(line).toMatchObject({ twoPointMade: 2, twoPointAttempts: 2, threePointMade: 1, threePointAttempts: 1 }));
  it("uses the existing percentage behavior for made-only field goals", () => {
    expect(matchReportShootingPercentage(line.twoPointMade, line.twoPointAttempts)).toBe("100%");
    expect(matchReportShootingPercentage(line.threePointMade, line.threePointAttempts)).toBe("100%");
  });
  it("preserves complete SIMPLE free-throw makes and attempts", () => expect(line).toMatchObject({ freeThrowMade: 2, freeThrowAttempts: 5 }));
  it("keeps authoritative fouls numeric", () => expect(line.fouls).toBe(1));
  it("computes numeric EFF with the existing formula", () => expect(line.efficiency).toBe(6));
  it("aggregates SIMPLE team totals through the existing projector", () => expect(projection.home.totals).toMatchObject({ points: 9, twoPointMade: 2, threePointMade: 1, freeThrowMade: 2, freeThrowAttempts: 5, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 1, efficiency: 6 }));
});
