import { describe, expect, it } from "vitest";
import { MatchEngine } from "./match-engine";
import { PeriodEngine } from "./period-engine";
import { resolveResultPolicy } from "./rules-engine";
import { createPlayer } from "../models/player";
import { EventType } from "../types/event-type";
import { overtimePeriod, regulationPeriod, type MatchPeriod } from "../types/period";
import {
  OvertimeTeamFoulPolicy,
  ResultPolicy,
  RulesEdition,
  type MatchRulesV1,
} from "../types/rules";
import { TeamSide } from "../types/team-side";
import type { MatchEvent } from "../types/event";
import type { MatchState } from "../types/match-state";
import type { Player } from "../types/player";

const BASE_RULES: MatchRulesV1 = {
  schemaVersion: 1,
  rulesEdition: RulesEdition.FIBA_2026,
  minPlayers: 5,
  maxPlayers: 12,
  startingPlayers: 5,
  regulationPeriods: 4,
  regulationPeriodSeconds: 600,
  overtimeSeconds: 300,
  resultPolicy: ResultPolicy.REQUIRE_WINNER,
  teamFoulPenaltyThreshold: 5,
  overtimeTeamFoulPolicy: OvertimeTeamFoulPolicy.CARRY_FROM_FINAL_REGULATION,
};

const matchEvent = <T extends Omit<MatchEvent, "id" | "occurredAt">>(data: T): MatchEvent => ({
  ...data,
  id: "event-" + data.sequence,
  occurredAt: data.sequence,
} as MatchEvent);

function rules(overrides: Partial<MatchRulesV1> = {}): MatchRulesV1 {
  return { ...BASE_RULES, ...overrides };
}

function player(playerId: string, team: TeamSide, shirtNumber: string, displayName = playerId): Player {
  return createPlayer({ playerId, team, shirtNumber, displayName });
}

function roster(prefix: string, side: TeamSide, count: number): Player[] {
  return Array.from({ length: count }, (_, index) => player(
    prefix + "-" + (index + 1),
    side,
    String(index + 1),
    (side === TeamSide.HOME ? "Home " : "Away ") + (index + 1),
  ));
}

interface FixtureOptions {
  matchRules?: MatchRulesV1;
  homePlayers?: Player[];
  awayPlayers?: Player[];
}

function createEngineFixture(options: FixtureOptions = {}): { engine: MatchEngine; initialState: MatchState } {
  const matchRules = options.matchRules ?? rules();
  const defaultHomeCount = Math.min(matchRules.maxPlayers, Math.max(matchRules.minPlayers, matchRules.startingPlayers + 1));
  const defaultAwayCount = Math.max(matchRules.minPlayers, matchRules.startingPlayers);
  const homePlayers = options.homePlayers ?? roster("home", TeamSide.HOME, defaultHomeCount);
  const awayPlayers = options.awayPlayers ?? roster("away", TeamSide.AWAY, defaultAwayCount);
  const engine = new MatchEngine({
    id: "match-1",
    rules: matchRules,
    homeTeam: { id: "home", name: "Home", players: homePlayers },
    awayTeam: { id: "away", name: "Away", players: awayPlayers },
  });
  const initialState = engine.getState();

  expect(engine.process(matchEvent({
    type: EventType.LINEUP_SET,
    team: TeamSide.HOME,
    playerIds: homePlayers.slice(0, matchRules.startingPlayers).map((item) => item.playerId),
    sequence: 1,
  })).accepted).toBe(true);
  expect(engine.process(matchEvent({
    type: EventType.LINEUP_SET,
    team: TeamSide.AWAY,
    playerIds: awayPlayers.slice(0, matchRules.startingPlayers).map((item) => item.playerId),
    sequence: 2,
  })).accepted).toBe(true);
  expect(engine.process(matchEvent({ type: EventType.MATCH_START, sequence: 3 })).accepted).toBe(true);
  return { engine, initialState };
}

function createStartedEngine(options: FixtureOptions = {}): MatchEngine {
  return createEngineFixture(options).engine;
}

