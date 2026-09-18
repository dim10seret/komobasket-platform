import { describe, expect, it } from "vitest";

import type { PlatformMatchReport, PlatformMatchReportStatisticsLine } from "./platform-match-report";
import { projectPublicFinalizedGame } from "./public-finalized-game";

const line: PlatformMatchReportStatisticsLine = { points: 6, twoPointMade: 2, twoPointAttempts: 3, threePointMade: 0, threePointAttempts: 1, freeThrowMade: 2, freeThrowAttempts: 2, offensiveRebounds: 1, defensiveRebounds: 2, rebounds: 3, assists: 4, steals: 1, blocks: 1, turnovers: 2, fouls: 3, efficiency: 10 };
const report: PlatformMatchReport = { mode: "FULL", availability: { available: true, hasIncidentReport: true }, game: { gameId: "game-reference", competition: "TEST C3", season: "2026-27", phase: "ΚΑΝΟΝΙΚΗ ΔΙΑΡΚΕΙΑ", round: "1η Αγωνιστική", scheduledDate: "2026-09-02", scheduledTime: "18:30", venue: "ΚΛΕΙΣΤΟ", homeTeam: { teamId: "private-home", name: "ΛΕΚΑΒΕΞ", logoUrl: "/home.png" }, awayTeam: { teamId: "private-away", name: "JUGOPIASTIKA", logoUrl: null }, finalScore: { home: 14, away: 7 }, winner: "HOME", periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 10, away: 5 }, { period: { kind: "REGULATION", index: 2 }, home: 2, away: 2 }, { period: { kind: "REGULATION", index: 3 }, home: 2, away: 0 }, { period: { kind: "REGULATION", index: 4 }, home: 0, away: 0 }, { period: { kind: "OVERTIME", index: 2 }, home: 0, away: 0 }] }, statistics: { home: { players: [{ shirtNumber: "4", displayName: "ΘΕΟΔΟΣΗΣ ΤΑΒΛΑΡΙΔΗΣ", starter: true, finalStatus: "ELIGIBLE", finalStatusReason: null, statistics: line }], totals: line }, away: { players: [{ shirtNumber: "7", displayName: "ΑΠΟΣΤΟΛΟΣ ΚΟΥΤΣΟΓΙΑΝΝΗΣ", starter: false, finalStatus: "DISQUALIFIED", finalStatusReason: "FOUL_OUT", statistics: { ...line, points: 7 } }], totals: { ...line, points: 7 } } }, incidentReport: "ΤΕΣΤ ΑΝΑΦΟΡΑΣ" };
const detail = projectPublicFinalizedGame(report);

describe("public finalized game projection", () => {
  it("marks the projection finalized", () => expect(detail.status).toBe("finalized"));
  it("keeps the public game identity", () => expect(detail.game.gameId).toBe("game-reference"));
  it("projects competition and season", () => expect([detail.game.competition, detail.game.season]).toEqual(["TEST C3", "2026-27"]));
  it("projects phase and round", () => expect([detail.game.phase, detail.game.round]).toEqual(["ΚΑΝΟΝΙΚΗ ΔΙΑΡΚΕΙΑ", "1η Αγωνιστική"]));
  it("projects schedule and venue", () => expect([detail.game.scheduledDate, detail.game.scheduledTime, detail.game.venue]).toEqual(["2026-09-02", "18:30", "ΚΛΕΙΣΤΟ"]));
  it("projects the authoritative final score", () => expect(detail.game.finalScore).toEqual({ home: 14, away: 7 }));
  it("projects the winner", () => expect(detail.game.winner).toBe("HOME"));
  it("preserves every regulation period", () => expect(detail.game.periodScores.slice(0, 4).map((entry) => entry.home)).toEqual([10, 2, 2, 0]));
  it("supports dynamic overtime indexes", () => expect(detail.game.periodScores.at(-1)?.period).toEqual({ kind: "OVERTIME", index: 2 }));
  it("projects HOME identity without its internal team id", () => expect(detail.teams.home).toMatchObject({ name: "ΛΕΚΑΒΕΞ", logoUrl: "/home.png" }));
  it("projects AWAY identity without its internal team id", () => expect(detail.teams.away).toMatchObject({ name: "JUGOPIASTIKA", logoUrl: null }));
  it("uses finalized roster shirt numbers", () => expect(detail.teams.home.players[0].shirtNumber).toBe("4"));
  it("uses finalized Greek player names", () => expect(detail.teams.home.players[0].displayName).toBe("ΘΕΟΔΟΣΗΣ ΤΑΒΛΑΡΙΔΗΣ"));
  it("preserves starter state", () => expect(detail.teams.home.players[0].starter).toBe(true));
  it("preserves final player state", () => expect(detail.teams.away.players[0].finalStatus).toBe("DISQUALIFIED"));
  it("projects PTS", () => expect(detail.teams.home.players[0].statistics.points).toBe(6));
  it("projects 2PT", () => expect([detail.teams.home.players[0].statistics.twoPointMade, detail.teams.home.players[0].statistics.twoPointAttempts]).toEqual([2, 3]));
  it("projects 3PT", () => expect([detail.teams.home.players[0].statistics.threePointMade, detail.teams.home.players[0].statistics.threePointAttempts]).toEqual([0, 1]));
  it("projects FT", () => expect([detail.teams.home.players[0].statistics.freeThrowMade, detail.teams.home.players[0].statistics.freeThrowAttempts]).toEqual([2, 2]));
  it("projects OREB", () => expect(detail.teams.home.players[0].statistics.offensiveRebounds).toBe(1));
  it("projects DREB", () => expect(detail.teams.home.players[0].statistics.defensiveRebounds).toBe(2));
  it("projects REB", () => expect(detail.teams.home.players[0].statistics.rebounds).toBe(3));
  it("projects AST", () => expect(detail.teams.home.players[0].statistics.assists).toBe(4));
  it("projects STL", () => expect(detail.teams.home.players[0].statistics.steals).toBe(1));
  it("projects BLK", () => expect(detail.teams.home.players[0].statistics.blocks).toBe(1));
  it("projects TO", () => expect(detail.teams.home.players[0].statistics.turnovers).toBe(2));
  it("projects F", () => expect(detail.teams.home.players[0].statistics.fouls).toBe(3));
  it("projects EFF", () => expect(detail.teams.home.players[0].statistics.efficiency).toBe(10));
  it("reuses authoritative team totals", () => expect(detail.teams.away.totals.points).toBe(7));
  it("never exposes the Incident Report", () => expect(JSON.stringify(detail)).not.toContain("ΤΕΣΤ ΑΝΑΦΟΡΑΣ"));
  it("never exposes incident availability metadata", () => expect(detail).not.toHaveProperty("availability"));
  it("never exposes internal team ids", () => { expect(detail.teams.home).not.toHaveProperty("teamId"); expect(detail.teams.away).not.toHaveProperty("teamId"); });
  it("does not expose hashes, scorer, device, or run metadata", () => expect(JSON.stringify(detail)).not.toMatch(/historyHash|finalizationHash|scorerId|deviceId|runId|incidentReport/i));
});
