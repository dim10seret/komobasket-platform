import { describe, expect, it } from "vitest";
import type { MatchState } from "../../komocontrol/shared/match-engine/types/match-state";
import { matchReportEfficiency, matchReportShootingPercentage, projectPlatformMatchReportStatistics } from "./platform-match-report-statistics";

const statistics = { points: 8, twoPointAttempts: 3, twoPointMade: 2, threePointAttempts: 2, threePointMade: 1, freeThrowAttempts: 2, freeThrowMade: 1, turnovers: 1, personalFouls: 2, technicalFouls: 0, disruptiveFouls: 0, flagrantFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 2, defensiveRebounds: 3, assists: 4, steals: 1, blocks: 1 };
const foulState = { total: 2, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE" as const };
const player = (playerId: string, shirtNumber: "4" | "7", displayName: string, onCourt: boolean) => ({ playerId, shirtNumber, displayName, onCourt, team: "HOME" as const, foulState, statistics });
const teamStatistics = { twoPointAttempts: 3, twoPointMade: 2, threePointAttempts: 2, threePointMade: 1, freeThrowAttempts: 2, freeThrowMade: 1, turnovers: 1, personalFouls: 2, technicalFouls: 0, disruptiveFouls: 0, flagrantFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 3, defensiveRebounds: 4, assists: 4, steals: 1, blocks: 1 };
const state = (finished: boolean): MatchState => ({ id: "run-1", rules: {} as MatchState["rules"], period: { kind: "REGULATION", index: 4 }, clock: 0, clockRunning: false, started: true, possession: null, alternatingPossession: "HOME", finished, lastProcessedSequence: 10, home: { id: "h", name: "ΛΕΚΑΒΕΞ", side: "HOME", score: 8, timeouts: 0, teamFouls: 2, discipline: {} as MatchState["home"]["discipline"], players: [player("p1", "7", "ΘΕΟΔΟΣΗΣ ΤΑΒΛΑΡΙΔΗΣ", true), player("p2", "4", "ΑΛΛΟΣ ΠΑΙΚΤΗΣ", false)], statistics: teamStatistics }, away: { id: "a", name: "JUGOPIASTIKA", side: "AWAY", score: 7, timeouts: 0, teamFouls: 2, discipline: {} as MatchState["away"]["discipline"], players: [], statistics: teamStatistics } });

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