function closeAndStartPeriod(
  engine: MatchEngine,
  current: MatchPeriod,
  next: MatchPeriod,
  firstSequence: number,
): number {
  expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: firstSequence })).accepted).toBe(true);
  expect(engine.process(matchEvent({ type: EventType.PERIOD_END, period: current, sequence: firstSequence + 1 })).accepted).toBe(true);
  expect(engine.process(matchEvent({ type: EventType.PERIOD_START, period: next, sequence: firstSequence + 2 })).accepted).toBe(true);
  return firstSequence + 3;
}

describe("MatchEngine behavioral regression", () => {
  it("updates score and possession after a made two-point shot", () => {
    const engine = createStartedEngine();
    const result = engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }));

    expect(result.accepted).toBe(true);
    expect(result.state.home.score).toBe(2);
    expect(result.state.home.players[0].statistics.points).toBe(2);
    expect(result.state.possession).toBe(TeamSide.AWAY);
  });

  it("records a personal foul and disqualifies a player on the fifth foul", () => {
    const engine = createStartedEngine();
    for (let sequence = 4; sequence <= 8; sequence += 1) {
      expect(engine.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team: TeamSide.HOME,
        playerId: "home-1",
        ...(sequence === 8 ? { fouledPlayerId: "away-1" } : {}),
        sequence,
      })).accepted).toBe(true);
    }

    expect(engine.getState().home.players[0]).toMatchObject({ fouls: 5, disqualified: true });
  });

  it("updates the active lineup through a substitution", () => {
    const engine = createStartedEngine();
    const result = engine.process(matchEvent({
      type: EventType.SUBSTITUTION,
      team: TeamSide.HOME,
      playerOutId: "home-1",
      playerInId: "home-6",
      sequence: 4,
    }));

    expect(result.accepted).toBe(true);
    expect(result.state.home.players[0].onCourt).toBe(false);
    expect(result.state.home.players[5].onCourt).toBe(true);
  });

  it("allows a substitution while a free-throw series is in progress", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.SHOOTING_FOUL, team: TeamSide.AWAY, playerId: "away-1", fouledPlayerId: "home-1", freeThrows: 2, sequence: 4 })).accepted).toBe(true);
    const result = engine.process(matchEvent({ type: EventType.SUBSTITUTION, team: TeamSide.HOME, playerOutId: "home-1", playerInId: "home-6", sequence: 5 }));

    expect(result.accepted).toBe(true);
    expect(result.state.freeThrowSeries).toMatchObject({ shootingTeam: TeamSide.HOME, shooterId: "home-1", remainingAttempts: 2 });
  });

  it("controls the match clock through typed clock events", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.CLOCK_START, sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 245, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.CLOCK_STOP, sequence: 6 })).accepted).toBe(true);
    expect(engine.getState()).toMatchObject({ clock: 245, clockRunning: false });
  });

  it("replays after undo without stale score or possession", () => {
    const engine = createStartedEngine();
    engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }));
    const result = engine.undoLast();

    expect(result?.accepted).toBe(true);
    expect(result?.state.home.score).toBe(0);
    expect(result?.state.possession).toBe(TeamSide.HOME);
    expect(engine.getEvents()).toHaveLength(3);
  });

  it("runs a free-throw series and changes possession after the final made attempt", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.SHOOTING_FOUL, team: TeamSide.HOME, playerId: "home-1", fouledPlayerId: "away-1", freeThrows: 2, sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: false, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: true, sequence: 6 })).accepted).toBe(true);

    expect(engine.getState()).toMatchObject({ possession: TeamSide.HOME, freeThrowSeries: undefined });
    expect(engine.getState().away.score).toBe(2);
  });

  it("records a missed shot followed by a defensive rebound", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.THREE_POINT_MISSED, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.REBOUND, team: TeamSide.AWAY, playerId: "away-1", offensive: false, sequence: 5 })).accepted).toBe(true);

    const state = engine.getState();
    expect(state.home.players[0].statistics.threePointAttempts).toBe(1);
    expect(state.away.players[0].statistics.defensiveRebounds).toBe(1);
    expect(state.possession).toBe(TeamSide.AWAY);
  });

  it("disqualifies immediately after a disqualifying foul", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.DISQUALIFYING_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.getState().home.players[0]).toMatchObject({ disqualified: true, onCourt: false });
  });

  it("awards one technical free throw and keeps possession", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.TECHNICAL_FOUL, team: TeamSide.AWAY, playerId: "away-1", freeThrowPlayerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: true, isFinalAttempt: true, sequence: 5 })).accepted).toBe(true);
    expect(engine.getState()).toMatchObject({ possession: TeamSide.HOME, freeThrowSeries: undefined });
  });

  it("awards two free throws and possession after an unsportsmanlike foul", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.UNSPORTSMANLIKE_FOUL, team: TeamSide.AWAY, playerId: "away-1", fouledPlayerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: false, isFinalAttempt: false, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: false, isFinalAttempt: true, sequence: 6 })).accepted).toBe(true);
    expect(engine.getState()).toMatchObject({ possession: TeamSide.HOME, freeThrowSeries: undefined });
  });

  it("removes a player after the technical-foul disqualification threshold", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.TECHNICAL_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: true, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.TECHNICAL_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 6 })).accepted).toBe(true);
    expect(engine.getState().home.players[0]).toMatchObject({ disqualified: true, onCourt: false });
  });

  it("disqualifies after one technical and one unsportsmanlike foul", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.TECHNICAL_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: false, isFinalAttempt: true, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.UNSPORTSMANLIKE_FOUL, team: TeamSide.HOME, playerId: "home-1", fouledPlayerId: "away-1", sequence: 6 })).accepted).toBe(true);
    expect(engine.getState().home.players[0]).toMatchObject({ disqualified: true, onCourt: false });
  });

  it("replays a corrected scoring event from the original snapshot", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    const corrected = engine.correctEvent("event-4", matchEvent({ type: EventType.THREE_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }));

    expect(corrected.accepted).toBe(true);
    expect(corrected.state.home.score).toBe(3);
    expect(corrected.state.home.players[0].statistics).toMatchObject({ twoPointAttempts: 0, threePointAttempts: 1, points: 3 });
  });

  it("restores identical state from the initial snapshot and persisted events", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.TURNOVER, team: TeamSide.AWAY, playerId: "away-1", sequence: 5 })).accepted).toBe(true);

    const restored = MatchEngine.fromInitialState(initialState);
    for (const persistedEvent of engine.getEvents()) expect(restored.process(persistedEvent).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());
    expect(restored.getEvents()).toEqual(engine.getEvents());
  });
});

