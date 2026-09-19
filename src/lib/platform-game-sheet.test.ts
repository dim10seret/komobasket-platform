import { describe, expect, it } from "vitest";
import { MatchEngine } from "../../komocontrol/shared/match-engine/engine/match-engine";
import { createPlayer } from "../../komocontrol/shared/match-engine/models/player";
import { EventType } from "../../komocontrol/shared/match-engine/types/event-type";
import { penaltyIdFor } from "../../komocontrol/shared/match-engine/types/penalty";
import { TeamSide } from "../../komocontrol/shared/match-engine/types/team-side";
import type { FoulEvent, MatchEvent } from "../../komocontrol/shared/match-engine/types/event";
import type { MatchState } from "../../komocontrol/shared/match-engine/types/match-state";
import type { MatchPeriod } from "../../komocontrol/shared/match-engine/types/period";
import type { Player } from "../../komocontrol/shared/match-engine/types/player";
import type { MatchRulesV1 } from "../../komocontrol/shared/match-engine/types/rules";
import type { PlatformMatchReport } from "./platform-match-report";
import { gameSheetPeriodColor, projectPlatformGameSheet, type PlatformGameSheetSource } from "./platform-game-sheet";

const player = (id: string, name: string, shirtNumber: string, onCourt = false): Player => createPlayer({ playerId: id, displayName: name, shirtNumber, team: id.startsWith("h") ? TeamSide.HOME : TeamSide.AWAY, onCourt });
const report: PlatformMatchReport = {
  mode: "FULL", availability: { available: true, hasIncidentReport: false },
  game: { gameId: "game-1", competition: "TEST C3", season: "2026-27", phase: "Κανονική διάρκεια", round: "1η Αγωνιστική", scheduledDate: "2026-09-05", scheduledTime: "18:30", venue: "Κλειστό", homeTeam: { teamId: "home", name: "HOME TEAM", logoUrl: null }, awayTeam: { teamId: "away", name: "AWAY TEAM", logoUrl: null }, finalScore: { home: 5, away: 1 }, winner: "HOME", periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 5, away: 1 }] },
  statistics: { home: { players: [], totals: {} as never }, away: { players: [], totals: {} as never } }, incidentReport: null,
};
const packageSnapshot = { schemaVersion: 1, game: { id: "game-1" }, teams: [{ side: "HOME", id: "home", players: [{ id: "h1", displayName: "Home Player", shirtNumber: 12 }], staff: [{ id: "hc", displayName: "Home Coach", role: "head_coach" }] }, { side: "AWAY", id: "away", players: [{ id: "a1", displayName: "Away Player", shirtNumber: 8 }], staff: [] }] };
const configuration = { schemaVersion: 1, runId: "run-1", gameId: "game-1", teams: [{ side: "HOME", teamId: "home", players: [{ playerId: "h1", participating: true, gameShirtNumber: "7" }], staff: [{ staffId: "hc", participating: true }], captainPlayerId: "h1", starterPlayerIds: ["h1"], extraBench: [{ entryId: "x", name: "Bench Person", role: "doctor" }] }, { side: "AWAY", teamId: "away", players: [{ playerId: "a1", participating: true, gameShirtNumber: null }], staff: [], captainPlayerId: null, starterPlayerIds: ["a1"], extraBench: [] }], presentation: { leftSide: "AWAY" }, officials: { referees: { a: "Run Referee", b: null, c: null }, table: { timer: "Timer", shotClock: null, scoresheet: null, commissioner: null } } };
const rules: MatchRulesV1 = { schemaVersion: 1, rulesEdition: "FIBA_2026", minPlayers: 1, maxPlayers: 18, startingPlayers: 1, regulationPeriods: 1, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "ALLOW_TIE", teamFoulPenaltyThreshold: 1, overtimeTeamFoulPolicy: "CARRY_FROM_FINAL_REGULATION" };
function initialStateFor(homePlayers: Player[], awayPlayers: Player[]): MatchState {
  return new MatchEngine({ id: "run-1", rules, homeTeam: { id: "home", name: "HOME TEAM", players: homePlayers }, awayTeam: { id: "away", name: "AWAY TEAM", players: awayPlayers } }).getState();
}
const initialState = initialStateFor([player("h1", "Home Player", "7", true)], [player("a1", "Away Player", "8", true)]);
function replayCanonical(history: readonly MatchEvent[], start: MatchState = initialState): MatchState {
  const engine = MatchEngine.fromInitialState(start);
  for (const event of history) {
    const result = engine.process(event);
    if (!result.accepted) throw new Error(`Canonical fixture rejected event ${event.id}: ${result.reason}`);
  }
  return engine.getState();
}
const events: MatchEvent[] = [
  { schemaVersion: 2, id: "e1", sequence: 1, occurredAt: 1, type: "MATCH_START" },
  { schemaVersion: 2, id: "e2", sequence: 2, occurredAt: 2, type: "THREE_POINT", team: TeamSide.HOME, playerId: "h1" },
  { schemaVersion: 2, id: "e3", sequence: 3, occurredAt: 3, type: "PERSONAL_FOUL", team: TeamSide.HOME, stoppageId: "stoppage-1", offender: { kind: "PLAYER", playerId: "h1" }, context: { kind: "NON_SHOOTING", teamControlFoul: false }, fouledPlayerId: "a1" },
  { schemaVersion: 2, id: "e4", sequence: 4, occurredAt: 4, type: "FREE_THROW", team: TeamSide.AWAY, playerId: "a1", penaltyId: penaltyIdFor("e3"), attemptIndex: 1, made: true },
  { schemaVersion: 2, id: "e5", sequence: 5, occurredAt: 5, type: "FREE_THROW", team: TeamSide.AWAY, playerId: "a1", penaltyId: penaltyIdFor("e3"), attemptIndex: 2, made: false },
  { schemaVersion: 2, id: "e6", sequence: 6, occurredAt: 6, type: "TIMEOUT", team: TeamSide.AWAY },
  { schemaVersion: 2, id: "e7", sequence: 7, occurredAt: 7, type: "TWO_POINT", team: TeamSide.HOME, playerId: "h1" },
  { schemaVersion: 2, id: "e8", sequence: 8, occurredAt: 8, type: "CLOCK_SET", remainingSeconds: 0 },
  { schemaVersion: 2, id: "e9", sequence: 9, occurredAt: 9, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
  { schemaVersion: 2, id: "e10", sequence: 10, occurredAt: 10, type: "MATCH_END" },
];
const finalState = replayCanonical(events);
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
  it("renders a canonically finalized tie as ΙΣΟΠΑΛΙΑ", () => {
    const tieEvents: MatchEvent[] = [
      { schemaVersion: 2, id: "tie-start", sequence: 1, occurredAt: 1, type: "MATCH_START" },
      { schemaVersion: 2, id: "tie-home", sequence: 2, occurredAt: 2, type: "TWO_POINT", team: TeamSide.HOME, playerId: "h1" },
      { schemaVersion: 2, id: "tie-away", sequence: 3, occurredAt: 3, type: "TWO_POINT", team: TeamSide.AWAY, playerId: "a1" },
      { schemaVersion: 2, id: "tie-clock", sequence: 4, occurredAt: 4, type: "CLOCK_SET", remainingSeconds: 0 },
      { schemaVersion: 2, id: "tie-period-end", sequence: 5, occurredAt: 5, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
      { schemaVersion: 2, id: "tie-end", sequence: 6, occurredAt: 6, type: "MATCH_END" },
    ];
    const tieReport: PlatformMatchReport = { ...report, game: { ...report.game, finalScore: { home: 2, away: 2 }, winner: null, periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 2, away: 2 }] } };
    expect(projectPlatformGameSheet(source({ report: tieReport, finalStateJson: JSON.stringify(replayCanonical(tieEvents)), eventJson: tieEvents.map(JSON.stringify) })).winner).toBe("ΙΣΟΠΑΛΙΑ");
  });
  it("replays regulation and dynamically numbered overtime through OT2", () => {
    const periods: MatchPeriod[] = [1, 2, 3, 4].map((index) => ({ kind: "REGULATION", index }));
    periods.push({ kind: "OVERTIME", index: 1 }, { kind: "OVERTIME", index: 2 });
    const history: MatchEvent[] = [{ schemaVersion: 2, id: "ot-start", sequence: 1, occurredAt: 1, type: "MATCH_START" }];
    let sequence = 2;
    for (const period of periods) {
      if (sequence !== 2) { const number = sequence++; history.push({ schemaVersion: 2, id: `ot-period-start-${number}`, sequence: number, occurredAt: number, type: "PERIOD_START", period }); }
      if (period.kind === "OVERTIME" && period.index === 2) { const number = sequence++; history.push({ schemaVersion: 2, id: `ot-score-${number}`, sequence: number, occurredAt: number, type: "TWO_POINT", team: TeamSide.HOME, playerId: "h1" }); }
      const clock = sequence++;
      history.push({ schemaVersion: 2, id: `ot-clock-${clock}`, sequence: clock, occurredAt: clock, type: "CLOCK_SET", remainingSeconds: 0 });
      const end = sequence++;
      history.push({ schemaVersion: 2, id: `ot-period-end-${end}`, sequence: end, occurredAt: end, type: "PERIOD_END", period });
    }
    history.push({ schemaVersion: 2, id: "ot-match-end", sequence, occurredAt: sequence, type: "MATCH_END" });
    const overtimeReport: PlatformMatchReport = { ...report, game: { ...report.game, finalScore: { home: 2, away: 0 }, winner: "HOME", periodScores: periods.map((period) => ({ period, home: period.kind === "OVERTIME" && period.index === 2 ? 2 : 0, away: 0 })) } };
    const overtimeInitial: MatchState = { ...initialState, rules: { ...rules, regulationPeriods: 4, resultPolicy: "REQUIRE_WINNER" } };
    const sheet = projectPlatformGameSheet(source({ report: overtimeReport, finalStateJson: JSON.stringify(replayCanonical(history, overtimeInitial)), eventJson: history.map(JSON.stringify) }));
    expect(sheet.periodScores.filter((score) => score.period.kind === "OVERTIME").map((score) => score.period.index)).toEqual([1, 2]);
    expect(sheet.periodClosures?.at(-1)).toEqual({ period: { kind: "OVERTIME", index: 2 }, home: 2, away: 0 });
  });
  it("rejects canonical score overflow instead of truncating", () => {
    const overflowEvents: MatchEvent[] = [
      { schemaVersion: 2, id: "overflow-start", sequence: 1, occurredAt: 1, type: "MATCH_START" },
      ...Array.from({ length: 81 }, (_, index): MatchEvent => ({ schemaVersion: 2, id: `overflow-${index}`, sequence: index + 2, occurredAt: index + 2, type: "TWO_POINT", team: TeamSide.HOME, playerId: "h1" })),
      { schemaVersion: 2, id: "overflow-clock", sequence: 83, occurredAt: 83, type: "CLOCK_SET", remainingSeconds: 0 },
      { schemaVersion: 2, id: "overflow-period-end", sequence: 84, occurredAt: 84, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
      { schemaVersion: 2, id: "overflow-end", sequence: 85, occurredAt: 85, type: "MATCH_END" },
    ];
    const overflowReport: PlatformMatchReport = { ...report, game: { ...report.game, finalScore: { home: 162, away: 0 }, winner: "HOME", periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 162, away: 0 }] } };
    expect(() => projectPlatformGameSheet(source({ report: overflowReport, finalStateJson: JSON.stringify(replayCanonical(overflowEvents)), eventJson: overflowEvents.map(JSON.stringify) }))).toThrow("GAME_SHEET_SCORE_OVERFLOW");
  });
  it.each([12, 13, 18])("retains all %i declared players, including DNP, without duplicate IDs", (count) => {
    const homePlayers = Array.from({ length: count }, (_, index) => ({ id: `h${index + 1}`, displayName: `Home ${index + 1}`, shirtNumber: index === 0 ? 0 : index === 1 ? "00" : index + 1 }));
    const configured = structuredClone(configuration);
    configured.teams[0].players = homePlayers.map((entry) => ({ playerId: entry.id, participating: true, gameShirtNumber: String(entry.shirtNumber) }));
    const snapshot = structuredClone(packageSnapshot);
    snapshot.teams[0].players = homePlayers;
    const final = replayCanonical(events, initialStateFor(homePlayers.map((entry, index) => player(entry.id, entry.displayName, String(entry.shirtNumber), index === 0)), [player("a1", "Away Player", "8", true)]));
    const result = projectPlatformGameSheet(source({ packageSnapshotJson: JSON.stringify(snapshot), currentConfigurationJson: JSON.stringify(configured), finalStateJson: JSON.stringify(final) }));
    expect(result.home.players).toHaveLength(count);
    expect(new Set(result.home.players.map((entry) => entry.playerId)).size).toBe(count);
    expect(result.home.players.slice(0, 2).map((entry) => entry.shirtNumber)).toEqual(["0", "00"]);
    expect(result.home.players.at(-1)?.entry).toBeNull();
  });
  it("keeps a canonically roster-amended player once by playerId", () => {
    const snapshot = structuredClone(packageSnapshot);
    snapshot.teams[0].players.push({ id: "h2", displayName: "Historical Player", shirtNumber: 22 });
    const configured = structuredClone(configuration);
    configured.teams[0].players.push({ playerId: "h2", participating: true, gameShirtNumber: "22" });
    const history: MatchEvent[] = [events[0], { schemaVersion: 2, id: "h2-add", sequence: 2, occurredAt: 2, type: "ROSTER_PLAYER_ADDED", team: TeamSide.HOME, playerId: "h2", displayName: "Historical Player", shirtNumber: "22" }, ...events.slice(1).map((event) => ({ ...event, sequence: event.sequence + 1 }))];
    const result = projectPlatformGameSheet(source({ packageSnapshotJson: JSON.stringify(snapshot), currentConfigurationJson: JSON.stringify(configured), finalStateJson: JSON.stringify(replayCanonical(history)), eventJson: history.map(JSON.stringify) }));
    expect(result.home.players.filter((entry) => entry.playerId === "h2")).toHaveLength(1);
  });
  it("rejects an unresolved event player rather than inventing an identity", () => { const history: MatchEvent[] = [events[0], { schemaVersion: 2, id: "unknown", sequence: 2, occurredAt: 2, type: "TWO_POINT", team: TeamSide.HOME, playerId: "missing-id" }, ...events.slice(1).map((event) => ({ ...event, sequence: event.sequence + 1 }))]; expect(() => projectPlatformGameSheet(source({ eventJson: history.map(JSON.stringify) }))).toThrow("GAME_SHEET_PLAYER_UNRESOLVED:missing-id"); });
  it("alternates one chronological period colour through regulation and overtime", () => { expect([1, 2, 3, 4].map((index) => gameSheetPeriodColor({ kind: "REGULATION", index }, 4))).toEqual(["red", "blue", "red", "blue"]); expect([1, 2, 3, 4].map((index) => gameSheetPeriodColor({ kind: "OVERTIME", index }, 4))).toEqual(["red", "blue", "red", "blue"]); expect(gameSheetPeriodColor({ kind: "OVERTIME", index: 1 }, 2)).toBe("red"); });
  it("keeps timeout marks tied only to their recorded period, not wall-clock metadata", () => {
    const sheet = projectPlatformGameSheet(source());
    expect(sheet.away.timeoutMarks).toEqual([{ period: { kind: "REGULATION", index: 1 } }]);
    expect(sheet.home.players.find((entry) => entry.playerId === "h1")?.entry).toEqual({ kind: "STARTER", period: { kind: "REGULATION", index: 1 } });
  });
  it("keeps unkeyed statistics out of player identity resolution", () => {
    const sheet = projectPlatformGameSheet(source());
    expect(sheet.diagnostics).toEqual([
      ...report.statistics.home.players.map((_, index) => `GAME_SHEET_STATISTICS_ROW_UNKEYED:HOME:${index}`),
      ...report.statistics.away.players.map((_, index) => `GAME_SHEET_STATISTICS_ROW_UNKEYED:AWAY:${index}`),
    ]);
  });
  it("preserves initial starters after a canonical substitution", () => {
    const snapshot = structuredClone(packageSnapshot);
    snapshot.teams[0].players = Array.from({ length: 6 }, (_, index) => ({ id: `h${index + 1}`, displayName: `Home ${index + 1}`, shirtNumber: index + 1 }));
    snapshot.teams[1].players = Array.from({ length: 5 }, (_, index) => ({ id: `a${index + 1}`, displayName: `Away ${index + 1}`, shirtNumber: index + 1 }));
    const configured = structuredClone(configuration);
    configured.teams[0].players = snapshot.teams[0].players.map((entry) => ({ playerId: entry.id, participating: true, gameShirtNumber: String(entry.shirtNumber) }));
    configured.teams[0].starterPlayerIds = ["h1", "h2", "h3", "h4", "h5"];
    configured.teams[1].players = snapshot.teams[1].players.map((entry) => ({ playerId: entry.id, participating: true, gameShirtNumber: String(entry.shirtNumber) }));
    configured.teams[1].starterPlayerIds = ["a1", "a2", "a3", "a4", "a5"];
    const history: MatchEvent[] = [
      { schemaVersion: 2, id: "starter-home-lineup", sequence: 1, occurredAt: 1, type: "LINEUP_SET", team: TeamSide.HOME, playerIds: ["h1", "h2", "h3", "h4", "h5"] },
      { schemaVersion: 2, id: "starter-away-lineup", sequence: 2, occurredAt: 2, type: "LINEUP_SET", team: TeamSide.AWAY, playerIds: ["a1", "a2", "a3", "a4", "a5"] },
      { schemaVersion: 2, id: "starter-match-start", sequence: 3, occurredAt: 3, type: "MATCH_START" },
      { schemaVersion: 2, id: "starter-substitution", sequence: 4, occurredAt: 4, type: "SUBSTITUTION", team: TeamSide.HOME, playerOutId: "h1", playerInId: "h6" },
      { schemaVersion: 2, id: "starter-clock", sequence: 5, occurredAt: 5, type: "CLOCK_SET", remainingSeconds: 0 },
      { schemaVersion: 2, id: "starter-period-end", sequence: 6, occurredAt: 6, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
      { schemaVersion: 2, id: "starter-match-end", sequence: 7, occurredAt: 7, type: "MATCH_END" },
    ];
    const start = new MatchEngine({ id: "run-1", rules: { ...rules, minPlayers: 5, startingPlayers: 5 }, homeTeam: { id: "home", name: "HOME TEAM", players: snapshot.teams[0].players.map((entry, index) => player(entry.id, entry.displayName, String(entry.shirtNumber), index < 5)) }, awayTeam: { id: "away", name: "AWAY TEAM", players: snapshot.teams[1].players.map((entry) => player(entry.id, entry.displayName, String(entry.shirtNumber), true)) } }).getState();
    const finished = replayCanonical(history, start);
    expect(finished.home.players.find((entry) => entry.playerId === "h1")?.onCourt).toBe(false);
    expect(finished.home.players.find((entry) => entry.playerId === "h6")?.onCourt).toBe(true);
    const tieReport: PlatformMatchReport = { ...report, game: { ...report.game, finalScore: { home: 0, away: 0 }, winner: null, periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 0, away: 0 }] } };
    const sheet = projectPlatformGameSheet(source({ report: tieReport, packageSnapshotJson: JSON.stringify(snapshot), currentConfigurationJson: JSON.stringify(configured), finalStateJson: JSON.stringify(finished), eventJson: history.map(JSON.stringify) }));
    expect(sheet.home.players.filter((entry) => entry.starter).map((entry) => entry.playerId)).toEqual(["h1", "h2", "h3", "h4", "h5"]);
    expect(sheet.home.players.find((entry) => entry.playerId === "h1")?.starter).toBe(true);
    expect(sheet.home.players.find((entry) => entry.playerId === "h6")?.starter).toBe(false);
  });
  function sheetForFoul(foul: FoulEvent, attempts: 1 | 2) {
    const history: MatchEvent[] = [
      { schemaVersion: 2, id: "foul-match-start", sequence: 1, occurredAt: 1, type: "MATCH_START" },
      foul,
      ...Array.from({ length: attempts }, (_, index): MatchEvent => ({ schemaVersion: 2, id: `foul-ft-${index}`, sequence: index + 3, occurredAt: index + 3, type: "FREE_THROW", team: TeamSide.AWAY, playerId: "a1", penaltyId: penaltyIdFor(foul.id), attemptIndex: index + 1, made: index === 0 })),
      { schemaVersion: 2, id: "foul-clock", sequence: attempts + 3, occurredAt: attempts + 3, type: "CLOCK_SET", remainingSeconds: 0 },
      { schemaVersion: 2, id: "foul-period-end", sequence: attempts + 4, occurredAt: attempts + 4, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
      { schemaVersion: 2, id: "foul-match-end", sequence: attempts + 5, occurredAt: attempts + 5, type: "MATCH_END" },
    ];
    const foulReport: PlatformMatchReport = { ...report, game: { ...report.game, finalScore: { home: 0, away: 1 }, winner: "AWAY", periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 0, away: 1 }] } };
    return projectPlatformGameSheet(source({ report: foulReport, finalStateJson: JSON.stringify(replayCanonical(history)), eventJson: history.map(JSON.stringify) }));
  }
  it("renders C and B only for explicit canonical coach and bench technical attribution", () => {
    const coach: FoulEvent = { schemaVersion: 2, id: "coach-tech", sequence: 2, occurredAt: 2, type: "TECHNICAL_FOUL", team: TeamSide.HOME, stoppageId: "coach-stoppage", offender: { kind: "BENCH", personId: "hc", role: "HEAD_COACH" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventContext: { technicalStaffSource: "COACH" } };
    const bench: FoulEvent = { schemaVersion: 2, id: "bench-tech", sequence: 2, occurredAt: 2, type: "TECHNICAL_FOUL", team: TeamSide.HOME, stoppageId: "bench-stoppage", offender: { kind: "BENCH", personId: "x", role: "ACCOMPANYING_DELEGATION" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventContext: { technicalStaffSource: "BENCH" } };
    const generic: FoulEvent = { schemaVersion: 2, id: "player-tech", sequence: 2, occurredAt: 2, type: "TECHNICAL_FOUL", team: TeamSide.HOME, stoppageId: "player-stoppage", offender: { kind: "PLAYER", playerId: "h1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2" };
    expect(sheetForFoul(coach, 1).home.coachFouls?.map((mark) => mark.code)).toEqual(["C"]);
    expect(sheetForFoul(bench, 1).home.coachFouls?.map((mark) => mark.code)).toEqual(["B"]);
    const genericSheet = sheetForFoul(generic, 1);
    expect(genericSheet.home.coachFouls).toEqual([]);
    expect(genericSheet.home.players.find((entry) => entry.playerId === "h1")?.fouls).toEqual(["T"]);
  });
  it("keeps explicit disruptive and flagrant types separate from unsupported U and disqualifying fouls", () => {
    const disruptive: FoulEvent = { schemaVersion: 2, id: "disruptive", sequence: 2, occurredAt: 2, type: "DISRUPTIVE_FOUL", team: TeamSide.HOME, stoppageId: "disruptive-stoppage", offender: { kind: "PLAYER", playerId: "h1" }, context: { kind: "NON_SHOOTING", teamControlFoul: false }, fouledPlayerId: "a1" };
    const flagrant: FoulEvent = { schemaVersion: 2, id: "flagrant", sequence: 2, occurredAt: 2, type: "FLAGRANT_FOUL", team: TeamSide.HOME, stoppageId: "flagrant-stoppage", offender: { kind: "PLAYER", playerId: "h1" }, context: { kind: "NON_SHOOTING", teamControlFoul: false }, fouledPlayerId: "a1" };
    const disqualifying: FoulEvent = { schemaVersion: 2, id: "bench-dq", sequence: 2, occurredAt: 2, type: "DISQUALIFYING_FOUL", team: TeamSide.HOME, stoppageId: "dq-stoppage", offender: { kind: "BENCH", personId: "x", role: "ACCOMPANYING_DELEGATION" }, context: { kind: "NON_CONTACT" } };
    expect(sheetForFoul(disruptive, 2).home.players.find((entry) => entry.playerId === "h1")?.fouls).toEqual(["DI"]);
    expect(sheetForFoul(flagrant, 2).home.players.find((entry) => entry.playerId === "h1")?.fouls).toEqual(["FL"]);
    expect(sheetForFoul(disqualifying, 2).home.players.find((entry) => entry.playerId === "h1")?.fouls).not.toContain("FL");
    expect(Object.values(EventType)).not.toContain("UNSPORTSMANLIKE");
  });
});
