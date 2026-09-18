import { describe, expect, it } from "vitest";
import type { PlatformMatchReport } from "./platform-match-report";
import { projectPlatformGameSheet, type PlatformGameSheetSource } from "./platform-game-sheet";

const player = (id: string, name: string, shirtNumber: string) => ({ playerId: id, displayName: name, shirtNumber, team: id.startsWith("h") ? "HOME" : "AWAY", onCourt: false, foulState: { total: 0 }, statistics: {} });
const report: PlatformMatchReport = {
  mode: "FULL", availability: { available: true, hasIncidentReport: false },
  game: { gameId: "game-1", competition: "TEST C3", season: "2026-27", phase: "Κανονική διάρκεια", round: "1η Αγωνιστική", scheduledDate: "2026-09-05", scheduledTime: "18:30", venue: "Κλειστό", homeTeam: { teamId: "home", name: "HOME TEAM", logoUrl: null }, awayTeam: { teamId: "away", name: "AWAY TEAM", logoUrl: null }, finalScore: { home: 5, away: 1 }, winner: "HOME", periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 5, away: 1 }] },
  statistics: { home: { players: [], totals: {} as never }, away: { players: [], totals: {} as never } }, incidentReport: null,
};
const packageSnapshot = { schemaVersion: 1, game: { id: "game-1" }, teams: [{ side: "HOME", id: "home", players: [{ id: "h1", displayName: "Home Player", shirtNumber: 12 }], staff: [{ id: "hc", displayName: "Home Coach", role: "head_coach" }] }, { side: "AWAY", id: "away", players: [{ id: "a1", displayName: "Away Player", shirtNumber: 8 }], staff: [] }] };
const configuration = { schemaVersion: 1, runId: "run-1", gameId: "game-1", teams: [{ side: "HOME", teamId: "home", players: [{ playerId: "h1", participating: true, gameShirtNumber: "7" }], staff: [{ staffId: "hc", participating: true }], captainPlayerId: "h1", starterPlayerIds: ["h1"], extraBench: [{ entryId: "x", name: "Bench Person", role: "doctor" }] }, { side: "AWAY", teamId: "away", players: [{ playerId: "a1", participating: true, gameShirtNumber: null }], staff: [], captainPlayerId: null, starterPlayerIds: ["a1"], extraBench: [] }], presentation: { leftSide: "AWAY" }, officials: { referees: { a: "Run Referee", b: null, c: null }, table: { timer: "Timer", shotClock: null, scoresheet: null, commissioner: null } } };
const finalState = { id: "run-1", home: { id: "home", score: 5, players: [player("h1", "Home Player", "7")] }, away: { id: "away", score: 1, players: [player("a1", "Away Player", "8")] } };
const events = [
  { schemaVersion: 2, id: "e1", sequence: 1, occurredAt: 1, type: "PERIOD_START", period: { kind: "REGULATION", index: 1 } },
  { schemaVersion: 2, id: "e2", sequence: 2, occurredAt: 2, type: "THREE_POINT", team: "HOME", playerId: "h1" },
  { schemaVersion: 2, id: "e3", sequence: 3, occurredAt: 3, type: "PERSONAL_FOUL", team: "HOME", offender: { kind: "PLAYER", playerId: "h1" } },
  { schemaVersion: 2, id: "e4", sequence: 4, occurredAt: 4, type: "FREE_THROW", team: "AWAY", playerId: "a1", made: true },
  { schemaVersion: 2, id: "e5", sequence: 5, occurredAt: 5, type: "TIMEOUT", team: "AWAY" },
  { schemaVersion: 2, id: "e6", sequence: 6, occurredAt: 6, type: "TWO_POINT", team: "HOME", playerId: "h1" },
  { schemaVersion: 2, id: "e7", sequence: 7, occurredAt: 7, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
];
const source = (changes: Partial<PlatformGameSheetSource> = {}): PlatformGameSheetSource => ({ report, packageSnapshotJson: JSON.stringify(packageSnapshot), currentConfigurationJson: JSON.stringify(configuration), finalStateJson: JSON.stringify(finalState), eventJson: events.map(JSON.stringify), ...changes });

describe("official Game Sheet projection", () => {
  it("tracks the canonical production lifecycle from MATCH_START through the next period", () => {
    const productionReport: PlatformMatchReport = {
      ...report,
      game: {
        ...report.game,
        finalScore: { home: 3, away: 0 },
        winner: "HOME",
        periodScores: [
          { period: { kind: "REGULATION", index: 1 }, home: 3, away: 0 },
          { period: { kind: "REGULATION", index: 2 }, home: 0, away: 0 },
        ],
      },
    };
    const productionEvents = [
      { schemaVersion: 2, id: "production-start", sequence: 1, occurredAt: 1, type: "MATCH_START" },
      { schemaVersion: 2, id: "production-score", sequence: 2, occurredAt: 2, type: "THREE_POINT", team: "HOME", playerId: "h1" },
      { schemaVersion: 2, id: "production-foul", sequence: 3, occurredAt: 3, type: "PERSONAL_FOUL", team: "HOME", offender: { kind: "PLAYER", playerId: "h1" } },
      { schemaVersion: 2, id: "production-timeout", sequence: 4, occurredAt: 4, type: "TIMEOUT", team: "AWAY" },
      { schemaVersion: 2, id: "production-period-1-end", sequence: 5, occurredAt: 5, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
      { schemaVersion: 2, id: "production-period-2-start", sequence: 6, occurredAt: 6, type: "PERIOD_START", period: { kind: "REGULATION", index: 2 } },
      { schemaVersion: 2, id: "production-period-2-timeout", sequence: 7, occurredAt: 7, type: "TIMEOUT", team: "HOME" },
    ];
    const sheet = projectPlatformGameSheet(source({ report: productionReport, eventJson: productionEvents.map(JSON.stringify) }));
    expect(sheet.runningScore[2].home).toMatchObject({ shirtNumber: "7", points: 3, threePoint: true });
    expect(sheet.home.players[0].fouls).toEqual(["P"]);
    expect(sheet.away.timeouts).toEqual(["1η"]);
    expect(sheet.home.timeouts).toEqual(["2η"]);
  });
  it("uses HOME as Team A despite a LEFT/RIGHT presentation swap", () => { const sheet = projectPlatformGameSheet(source()); expect(sheet.home.designation).toBe("Ομάδα Α"); expect(sheet.home.name).toBe("HOME TEAM"); expect(sheet.away.designation).toBe("Ομάδα Β"); });
  it("uses final Run participants, jersey overrides, captain and starters", () => expect(projectPlatformGameSheet(source()).home.players[0]).toMatchObject({ shirtNumber: "7", captain: true, starter: true }));
  it("projects canonical scoring order, three pointers, fouls and timeouts", () => { const sheet = projectPlatformGameSheet(source()); expect(sheet.runningScore[2].home).toMatchObject({ shirtNumber: "7", points: 3, threePoint: true }); expect(sheet.runningScore[4].home?.points).toBe(2); expect(sheet.home.players[0].fouls).toEqual(["P"]); expect(sheet.home.teamFouls[0].count).toBe(1); expect(sheet.away.timeouts).toEqual(["1η"]); });
  it("uses Run-final officials and retains game-only Extra Bench", () => { const sheet = projectPlatformGameSheet(source()); expect(sheet.officials.referees.a).toBe("Run Referee"); expect(sheet.home.extraBench).toEqual([{ name: "Bench Person", role: "Ιατρός" }]); });
  it("allows empty officials and SIMPLE mode without fabricated statistics", () => { const empty = { ...configuration, officials: { referees: { a: null, b: null, c: null }, table: { timer: null, shotClock: null, scoresheet: null, commissioner: null } } }; const sheet = projectPlatformGameSheet(source({ report: { ...report, mode: "SIMPLE" }, currentConfigurationJson: JSON.stringify(empty) })); expect(sheet.mode).toBe("SIMPLE"); expect(sheet.officials.referees.a).toBe(""); });
  it("renders a finalized tie as ΙΣΟΠΑΛΙΑ", () => { const tieEvents = events.filter((event) => event.id !== "e6" && event.id !== "e2"); const tieReport = { ...report, game: { ...report.game, finalScore: { home: 0, away: 1 }, winner: "AWAY" as const, periodScores: [{ period: { kind: "REGULATION" as const, index: 1 }, home: 0, away: 1 }] } }; expect(projectPlatformGameSheet(source({ report: { ...tieReport, game: { ...tieReport.game, finalScore: { home: 1, away: 1 }, winner: null, periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 1, away: 1 }] } }, eventJson: [{ ...events[0] }, { ...events[3], team: "HOME", playerId: "h1", id: "hft", sequence: 2 }, { ...events[3], id: "aft", sequence: 3 }, { ...events[6], sequence: 4 }].map(JSON.stringify) })).winner).toBe("ΙΣΟΠΑΛΙΑ"); });
  it("keeps overtime period summaries", () => { const overtime = { ...report, game: { ...report.game, periodScores: [...report.game.periodScores, { period: { kind: "OVERTIME" as const, index: 1 }, home: 0, away: 0 }] } }; expect(projectPlatformGameSheet(source({ report: overtime })).periodScores.at(-1)?.period.kind).toBe("OVERTIME"); });
  it("rejects score overflow instead of truncating", () => { const overflowReport = { ...report, game: { ...report.game, finalScore: { home: 161, away: 0 } } }; const overflowEvents = [events[0], ...Array.from({ length: 161 }, (_, index) => ({ schemaVersion: 2, id: `s${index}`, sequence: index + 2, occurredAt: index, type: "FREE_THROW", team: "HOME", playerId: "h1", made: true }))]; expect(() => projectPlatformGameSheet(source({ report: overflowReport, eventJson: overflowEvents.map(JSON.stringify) }))).toThrow("GAME_SHEET_SCORE_OVERFLOW"); });
});