describe("Gate 1B1 clean player and rules contracts", () => {
  it("preserves display names and text shirt numbers exactly", () => {
    const greek = player("greek", TeamSide.HOME, "0", "Αριστείδης Κατσαούνης");
    const international = player("international", TeamSide.AWAY, "00", "Jean-Luc O'Neal");

    expect(greek).toMatchObject({ playerId: "greek", displayName: "Αριστείδης Κατσαούνης", shirtNumber: "0" });
    expect(international).toMatchObject({ playerId: "international", displayName: "Jean-Luc O'Neal", shirtNumber: "00" });
    expect(greek).not.toHaveProperty("firstName");
    expect(greek).not.toHaveProperty("lastName");
  });

  it.each(["", "01", "100", "-1", "A", "1.0"])("rejects invalid shirt number %s", (shirtNumber) => {
    expect(() => player("invalid", TeamSide.HOME, shirtNumber)).toThrow("Invalid shirt number");
  });

  it("keeps 0 and 00 distinct while events resolve immutable playerId", () => {
    const home = roster("home", TeamSide.HOME, 6);
    home[0] = player("home-1", TeamSide.HOME, "0", "Zero");
    home[1] = player("home-2", TeamSide.HOME, "00", "Double Zero");
    const engine = createStartedEngine({ homePlayers: home });

    expect(engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-2", sequence: 4 })).accepted).toBe(true);
    const state = engine.getState();
    expect(state.home.players.find((item) => item.playerId === "home-1")?.statistics.points).toBe(0);
    expect(state.home.players.find((item) => item.playerId === "home-2")?.statistics.points).toBe(2);
  });

  it("rejects globally duplicated player IDs", () => {
    const home = roster("home", TeamSide.HOME, 5);
    const away = roster("away", TeamSide.AWAY, 5);
    away[0] = player("home-1", TeamSide.AWAY, "1");
    expect(() => new MatchEngine({
      id: "duplicate-player",
      rules: rules(),
      homeTeam: { id: "home", name: "Home", players: home },
      awayTeam: { id: "away", name: "Away", players: away },
    })).toThrow("globally unique");
  });

  it("rejects wrong team membership and identical team IDs", () => {
    const wrongHome = roster("home", TeamSide.HOME, 5);
    wrongHome[0] = player("home-1", TeamSide.AWAY, "1");
    const away = roster("away", TeamSide.AWAY, 5);
    expect(() => new MatchEngine({
      id: "wrong-team",
      rules: rules(),
      homeTeam: { id: "home", name: "Home", players: wrongHome },
      awayTeam: { id: "away", name: "Away", players: away },
    })).toThrow("authoritative HOME/AWAY");

    expect(() => new MatchEngine({
      id: "same-team-id",
      rules: rules(),
      homeTeam: { id: "same", name: "Home", players: roster("home", TeamSide.HOME, 5) },
      awayTeam: { id: "same", name: "Away", players: away },
    })).toThrow("distinct non-empty team IDs");
  });

  it("rejects a wrong-team player reference in an event", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "away-1", sequence: 4 }))).toMatchObject({
      accepted: false,
      reason: "PLAYER_NOT_FOUND",
    });
  });

  it("preserves explicit HOME/AWAY authority independently of input array order", () => {
    const home = roster("home", TeamSide.HOME, 5).reverse();
    const away = roster("away", TeamSide.AWAY, 5).reverse();
    const engine = new MatchEngine({
      id: "side-authority",
      rules: rules(),
      homeTeam: { id: "authoritative-home", name: "Home", players: home },
      awayTeam: { id: "authoritative-away", name: "Away", players: away },
    });
    expect(engine.getState().home).toMatchObject({ id: "authoritative-home", side: TeamSide.HOME });
    expect(engine.getState().away).toMatchObject({ id: "authoritative-away", side: TeamSide.AWAY });
  });

  it("defensively rejects rosters outside resolved min/max limits", () => {
    expect(() => new MatchEngine({
      id: "too-few",
      rules: rules(),
      homeTeam: { id: "home", name: "Home", players: roster("home", TeamSide.HOME, 4) },
      awayTeam: { id: "away", name: "Away", players: roster("away", TeamSide.AWAY, 5) },
    })).toThrow("minimum/maximum");

    const exactFive = rules({ maxPlayers: 5 });
    expect(() => new MatchEngine({
      id: "too-many",
      rules: exactFive,
      homeTeam: { id: "home", name: "Home", players: roster("home", TeamSide.HOME, 6) },
      awayTeam: { id: "away", name: "Away", players: roster("away", TeamSide.AWAY, 5) },
    })).toThrow("minimum/maximum");
  });

  it("pins an immutable FIBA_2026 rules snapshot without hidden clock authority", () => {
    const source = {
      ...rules({ regulationPeriodSeconds: 480, overtimeSeconds: 180 }),
    } satisfies MatchRulesV1;
    const engine = new MatchEngine({
      id: "immutable-rules",
      rules: source,
      homeTeam: { id: "home", name: "Home", players: roster("home", TeamSide.HOME, 5) },
      awayTeam: { id: "away", name: "Away", players: roster("away", TeamSide.AWAY, 5) },
    });
    source.regulationPeriodSeconds = 1;

    expect(engine.getState().rules).toMatchObject({ rulesEdition: "FIBA_2026", regulationPeriodSeconds: 480, overtimeSeconds: 180 });
    expect(engine.getState().clock).toBe(480);
  });

  it("maps the two coherent result policies", () => {
    expect(resolveResultPolicy(true, false)).toBe(ResultPolicy.ALLOW_TIE);
    expect(resolveResultPolicy(false, true)).toBe(ResultPolicy.REQUIRE_WINNER);
  });

  it("rejects both incoherent result-policy combinations", () => {
    expect(() => resolveResultPolicy(true, true)).toThrow("exactly one");
    expect(() => resolveResultPolicy(false, false)).toThrow("exactly one");
  });
});

describe("Gate 1B1 variable lineups, periods, clock, and result policy", () => {
  it("uses variable startingPlayers and preserves that count through substitution", () => {
    const matchRules = rules({ minPlayers: 3, maxPlayers: 8, startingPlayers: 3 });
    const engine = createStartedEngine({ matchRules });
    expect(engine.getState().home.players.filter((item) => item.onCourt)).toHaveLength(3);
    expect(engine.process(matchEvent({ type: EventType.SUBSTITUTION, team: TeamSide.HOME, playerOutId: "home-1", playerInId: "home-4", sequence: 4 })).accepted).toBe(true);
    expect(engine.getState().home.players.filter((item) => item.onCourt)).toHaveLength(3);
  });

  it("rejects too few and too many starting players", () => {
    const matchRules = rules({ minPlayers: 3, maxPlayers: 8, startingPlayers: 3 });
    const engine = new MatchEngine({
      id: "lineup-count",
      rules: matchRules,
      homeTeam: { id: "home", name: "Home", players: roster("home", TeamSide.HOME, 4) },
      awayTeam: { id: "away", name: "Away", players: roster("away", TeamSide.AWAY, 4) },
    });
    expect(engine.process(matchEvent({ type: EventType.LINEUP_SET, team: TeamSide.HOME, playerIds: ["home-1", "home-2"], sequence: 1 }))).toMatchObject({ accepted: false, reason: "INVALID_LINEUP" });
    expect(engine.process(matchEvent({ type: EventType.LINEUP_SET, team: TeamSide.HOME, playerIds: ["home-1", "home-2", "home-3", "home-4"], sequence: 1 }))).toMatchObject({ accepted: false, reason: "INVALID_LINEUP" });
  });

  it("serializes regulation and arbitrary overtime periods deterministically", () => {
    const regulation = matchEvent({ type: EventType.PERIOD_START, period: regulationPeriod(2), sequence: 1 });
    const overtime = matchEvent({ type: EventType.PERIOD_START, period: overtimePeriod(7), sequence: 2 });
    expect(JSON.parse(JSON.stringify(regulation))).toEqual(regulation);
    expect(JSON.parse(JSON.stringify(overtime))).toEqual(overtime);
    expect(overtime).toMatchObject({ period: { kind: "OVERTIME", index: 7 } });
  });

  it("rejects invalid period indices defensively", () => {
    const matchRules = rules({ regulationPeriods: 1 });
    const engine = createStartedEngine({ matchRules });
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.PERIOD_START, period: { kind: "OVERTIME", index: 0 }, sequence: 5 }))).toMatchObject({
      accepted: false,
      reason: "INVALID_PERIOD",
    });
  });

  it("derives variable regulation and overtime clocks from rules", () => {
    const matchRules = rules({ regulationPeriods: 2, regulationPeriodSeconds: 480, overtimeSeconds: 180 });
    const engine = createStartedEngine({ matchRules });
    expect(engine.getState().clock).toBe(480);
    let sequence = closeAndStartPeriod(engine, regulationPeriod(1), regulationPeriod(2), 4);
    expect(engine.getState().clock).toBe(480);
    sequence = closeAndStartPeriod(engine, regulationPeriod(2), overtimePeriod(1), sequence);
    expect(engine.getState()).toMatchObject({ period: { kind: "OVERTIME", index: 1 }, clock: 180 });
  });

  it("validates CLOCK_SET against the active rule-derived duration", () => {
    const engine = createStartedEngine({ matchRules: rules({ regulationPeriodSeconds: 480 }) });
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 481, sequence: 4 }))).toMatchObject({ accepted: false, reason: "INVALID_CLOCK_VALUE" });
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 480, sequence: 4 })).accepted).toBe(true);
  });

  it("exposes the future team-foul reset/carry policy without mutating counters", () => {
    const engine = new PeriodEngine();
    const matchRules = rules();
    expect(engine.shouldResetTeamFouls(regulationPeriod(1), regulationPeriod(2), matchRules)).toBe(true);
    expect(engine.shouldResetTeamFouls(regulationPeriod(4), overtimePeriod(1), matchRules)).toBe(false);
    expect(engine.shouldResetTeamFouls(overtimePeriod(1), overtimePeriod(2), matchRules)).toBe(false);
  });

  it("allows a tied final regulation result under ALLOW_TIE and rejects optional overtime", () => {
    const engine = createStartedEngine({ matchRules: rules({ regulationPeriods: 1, resultPolicy: ResultPolicy.ALLOW_TIE }) });
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.PERIOD_END, period: regulationPeriod(1), sequence: 5 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.PERIOD_START, period: overtimePeriod(1), sequence: 6 }))).toMatchObject({ accepted: false, reason: "OVERTIME_NOT_REQUIRED" });
    expect(engine.process(matchEvent({ type: EventType.MATCH_END, sequence: 6 })).accepted).toBe(true);
  });

  it("continues REQUIRE_WINNER overtime without an arbitrary maximum", () => {
    const engine = createStartedEngine({ matchRules: rules({ regulationPeriods: 1 }) });
    let sequence = closeAndStartPeriod(engine, regulationPeriod(1), overtimePeriod(1), 4);
    sequence = closeAndStartPeriod(engine, overtimePeriod(1), overtimePeriod(2), sequence);
    sequence = closeAndStartPeriod(engine, overtimePeriod(2), overtimePeriod(3), sequence);
    closeAndStartPeriod(engine, overtimePeriod(3), overtimePeriod(4), sequence);
    expect(engine.getState()).toMatchObject({ period: { kind: "OVERTIME", index: 4 }, clock: 300 });
  });

  it("finishes a non-tied final regulation result under either policy", () => {
    const engine = createStartedEngine({ matchRules: rules({ regulationPeriods: 1 }) });
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.PERIOD_END, period: regulationPeriod(1), sequence: 6 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.MATCH_END, sequence: 7 })).accepted).toBe(true);
  });

  it("keeps period replay, undo, remove, and correction deterministic", () => {
    const matchRules = rules({ regulationPeriods: 2, regulationPeriodSeconds: 480 });
    const { engine, initialState } = createEngineFixture({ matchRules });
    closeAndStartPeriod(engine, regulationPeriod(1), regulationPeriod(2), 4);

    const restored = MatchEngine.fromInitialState(initialState);
    for (const persistedEvent of engine.getEvents()) expect(restored.process(persistedEvent).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());

    expect(engine.undoLast()?.state).toMatchObject({ period: { kind: "REGULATION", index: 1 }, clock: 0 });
    expect(engine.process(matchEvent({ type: EventType.PERIOD_START, period: regulationPeriod(2), sequence: 6 })).accepted).toBe(true);
    expect(engine.removeEvent("event-6").state).toMatchObject({ period: { kind: "REGULATION", index: 1 }, clock: 0 });
    expect(engine.process(matchEvent({ type: EventType.PERIOD_START, period: regulationPeriod(2), sequence: 6 })).accepted).toBe(true);
    const beforeCorrection = engine.getState();
    expect(engine.correctEvent("event-6", matchEvent({ type: EventType.PERIOD_START, period: regulationPeriod(3), sequence: 6 }))).toMatchObject({ accepted: false, reason: "INVALID_PERIOD" });
    expect(engine.getState()).toEqual(beforeCorrection);
  });
});
