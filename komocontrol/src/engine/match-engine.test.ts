import { describe, expect, it } from "vitest";
import { MatchEngine } from "./match-engine";
import { PeriodEngine } from "./period-engine";
import { resolveResultPolicy } from "./rules-engine";
import { createPlayer } from "../models/player";
import { EventType } from "../types/event-type";
import { dependentEventIds } from "../../shared/match-engine/engine/event-dependencies";
import {
  MATCH_EVENT_SCHEMA_VERSION,
  type MatchEvent,
} from "../types/event";
import {
  BenchRole,
  FoulContextKind,
  FoulOffenderKind,
  PlayerFoulStatus,
  PlayerFoulStatusReason,
  TechnicalFoulCategory,
} from "../types/foul";
import { PenaltyRestartKind, ShooterPolicy, penaltyIdFor } from "../types/penalty";
import { overtimePeriod, regulationPeriod, type MatchPeriod } from "../types/period";
import {
  OvertimeTeamFoulPolicy,
  ResultPolicy,
  RulesEdition,
  type MatchRulesV1,
} from "../types/rules";
import { TeamSide } from "../types/team-side";
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

type MatchEventInput = MatchEvent extends infer Event
  ? Event extends MatchEvent
    ? Omit<Event, "schemaVersion" | "id" | "occurredAt">
    : never
  : never;

const matchEvent = <T extends MatchEventInput>(data: T): MatchEvent => ({
  ...data,
  schemaVersion: MATCH_EVENT_SCHEMA_VERSION,
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
  it("keeps a valid scoring event independent from stopped and zero clock states", () => {
    const stopped = createStartedEngine();
    expect(stopped.getState()).toMatchObject({ clock: 600, clockRunning: false });
    expect(stopped.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }))).toMatchObject({ accepted: true });

    const zero = createStartedEngine();
    expect(zero.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: 4 }))).toMatchObject({ accepted: true });
    expect(zero.getState()).toMatchObject({ clock: 0, clockRunning: false });
    expect(zero.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 5 }))).toMatchObject({ accepted: true });
  });

  it("allocates shared half timeout pools and resets every overtime deterministically", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.getState()).toMatchObject({ home: { timeouts: 2, timeoutAllowance: 2 }, away: { timeouts: 2, timeoutAllowance: 2 } });

    expect(engine.process(matchEvent({ type: EventType.TIMEOUT, team: TeamSide.HOME, sequence: 4 }))).toMatchObject({ accepted: true });
    expect(engine.getState().home).toMatchObject({ timeouts: 1, timeoutAllowance: 2 });
    let sequence = closeAndStartPeriod(engine, regulationPeriod(1), regulationPeriod(2), 5);
    expect(engine.getState().home).toMatchObject({ timeouts: 1, timeoutAllowance: 2 });
    expect(engine.process(matchEvent({ type: EventType.TIMEOUT, team: TeamSide.HOME, sequence: sequence++ }))).toMatchObject({ accepted: true });
    expect(engine.getState().home).toMatchObject({ timeouts: 0, timeoutAllowance: 2 });
    expect(engine.process(matchEvent({ type: EventType.TIMEOUT, team: TeamSide.HOME, sequence }))).toMatchObject({ accepted: false, reason: "NO_TIMEOUTS_REMAINING" });

    sequence = closeAndStartPeriod(engine, regulationPeriod(2), regulationPeriod(3), sequence);
    expect(engine.getState()).toMatchObject({ home: { timeouts: 3, timeoutAllowance: 3 }, away: { timeouts: 3, timeoutAllowance: 3 } });
    expect(engine.process(matchEvent({ type: EventType.TIMEOUT, team: TeamSide.HOME, sequence: sequence++ }))).toMatchObject({ accepted: true });
    expect(engine.getState().home).toMatchObject({ timeouts: 2, timeoutAllowance: 3 });
    sequence = closeAndStartPeriod(engine, regulationPeriod(3), regulationPeriod(4), sequence);
    expect(engine.getState().home).toMatchObject({ timeouts: 2, timeoutAllowance: 3 });
    expect(engine.process(matchEvent({ type: EventType.TIMEOUT, team: TeamSide.HOME, sequence: sequence++ }))).toMatchObject({ accepted: true });
    expect(engine.getState().home).toMatchObject({ timeouts: 1, timeoutAllowance: 3 });

    sequence = closeAndStartPeriod(engine, regulationPeriod(4), overtimePeriod(1), sequence);
    expect(engine.getState()).toMatchObject({ home: { timeouts: 1, timeoutAllowance: 1 }, away: { timeouts: 1, timeoutAllowance: 1 } });
    expect(engine.process(matchEvent({ type: EventType.TIMEOUT, team: TeamSide.HOME, sequence: sequence++ }))).toMatchObject({ accepted: true });
    expect(engine.getState().home).toMatchObject({ timeouts: 0, timeoutAllowance: 1 });
    sequence = closeAndStartPeriod(engine, overtimePeriod(1), overtimePeriod(2), sequence);
    expect(engine.getState()).toMatchObject({ home: { timeouts: 1, timeoutAllowance: 1 }, away: { timeouts: 1, timeoutAllowance: 1 } });

    const replayed = MatchEngine.fromInitialState(initialState);
    for (const event of engine.getEvents()) expect(replayed.process(event).accepted).toBe(true);
    expect(replayed.getState()).toEqual(engine.getState());
  });

  it("preserves the legacy global timeout pool for snapshots without an allowance marker", () => {
    const current = createStartedEngine().getState();
    const home = { ...current.home, timeouts: 5 };
    const away = { ...current.away, timeouts: 5 };
    delete home.timeoutAllowance;
    delete away.timeoutAllowance;
    const legacy = MatchEngine.fromInitialState({ ...current, home, away });
    expect(legacy.process(matchEvent({ type: EventType.TIMEOUT, team: TeamSide.HOME, sequence: 4 }))).toMatchObject({ accepted: true });
    let sequence = closeAndStartPeriod(legacy, regulationPeriod(1), regulationPeriod(2), 5);
    sequence = closeAndStartPeriod(legacy, regulationPeriod(2), regulationPeriod(3), sequence);
    expect(legacy.getState().home).toMatchObject({ timeouts: 4 });
    expect(legacy.getState().home.timeoutAllowance).toBeUndefined();
  });

  it("aligns possession from factual scoring identity when current possession is stale or unset", () => {
    const staleHome = createStartedEngine();
    expect(staleHome.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.AWAY, playerId: "away-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(staleHome.getState().possession).toBe(TeamSide.HOME);

    const staleAway = createStartedEngine();
    expect(staleAway.process(matchEvent({ type: EventType.JUMP_BALL, possession: TeamSide.AWAY, sequence: 4 }))).toMatchObject({ accepted: true });
    expect(staleAway.process(matchEvent({ type: EventType.THREE_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 5 }))).toMatchObject({ accepted: true });
    expect(staleAway.getState().possession).toBe(TeamSide.AWAY);

    const unresolvedHomeState = createStartedEngine().getState();
    const unresolvedHome = MatchEngine.fromInitialState({ ...unresolvedHomeState, possession: null });
    expect(unresolvedHome.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(unresolvedHome.getState()).toMatchObject({ possession: TeamSide.AWAY, home: { score: 2 }, away: { score: 0 } });

    const unresolvedAwayState = createStartedEngine().getState();
    const unresolvedAway = MatchEngine.fromInitialState({ ...unresolvedAwayState, possession: null });
    expect(unresolvedAway.process(matchEvent({ type: EventType.THREE_POINT, team: TeamSide.AWAY, playerId: "away-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(unresolvedAway.getState()).toMatchObject({ possession: TeamSide.HOME, home: { score: 0 }, away: { score: 3 } });

    const unresolvedMissedState = createStartedEngine().getState();
    const unresolvedMissed = MatchEngine.fromInitialState({ ...unresolvedMissedState, possession: null });
    expect(unresolvedMissed.process(matchEvent({ type: EventType.TWO_POINT_MISSED, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(unresolvedMissed.getState().possession).toBe(TeamSide.HOME);

    const turnoverStaleHome = createStartedEngine();
    expect(turnoverStaleHome.process(matchEvent({ type: EventType.TURNOVER, team: TeamSide.AWAY, playerId: "away-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(turnoverStaleHome.getState().possession).toBe(TeamSide.HOME);

    const turnoverStaleAway = MatchEngine.fromInitialState({ ...createStartedEngine().getState(), possession: TeamSide.AWAY });
    expect(turnoverStaleAway.process(matchEvent({ type: EventType.TURNOVER, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(turnoverStaleAway.getState().possession).toBe(TeamSide.AWAY);

    const turnoverUnresolvedHome = MatchEngine.fromInitialState({ ...createStartedEngine().getState(), possession: null });
    expect(turnoverUnresolvedHome.process(matchEvent({ type: EventType.TURNOVER, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(turnoverUnresolvedHome.getState().possession).toBe(TeamSide.AWAY);

    const turnoverUnresolvedAway = MatchEngine.fromInitialState({ ...createStartedEngine().getState(), possession: null });
    expect(turnoverUnresolvedAway.process(matchEvent({ type: EventType.TURNOVER, team: TeamSide.AWAY, playerId: "away-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(turnoverUnresolvedAway.getState().possession).toBe(TeamSide.HOME);
  });

  it("records a paired opposing steal without a second possession transition", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(matchEvent({ type: EventType.TURNOVER, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(engine.getState().possession).toBe(TeamSide.AWAY);
    expect(engine.process(matchEvent({ type: EventType.STEAL, team: TeamSide.AWAY, playerId: "away-1", sequence: 5 }))).toMatchObject({ accepted: true });
    expect(engine.getState().possession).toBe(TeamSide.AWAY);
    expect(engine.getState().home.players.find((player) => player.playerId === "home-1")?.statistics.turnovers).toBe(1);
    expect(engine.getState().away.players.find((player) => player.playerId === "away-1")?.statistics.steals).toBe(1);
    const events = engine.getEvents();
    expect(dependentEventIds(events, events[events.length - 2]!.id)).toEqual([events[events.length - 1]!.id]);
    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of events) expect(restored.process(event).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());

    const standalone = createStartedEngine();
    expect(standalone.process(matchEvent({ type: EventType.STEAL, team: TeamSide.AWAY, playerId: "away-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(standalone.getState().possession).toBe(TeamSide.AWAY);

    const staleStandalone = MatchEngine.fromInitialState({ ...createStartedEngine().getState(), possession: TeamSide.AWAY });
    expect(staleStandalone.process(matchEvent({ type: EventType.STEAL, team: TeamSide.AWAY, playerId: "away-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(staleStandalone.getState().possession).toBe(TeamSide.AWAY);

    const staleBlock = MatchEngine.fromInitialState({ ...createStartedEngine().getState(), possession: TeamSide.AWAY });
    expect(staleBlock.process(matchEvent({ type: EventType.BLOCK, team: TeamSide.AWAY, playerId: "away-1", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(staleBlock.getState().possession).toBe(TeamSide.AWAY);
  });

  it("updates score and possession after a made two-point shot", () => {
    const engine = createStartedEngine();
    const result = engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }));

    expect(result.accepted).toBe(true);
    expect(result.state.home.score).toBe(2);
    expect(result.state.home.players[0].statistics.points).toBe(2);
    expect(result.state.possession).toBe(TeamSide.AWAY);
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

  it("records a missed shot followed by a defensive rebound", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.THREE_POINT_MISSED, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(matchEvent({ type: EventType.REBOUND, team: TeamSide.AWAY, playerId: "away-1", offensive: false, sequence: 5 })).accepted).toBe(true);

    const state = engine.getState();
    expect(state.home.players[0].statistics.threePointAttempts).toBe(1);
    expect(state.away.players[0].statistics.defensiveRebounds).toBe(1);
    expect(state.possession).toBe(TeamSide.AWAY);
  });

  it("accepts factual player and TEAM rebounds after every missed-shot context", () => {
    const possessions: Array<TeamSide | null> = [TeamSide.HOME, TeamSide.AWAY, null];
    const clocks = ["stopped", "running", "zero"] as const;
    const reboundOutcomes = [
      { side: TeamSide.HOME, teamRebound: false },
      { side: TeamSide.AWAY, teamRebound: false },
      { side: TeamSide.HOME, teamRebound: true },
      { side: TeamSide.AWAY, teamRebound: true },
    ] as const;

    for (const shotSide of [TeamSide.HOME, TeamSide.AWAY]) {
      for (const blocked of [false, true]) {
        for (const possession of possessions) {
          for (const clock of clocks) {
            for (const outcome of reboundOutcomes) {
              const initial = { ...createStartedEngine().getState(), possession };
              const engine = MatchEngine.fromInitialState(initial);
              let sequence = 4;
              if (clock === "running") expect(engine.process(matchEvent({ type: EventType.CLOCK_START, sequence: sequence++ })).accepted).toBe(true);
              if (clock === "zero") expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: sequence++ })).accepted).toBe(true);

              const shooterId = shotSide === TeamSide.HOME ? "home-1" : "away-1";
              expect(engine.process(matchEvent({ type: EventType.TWO_POINT_MISSED, team: shotSide, playerId: shooterId, sequence: sequence++ })).accepted).toBe(true);
              if (blocked) {
                const blockerSide = shotSide === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
                expect(engine.process(matchEvent({ type: EventType.BLOCK, team: blockerSide, playerId: blockerSide === TeamSide.HOME ? "home-1" : "away-1", sequence: sequence++ })).accepted).toBe(true);
              }

              const offensive = outcome.side === shotSide;
              const rebound = outcome.teamRebound
                ? engine.process(matchEvent({ type: EventType.REBOUND, team: outcome.side, offensive, teamRebound: true, sequence }))
                : engine.process(matchEvent({ type: EventType.REBOUND, team: outcome.side, playerId: outcome.side === TeamSide.HOME ? "home-1" : "away-1", offensive, sequence }));
              expect(rebound.accepted).toBe(true);
              expect(engine.getState().possession).toBe(outcome.side);

              const replay = MatchEngine.fromInitialState({ ...createStartedEngine().getState(), possession });
              for (const event of engine.getEvents()) expect(replay.process(event).accepted).toBe(true);
              expect(replay.getState()).toEqual(engine.getState());
            }
          }
        }
      }
    }
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

describe("Gate 1B2A FIBA_2026 foul and team-penalty core", () => {
  it("records a pre-penalty personal foul as facts with no free throws", () => {
    const engine = createStartedEngine();
    const result = engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "stop-personal",
      sequence: 4,
    }));

    expect(result.accepted).toBe(true);
    expect(result.state.away.teamFouls).toBe(1);
    expect(result.state.away.players[0].foulState).toMatchObject({
      total: 1,
      status: PlayerFoulStatus.ELIGIBLE,
    });
    expect(result.state.penaltyResolution?.freeThrowQueue[0]).toBeUndefined();
    expect(result.state.possession).toBe(TeamSide.HOME);
  });

  it("derives two free throws for the fifth eligible defensive non-shooting foul", () => {
    const engine = createStartedEngine();
    for (let sequence = 4; sequence <= 8; sequence += 1) {
      expect(engine.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team: TeamSide.AWAY,
        offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-" + (sequence - 3) },
        context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
        fouledPlayerId: "home-1",
        stoppageId: "stop-" + sequence,
        sequence,
      })).accepted).toBe(true);
    }

    expect(engine.getState().away.teamFouls).toBe(5);
    expect(engine.getState().penaltyResolution?.freeThrowQueue[0]).toMatchObject({
      attempts: 2,
      shootingTeam: TeamSide.HOME,
      shooterPolicy: ShooterPolicy.FOULED_PLAYER,
      designatedPlayerId: "home-1",
      restart: { kind: PenaltyRestartKind.LIVE_BALL },
    });
  });

  it("keeps a team-control personal foul as a throw-in while the team is in penalty", () => {
    const engine = createStartedEngine();
    for (let sequence = 4; sequence <= 7; sequence += 1) {
      expect(engine.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team: TeamSide.AWAY,
        offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-" + (sequence - 3) },
        context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
        fouledPlayerId: "home-1",
        stoppageId: "stop-" + sequence,
        sequence,
      })).accepted).toBe(true);
    }

    const result = engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-5" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: true },
      fouledPlayerId: "home-1",
      stoppageId: "team-control",
      sequence: 8,
    }));

    expect(result.accepted).toBe(true);
    expect(result.state.away.teamFouls).toBe(5);
    expect(result.state.penaltyResolution?.freeThrowQueue[0]).toBeUndefined();
    expect(result.state.possession).toBe(TeamSide.HOME);
  });

  it("projects player technical Category 1 and Category 2 separately", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      category: TechnicalFoulCategory.CATEGORY_1,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "technical-1",
      sequence: 4,
    })).accepted).toBe(true);
    let penalty = engine.getState().penaltyResolution?.freeThrowQueue[0];
    expect(penalty).toMatchObject({
      attempts: 1,
      shooterPolicy: ShooterPolicy.ANY_OPPONENT,
      restart: { kind: PenaltyRestartKind.RESUME_INTERRUPTED, possession: TeamSide.HOME },
    });
    expect(engine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.HOME,
      penaltyId: penalty?.penaltyId ?? "",
      attemptIndex: 1,
      playerId: "home-2",
      made: true,
      sequence: 5,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      category: TechnicalFoulCategory.CATEGORY_2,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "technical-2",
      sequence: 6,
    })).accepted).toBe(true);

    expect(engine.getState().away.players[0].foulState).toMatchObject({
      total: 2,
      category1TechnicalCount: 1,
      category2TechnicalCount: 1,
      status: PlayerFoulStatus.ELIGIBLE,
    });
    expect(engine.getState().away.teamFouls).toBe(2);
  });

  it.each([TechnicalFoulCategory.CATEGORY_1, TechnicalFoulCategory.CATEGORY_2])("ends a %s technical penalty without recording a free throw", (category) => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      category,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: `technical-early-end-${category}`,
      sequence: 4,
    }))).toMatchObject({ accepted: true });
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: 5 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({
      home: { score: 0, statistics: { freeThrowAttempts: 0, freeThrowMade: 0 } },
      penaltyResolution: { freeThrowQueue: [], finalRestart: { kind: PenaltyRestartKind.RESUME_INTERRUPTED, possession: TeamSide.HOME } },
      possession: TeamSide.HOME,
    });
  });

  it("ends a LIVE_BALL bonus penalty before FT1 without fabricating a possession outcome", () => {
    const { engine, initialState } = createEngineFixture();
    for (const [sequence, playerId] of [[4, "away-1"], [5, "away-2"], [6, "away-3"], [7, "away-4"]] as const) {
      expect(engine.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team: TeamSide.AWAY,
        offender: { kind: FoulOffenderKind.PLAYER, playerId },
        context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
        fouledPlayerId: "home-1",
        stoppageId: `bonus-prior-${sequence}`,
        sequence,
      }))).toMatchObject({ accepted: true });
    }
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-5" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "bonus-early-end",
      sequence: 8,
    }))).toMatchObject({ accepted: true });
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    const possessionBeforeEnd = engine.getState().possession;
    expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: 9 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({
      possession: possessionBeforeEnd,
      home: { statistics: { freeThrowAttempts: 0, freeThrowMade: 0 } },
      penaltyResolution: { freeThrowQueue: [] },
    });
    expect(engine.getEvents().filter((event) => event.type === EventType.FREE_THROW || event.type === EventType.REBOUND)).toHaveLength(0);
    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of engine.getEvents()) expect(restored.process(event).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());
  });

  it("ends a LIVE_BALL shooting penalty after a factual FT without inventing later facts", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(matchEvent({ type: EventType.THREE_POINT_MISSED, team: TeamSide.HOME, playerId: "home-1", stoppageId: "shooting-early-end", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "shooting-early-end",
      sequence: 5,
    }))).toMatchObject({ accepted: true });
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", penaltyId, attemptIndex: 1, made: true, sequence: 6 }))).toMatchObject({ accepted: true });
    const possessionBeforeEnd = engine.getState().possession;
    expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: 7 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({
      possession: possessionBeforeEnd,
      home: { statistics: { freeThrowAttempts: 1, freeThrowMade: 1 } },
      penaltyResolution: { freeThrowQueue: [] },
    });
    expect(engine.getEvents().filter((event) => event.type === EventType.FREE_THROW)).toHaveLength(1);
    expect(engine.getEvents().filter((event) => event.type === EventType.REBOUND)).toHaveLength(0);
    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of engine.getEvents()) expect(restored.process(event).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());
  });

  it("records a verified bench technical without incrementing team fouls", () => {
    const engine = createStartedEngine();
    const result = engine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.BENCH, personId: "bench-away", role: BenchRole.ACCOMPANYING_DELEGATION },
      category: TechnicalFoulCategory.CATEGORY_1,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "bench-technical",
      sequence: 4,
    }));

    expect(result.accepted).toBe(true);
    expect(result.state.away.teamFouls).toBe(0);
    expect(result.state.away.discipline).toMatchObject({
      headCoachCategory1TechnicalCount: 0,
      benchCategory1TechnicalCount: 1,
      headCoachDisqualified: false,
    });
    expect(result.state.penaltyResolution?.freeThrowQueue[0]).toMatchObject({
      attempts: 1,
      shooterPolicy: ShooterPolicy.ANY_OPPONENT,
    });
  });

  it.each([
    ["C", ["C"], 1, 0, false],
    ["C+C", ["C", "C"], 2, 0, true],
    ["B", ["B"], 0, 1, false],
    ["B+B", ["B", "B"], 0, 2, false],
    ["C+B", ["C", "B"], 1, 1, false],
    ["B+C", ["B", "C"], 1, 1, false],
    ["C+B+B", ["C", "B", "B"], 1, 2, true],
    ["B+C+B", ["B", "C", "B"], 1, 2, true],
    ["B+B+C", ["B", "B", "C"], 1, 2, true],
    ["B+B+B", ["B", "B", "B"], 0, 3, true],
  ] as const)("keeps staff technical discipline count-based for %s", (_label, sources, expectedCoach, expectedBench, expectedDisqualified) => {
    const { engine, initialState } = createEngineFixture();
    let sequence = 4;
    for (const source of sources) {
      expect(engine.process(matchEvent({
        type: EventType.TECHNICAL_FOUL,
        team: TeamSide.AWAY,
        offender: source === "C"
          ? { kind: FoulOffenderKind.BENCH, personId: "coach-away", role: BenchRole.HEAD_COACH }
          : { kind: FoulOffenderKind.BENCH, personId: "bench-away", role: BenchRole.ACCOMPANYING_DELEGATION },
        category: TechnicalFoulCategory.CATEGORY_1,
        context: { kind: FoulContextKind.NON_CONTACT },
        stoppageId: `staff-technical-${sequence}`,
        sequence,
      }))).toMatchObject({ accepted: true });
      const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
      expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: sequence + 1 }))).toMatchObject({ accepted: true });
      sequence += 2;
    }
    expect(engine.getState().away.discipline).toMatchObject({
      headCoachCategory1TechnicalCount: expectedCoach,
      benchCategory1TechnicalCount: expectedBench,
      headCoachDisqualified: expectedDisqualified,
    });
    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of engine.getEvents()) expect(restored.process(event).accepted).toBe(true);
    expect(restored.getState().away.discipline).toEqual(engine.getState().away.discipline);
  });

  it.each([
    [EventType.DISRUPTIVE_FOUL, "disruptiveCount"],
    [EventType.FLAGRANT_FOUL, "flagrantCount"],
  ] as const)("projects %s and awards its causal frontcourt penalty", (type, counter) => {
    const engine = createStartedEngine();
    const event = type === EventType.DISRUPTIVE_FOUL
      ? matchEvent({
          type: EventType.DISRUPTIVE_FOUL,
          team: TeamSide.AWAY,
          offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
          context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
          fouledPlayerId: "home-1",
          stoppageId: "severe-foul",
          sequence: 4,
        })
      : matchEvent({
          type: EventType.FLAGRANT_FOUL,
          team: TeamSide.AWAY,
          offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
          context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
          fouledPlayerId: "home-1",
          stoppageId: "severe-foul",
          sequence: 4,
        });
    const result = engine.process(event);

    expect(result.accepted).toBe(true);
    expect(result.state.away.players[0].foulState[counter]).toBe(1);
    expect(result.state.penaltyResolution?.freeThrowQueue[0]).toMatchObject({
      attempts: 2,
      shootingTeam: TeamSide.HOME,
      restart: { kind: PenaltyRestartKind.FRONTCOURT_THROW_IN, team: TeamSide.HOME },
    });
  });

  it.each([
    [EventType.TWO_POINT, 1],
    [EventType.TWO_POINT_MISSED, 2],
    [EventType.THREE_POINT_MISSED, 3],
  ] as const)("awards DISRUPTIVE shooting foul %s the required %i frontcourt free throws", (shotType, attempts) => {
    const engine = createStartedEngine();
    const shot = matchEvent({ type: shotType, team: TeamSide.HOME, playerId: "home-1", stoppageId: "shooting-disruptive", sequence: 4 });
    expect(engine.process(shot).accepted).toBe(true);
    const result = engine.process(matchEvent({
      type: EventType.DISRUPTIVE_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: shot.id,
      stoppageId: "shooting-disruptive",
      sequence: 5,
    }));
    expect(result).toMatchObject({ accepted: true, state: { penaltyResolution: { freeThrowQueue: [{ attempts, designatedPlayerId: "home-1", restart: { kind: PenaltyRestartKind.FRONTCOURT_THROW_IN, team: TeamSide.HOME } }] } } });
  });

  it("ends a DISRUPTIVE penalty without fabricating remaining free throws", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.DISRUPTIVE_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "early-disruptive",
      sequence: 4,
    })).accepted).toBe(true);
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: 5 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({
      home: { score: 0, statistics: { freeThrowAttempts: 0, freeThrowMade: 0 } },
      penaltyResolution: { freeThrowQueue: [], finalRestart: { kind: PenaltyRestartKind.FRONTCOURT_THROW_IN, team: TeamSide.HOME } },
      possession: TeamSide.HOME,
    });
  });

  it("ends an active flagrant penalty without inventing remaining free throws", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "early-flagrant",
      sequence: 4,
    })).accepted).toBe(true);
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: 5 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({
      home: { score: 0, statistics: { freeThrowAttempts: 0, freeThrowMade: 0 } },
      penaltyResolution: { freeThrowQueue: [], finalRestart: { kind: PenaltyRestartKind.FRONTCOURT_THROW_IN, team: TeamSide.HOME } },
      possession: TeamSide.HOME,
    });
    expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: 6 }))).toMatchObject({ accepted: false, reason: "NO_ACTIVE_PENALTY" });
    const events = engine.getEvents();
    expect(dependentEventIds(events, events[3]!.id)).toEqual([events[4]!.id]);
    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of events) expect(restored.process(event).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());
  });

  it.each([
    [true, 1, 1],
    [false, 0, 0],
  ])("ends the remaining flagrant administration after FT1 %s", (made, expectedScore, expectedMade) => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "early-flagrant-after-ft1",
      sequence: 4,
    })).accepted).toBe(true);
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", penaltyId, attemptIndex: 1, made, sequence: 5 }))).toMatchObject({ accepted: true });
    expect(engine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId, sequence: 6 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({
      home: { score: expectedScore, statistics: { freeThrowAttempts: 1, freeThrowMade: expectedMade } },
      penaltyResolution: { freeThrowQueue: [], finalRestart: { kind: PenaltyRestartKind.FRONTCOURT_THROW_IN, team: TeamSide.HOME } },
      possession: TeamSide.HOME,
    });
    const events = engine.getEvents();
    expect(dependentEventIds(events, events[3]!.id)).toEqual([events[4]!.id, events[5]!.id]);
    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of events) expect(restored.process(event).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());
  });

  it("projects direct player disqualification and an any-opponent penalty", () => {
    const engine = createStartedEngine();
    const result = engine.process(matchEvent({
      type: EventType.DISQUALIFYING_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "direct-dq",
      sequence: 4,
    }));

    expect(result.accepted).toBe(true);
    expect(result.state.home.players[0]).toMatchObject({
      onCourt: true,
      foulState: {
        total: 1,
        directDisqualification: true,
        status: PlayerFoulStatus.DISQUALIFIED,
        statusReason: PlayerFoulStatusReason.DIRECT_DISQUALIFICATION,
      },
    });
    expect(result.state.penaltyResolution?.freeThrowQueue[0]).toMatchObject({
      attempts: 2,
      shooterPolicy: ShooterPolicy.ANY_OPPONENT,
    });
    expect(result.state.home.players.filter((player) => player.onCourt)).toHaveLength(5);
    expect(engine.process(matchEvent({ type: EventType.SUBSTITUTION, team: TeamSide.HOME, playerOutId: "home-1", playerInId: "home-6", sequence: 5 }))).toMatchObject({ accepted: true });
    expect(engine.getState().home.players.filter((player) => player.onCourt)).toHaveLength(5);
    expect(engine.getState().home.players.find((player) => player.playerId === "home-1")?.onCourt).toBe(false);
    expect(engine.getState().home.players.find((player) => player.playerId === "home-6")?.onCourt).toBe(true);
    expect(engine.getState().penaltyResolution?.freeThrowQueue).toHaveLength(1);
  });

  it("excludes a player on five fouls without classifying the exclusion as disqualification", () => {
    const engine = createStartedEngine();
    for (let sequence = 4; sequence <= 8; sequence += 1) {
      expect(engine.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team: TeamSide.HOME,
        offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
        context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: true },
        fouledPlayerId: "away-1",
        stoppageId: "five-foul-" + sequence,
        sequence,
      })).accepted).toBe(true);
    }

    expect(engine.getState().home.players[0]).toMatchObject({
      onCourt: true,
      foulState: {
        total: 5,
        status: PlayerFoulStatus.EXCLUDED,
        statusReason: PlayerFoulStatusReason.FIVE_FOULS,
      },
    });
    expect(engine.getState().home.players.filter((player) => player.onCourt)).toHaveLength(5);
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 9 }))).toMatchObject({ accepted: false });
    expect(engine.process(matchEvent({ type: EventType.SUBSTITUTION, team: TeamSide.HOME, playerOutId: "home-1", playerInId: "home-6", sequence: 9 }))).toMatchObject({ accepted: true });
    expect(engine.getState().home.players.filter((player) => player.onCourt)).toHaveLength(5);
  });

  it("applies only the verified Category 1/flagrant disqualification combinations", () => {
    const categoryEngine = createStartedEngine();
    for (const sequence of [4, 6]) {
      expect(categoryEngine.process(matchEvent({
        type: EventType.TECHNICAL_FOUL,
        team: TeamSide.HOME,
        offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
        category: TechnicalFoulCategory.CATEGORY_1,
        context: { kind: FoulContextKind.NON_CONTACT },
        stoppageId: "category-" + sequence,
        sequence,
      })).accepted).toBe(true);
      const penalty = categoryEngine.getState().penaltyResolution?.freeThrowQueue[0];
      expect(categoryEngine.process(matchEvent({
        type: EventType.FREE_THROW,
        team: TeamSide.AWAY,
        penaltyId: penalty?.penaltyId ?? "",
        attemptIndex: 1,
        playerId: "away-1",
        made: false,
        sequence: sequence + 1,
      })).accepted).toBe(true);
    }
    expect(categoryEngine.getState().home.players[0].foulState).toMatchObject({
      status: PlayerFoulStatus.DISQUALIFIED,
      statusReason: PlayerFoulStatusReason.TWO_CATEGORY_1_TECHNICALS,
    });
    expect(categoryEngine.getState().home.players[0].onCourt).toBe(true);

    const mixedEngine = createStartedEngine();
    expect(mixedEngine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      category: TechnicalFoulCategory.CATEGORY_1,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "mixed-technical",
      sequence: 4,
    })).accepted).toBe(true);
    let penalty = mixedEngine.getState().penaltyResolution?.freeThrowQueue[0];
    expect(mixedEngine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.AWAY,
      penaltyId: penalty?.penaltyId ?? "",
      attemptIndex: 1,
      playerId: "away-1",
      made: false,
      sequence: 5,
    })).accepted).toBe(true);
    expect(mixedEngine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId: "mixed-flagrant",
      sequence: 6,
    })).accepted).toBe(true);
    expect(mixedEngine.getState().home.players[0].foulState).toMatchObject({
      status: PlayerFoulStatus.DISQUALIFIED,
      statusReason: PlayerFoulStatusReason.MIXED_CATEGORY_1_TECHNICAL_AND_FLAGRANT,
    });
    expect(mixedEngine.getState().home.players[0].onCourt).toBe(true);

    const reverseMixedEngine = createStartedEngine();
    expect(reverseMixedEngine.process(matchEvent({ type: EventType.FLAGRANT_FOUL, team: TeamSide.HOME, offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" }, context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false }, fouledPlayerId: "away-1", stoppageId: "reverse-mixed-flagrant", sequence: 4 }))).toMatchObject({ accepted: true });
    const reversePenaltyId = reverseMixedEngine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    expect(reverseMixedEngine.process(matchEvent({ type: EventType.PENALTY_ADMINISTRATION_ENDED, penaltyId: reversePenaltyId, sequence: 5 }))).toMatchObject({ accepted: true });
    expect(reverseMixedEngine.process(matchEvent({ type: EventType.TECHNICAL_FOUL, team: TeamSide.HOME, offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" }, category: TechnicalFoulCategory.CATEGORY_1, context: { kind: FoulContextKind.NON_CONTACT }, stoppageId: "reverse-mixed-technical", sequence: 6 }))).toMatchObject({ accepted: true });
    expect(reverseMixedEngine.getState().home.players[0]).toMatchObject({ onCourt: true, foulState: { status: PlayerFoulStatus.DISQUALIFIED, statusReason: PlayerFoulStatusReason.MIXED_CATEGORY_1_TECHNICAL_AND_FLAGRANT } });
  });

  it("disqualifies a player after two flagrant fouls", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId: "flagrant-1",
      sequence: 4,
    })).accepted).toBe(true);
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    for (const attemptIndex of [1, 2]) {
      expect(engine.process(matchEvent({
        type: EventType.FREE_THROW,
        team: TeamSide.AWAY,
        penaltyId,
        attemptIndex,
        playerId: "away-1",
        made: false,
        sequence: 4 + attemptIndex,
      })).accepted).toBe(true);
    }
    expect(engine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId: "flagrant-2",
      sequence: 7,
    })).accepted).toBe(true);
    expect(engine.getState().home.players[0].foulState).toMatchObject({
      flagrantCount: 2,
      status: PlayerFoulStatus.DISQUALIFIED,
      statusReason: PlayerFoulStatusReason.TWO_FLAGRANT_FOULS,
    });
    expect(engine.getState().home.players[0].onCourt).toBe(true);
  });

  it.each([
    [EventType.TWO_POINT, 1, 2],
    [EventType.THREE_POINT, 1, 3],
    [EventType.TWO_POINT_MISSED, 2, 0],
    [EventType.THREE_POINT_MISSED, 3, 0],
  ] as const)("derives shooting penalty for %s from its causal shot", (shotType, attempts, score) => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: shotType,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "shot-stop",
      sequence: 4,
    })).accepted).toBe(true);
    const result = engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "shot-stop",
      sequence: 5,
    }));

    expect(result.accepted).toBe(true);
    expect(result.state.home.score).toBe(score);
    expect(result.state.penaltyResolution?.freeThrowQueue[0]).toMatchObject({
      sourceFoulEventId: "event-5",
      penaltyId: penaltyIdFor("event-5"),
      attempts,
      designatedPlayerId: "home-1",
    });
  });

  it("derives free-throw order and final-attempt behavior from the penalty", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT_MISSED,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "free-throw-order",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "free-throw-order",
      sequence: 5,
    })).accepted).toBe(true);
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";

    expect(engine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.HOME,
      penaltyId,
      attemptIndex: 2,
      playerId: "home-1",
      made: false,
      sequence: 6,
    }))).toMatchObject({ accepted: false, reason: "INVALID_FREE_THROW_ORDER" });
    expect(engine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.HOME,
      penaltyId,
      attemptIndex: 1,
      playerId: "home-1",
      made: true,
      sequence: 6,
    })).accepted).toBe(true);
    expect(engine.getState().penaltyResolution?.freeThrowQueue[0]).toMatchObject({ completedAttempts: 1, attempts: 2 });
    expect(engine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.HOME,
      penaltyId,
      attemptIndex: 2,
      playerId: "home-1",
      made: false,
      sequence: 7,
    })).accepted).toBe(true);
    expect(engine.getState().penaltyResolution?.freeThrowQueue[0]).toBeUndefined();
    expect(engine.getState().possession).toBeNull();
    expect(engine.process(matchEvent({
      type: EventType.REBOUND,
      team: TeamSide.AWAY,
      playerId: "away-1",
      offensive: false,
      sequence: 8,
    })).accepted).toBe(true);
    expect(engine.getState().possession).toBe(TeamSide.AWAY);
  });

  it("accepts an eligible beneficiary teammate as the durable replacement free-throw shooter", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT_MISSED, team: TeamSide.HOME, playerId: "home-1", stoppageId: "replacement-ft", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(engine.process(matchEvent({ type: EventType.PERSONAL_FOUL, team: TeamSide.AWAY, offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" }, context: { kind: FoulContextKind.SHOOTING }, fouledPlayerId: "home-1", relatedShotEventId: "event-4", stoppageId: "replacement-ft", sequence: 5 }))).toMatchObject({ accepted: true });
    const penaltyId = penaltyIdFor("event-5");
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-2", penaltyId, attemptIndex: 1, made: true, sequence: 6 }))).toMatchObject({ accepted: true });
    expect(engine.getState().home.score).toBe(1);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-2", penaltyId, attemptIndex: 2, made: false, sequence: 7 }))).toMatchObject({ accepted: true });
    expect(engine.getEvents().filter((event) => event.type === EventType.FREE_THROW).map((event) => event.playerId)).toEqual(["home-2", "home-2"]);
    expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", penaltyId, attemptIndex: 3, made: true, sequence: 8 }))).toMatchObject({ accepted: false, reason: "NO_ACTIVE_PENALTY" });
  });

  it("allows substitution during an active causal penalty without changing its authority", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT_MISSED,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "substitution-penalty",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "substitution-penalty",
      sequence: 5,
    })).accepted).toBe(true);
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId;
    expect(engine.process(matchEvent({
      type: EventType.SUBSTITUTION,
      team: TeamSide.HOME,
      playerOutId: "home-1",
      playerInId: "home-6",
      sequence: 6,
    })).accepted).toBe(true);
    expect(engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId).toBe(penaltyId);
  });

  it("resets team fouls between regulation periods", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "period-reset",
      sequence: 4,
    })).accepted).toBe(true);
    closeAndStartPeriod(engine, regulationPeriod(1), regulationPeriod(2), 5);
    expect(engine.getState().away.teamFouls).toBe(0);
  });

  it("carries the final regulation team-foul bucket through OT4 and beyond", () => {
    const engine = createStartedEngine({ matchRules: rules({ regulationPeriods: 1 }) });
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "overtime-carry",
      sequence: 4,
    })).accepted).toBe(true);
    let sequence = closeAndStartPeriod(engine, regulationPeriod(1), overtimePeriod(1), 5);
    sequence = closeAndStartPeriod(engine, overtimePeriod(1), overtimePeriod(2), sequence);
    sequence = closeAndStartPeriod(engine, overtimePeriod(2), overtimePeriod(3), sequence);
    closeAndStartPeriod(engine, overtimePeriod(3), overtimePeriod(4), sequence);
    expect(engine.getState()).toMatchObject({
      period: { kind: "OVERTIME", index: 4 },
      away: { teamFouls: 1 },
    });
  });

  it("enforces shot/foul/penalty causal dependencies during deterministic replay", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT_MISSED,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "causal-replay",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "causal-replay",
      sequence: 5,
    })).accepted).toBe(true);
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    for (const attemptIndex of [1, 2]) {
      expect(engine.process(matchEvent({
        type: EventType.FREE_THROW,
        team: TeamSide.HOME,
        penaltyId,
        attemptIndex,
        playerId: "home-1",
        made: attemptIndex === 1,
        sequence: 5 + attemptIndex,
      })).accepted).toBe(true);
    }

    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of engine.getEvents()) expect(restored.process(event).accepted).toBe(true);
    expect(restored.getState()).toEqual(engine.getState());
    const beforeInvalidRemoval = engine.getState();
    expect(engine.removeEvent("event-4")).toMatchObject({
      accepted: false,
      reason: "DEPENDENT_EVENTS_EXIST",
      dependentEventIds: ["event-5", "event-6", "event-7"],
    });
    expect(engine.removeEvent("event-5")).toMatchObject({
      accepted: false,
      reason: "DEPENDENT_EVENTS_EXIST",
      dependentEventIds: ["event-6", "event-7"],
    });
    expect(engine.getState()).toEqual(beforeInvalidRemoval);
  });

  it("keeps V2 events deterministic and free of caller-authored penalty consequences", () => {
    const event = matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: true },
      fouledPlayerId: "away-1",
      stoppageId: "schema-v2",
      sequence: 4,
    });
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    expect(event).toMatchObject({ schemaVersion: 2, type: EventType.PERSONAL_FOUL });
    expect(event).not.toHaveProperty("freeThrows");
    expect(event).not.toHaveProperty("teamFouls");
    const freeThrow = matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.AWAY,
      penaltyId: "penalty:event-4",
      attemptIndex: 1,
      playerId: "away-1",
      made: true,
      sequence: 5,
    });
    expect(freeThrow).not.toHaveProperty("isFinalAttempt");
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

  it("exposes the FIBA_2026 team-foul reset/carry policy", () => {
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

describe("Gate 1B2B special situations and dependency-safe corrections", () => {
  it("charges both personal fouls while cancelling a factual double-foul penalty", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId: "double-personal",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "double-personal",
      sequence: 5,
    })).accepted).toBe(true);

    const state = engine.getState();
    expect(state.possession).toBe(TeamSide.HOME);
    expect(state.home.teamFouls).toBe(1);
    expect(state.away.teamFouls).toBe(1);
    expect(state.home.players[0].foulState.total).toBe(1);
    expect(state.away.players[0].foulState.total).toBe(1);
    expect(state.penaltyResolution).toMatchObject({
      cancelledPenaltyIds: [penaltyIdFor("event-4"), penaltyIdFor("event-5")],
      orderedEntitlements: [],
      freeThrowQueue: [],
    });
  });

  it("cancels severe double-foul penalties without cancelling discipline", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.DISRUPTIVE_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId: "double-severe",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId: "double-severe",
      sequence: 5,
    })).accepted).toBe(true);

    expect(engine.getState().penaltyResolution?.freeThrowQueue).toEqual([]);
    expect(engine.getState().home.players[0].foulState.disruptiveCount).toBe(1);
    expect(engine.getState().away.players[0].foulState.flagrantCount).toBe(1);
  });

  it("cancels equal penalties chronologically and keeps the third entitlement", () => {
    const engine = createStartedEngine();
    for (const [sequence, team, playerId] of [
      [4, TeamSide.HOME, "home-1"],
      [5, TeamSide.AWAY, "away-1"],
      [6, TeamSide.HOME, "home-2"],
    ] as const) {
      expect(engine.process(matchEvent({
        type: EventType.TECHNICAL_FOUL,
        team,
        offender: { kind: FoulOffenderKind.PLAYER, playerId },
        category: TechnicalFoulCategory.CATEGORY_1,
        context: { kind: FoulContextKind.NON_CONTACT },
        stoppageId: "three-technicals",
        sequence,
      })).accepted).toBe(true);
    }
    expect(engine.getState().penaltyResolution).toMatchObject({
      cancelledPenaltyIds: [penaltyIdFor("event-4"), penaltyIdFor("event-5")],
      freeThrowQueue: [{ penaltyId: penaltyIdFor("event-6"), beneficiaryTeam: TeamSide.AWAY }],
    });
  });

  it("orders technical penalties first and applies only the final restart", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId: "ordered-penalties",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-2" },
      category: TechnicalFoulCategory.CATEGORY_1,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "ordered-penalties",
      sequence: 5,
    })).accepted).toBe(true);
    expect(engine.getState().penaltyResolution?.freeThrowQueue.map((penalty) => penalty.penaltyId))
      .toEqual([penaltyIdFor("event-5"), penaltyIdFor("event-4")]);

    expect(engine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.AWAY,
      penaltyId: penaltyIdFor("event-5"),
      attemptIndex: 1,
      playerId: "away-2",
      made: true,
      sequence: 6,
    })).accepted).toBe(true);
    expect(engine.getState().possession).toBe(TeamSide.HOME);
    for (const attemptIndex of [1, 2]) {
      expect(engine.process(matchEvent({
        type: EventType.FREE_THROW,
        team: TeamSide.AWAY,
        penaltyId: penaltyIdFor("event-4"),
        attemptIndex,
        playerId: "away-1",
        made: false,
        sequence: 6 + attemptIndex,
      })).accepted).toBe(true);
    }
    expect(engine.getState().possession).toBe(TeamSide.AWAY);
  });

  it.each([
    ["team control", "CONTROL"],
    ["valid goal", "GOAL"],
    ["no control", "NO_CONTROL"],
  ] as const)("derives the all-cancelled restart for %s", (_label, scenario) => {
    const engine = createStartedEngine();
    let sequence = 4;
    const stoppageId = `all-cancelled-${scenario}`;
    if (scenario === "GOAL") {
      expect(engine.process(matchEvent({
        type: EventType.TWO_POINT,
        team: TeamSide.HOME,
        playerId: "home-1",
        stoppageId,
        sequence: sequence++,
      })).accepted).toBe(true);
    } else if (scenario === "NO_CONTROL") {
      expect(engine.process(matchEvent({
        type: EventType.TWO_POINT_MISSED,
        team: TeamSide.HOME,
        playerId: "home-1",
        stoppageId: "unresolved-live-ball",
        sequence: sequence++,
      })).accepted).toBe(true);
      expect(engine.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team: TeamSide.AWAY,
        offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
        context: { kind: FoulContextKind.SHOOTING },
        fouledPlayerId: "home-1",
        relatedShotEventId: `event-${sequence - 1}`,
        stoppageId: "unresolved-live-ball",
        sequence: sequence++,
      })).accepted).toBe(true);
      const unresolvedPenaltyId = penaltyIdFor(`event-${sequence - 1}`);
      for (const attemptIndex of [1, 2]) {
        expect(engine.process(matchEvent({
          type: EventType.FREE_THROW,
          team: TeamSide.HOME,
          penaltyId: unresolvedPenaltyId,
          attemptIndex,
          playerId: "home-1",
          made: false,
          sequence: sequence++,
        })).accepted).toBe(true);
      }
    }
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId,
      sequence: sequence++,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "home-1",
      stoppageId,
      sequence,
    })).accepted).toBe(true);

    const state = engine.getState();
    if (scenario === "GOAL") {
      expect(state.penaltyResolution?.finalRestart).toEqual({
        kind: PenaltyRestartKind.ENDLINE_THROW_IN,
        team: TeamSide.AWAY,
      });
      expect(state.possession).toBe(TeamSide.AWAY);
    } else if (scenario === "CONTROL") {
      expect(state.possession).toBe(TeamSide.HOME);
    } else {
      expect(state.penaltyResolution?.finalRestart).toEqual({
        kind: PenaltyRestartKind.ALTERNATING_POSSESSION,
      });
      expect(state.possession).not.toBeNull();
    }
  });

  it("locks same-stoppage cancellation after the first free throw", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.FLAGRANT_FOUL,
      team: TeamSide.HOME,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "home-1" },
      context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
      fouledPlayerId: "away-1",
      stoppageId: "locked-stoppage",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.AWAY,
      penaltyId: penaltyIdFor("event-4"),
      attemptIndex: 1,
      playerId: "away-1",
      made: true,
      sequence: 5,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-2" },
      category: TechnicalFoulCategory.CATEGORY_1,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "locked-stoppage",
      sequence: 6,
    }))).toMatchObject({ accepted: false, reason: "STOPPAGE_RESOLUTION_LOCKED" });
  });

  it("returns exact transitive dependencies and atomically cascades removal", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "cascade",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "cascade",
      sequence: 5,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.FREE_THROW,
      team: TeamSide.HOME,
      penaltyId: penaltyIdFor("event-5"),
      attemptIndex: 1,
      playerId: "home-1",
      made: true,
      sequence: 6,
    })).accepted).toBe(true);

    const before = engine.getState();
    expect(engine.removeEvent("event-4")).toMatchObject({
      accepted: false,
      reason: "DEPENDENT_EVENTS_EXIST",
      dependentEventIds: ["event-5", "event-6"],
    });
    expect(engine.getState()).toEqual(before);
    expect(engine.removeEvent("event-4", { cascadeDependencies: true }).accepted).toBe(true);
    expect(engine.getEvents().map((event) => event.id)).not.toContain("event-4");
    expect(engine.getState()).toMatchObject({
      home: {
        score: 0,
        teamFouls: 0,
        statistics: { freeThrowAttempts: 0, freeThrowMade: 0 },
      },
      away: { teamFouls: 0 },
    });
  });

  it("cascades correction, preserves source identity, and replays byte-equivalently", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "cascade-correction",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "cascade-correction",
      sequence: 5,
    })).accepted).toBe(true);
    expect(engine.correctEvent(
      "event-4",
      matchEvent({
        type: EventType.THREE_POINT,
        team: TeamSide.HOME,
        playerId: "home-1",
        stoppageId: "cascade-correction",
        sequence: 99,
      }),
      { cascadeDependencies: true },
    ).accepted).toBe(true);
    expect(engine.getEvents().find((event) => event.id === "event-4")).toMatchObject({
      id: "event-4",
      sequence: 4,
      type: EventType.THREE_POINT,
    });
    expect(engine.getEvents().map((event) => event.id)).not.toContain("event-5");

    const restored = MatchEngine.fromInitialState(initialState);
    for (const event of engine.getEvents()) expect(restored.process(event).accepted).toBe(true);
    expect(JSON.stringify(restored.getState())).toBe(JSON.stringify(engine.getState()));
  });

  it("re-derives a remaining peer and rejects a non-causal invalidation atomically", () => {
    const engine = createStartedEngine();
    for (const [sequence, team, offenderId, fouledPlayerId] of [
      [4, TeamSide.HOME, "home-1", "away-1"],
      [5, TeamSide.AWAY, "away-1", "home-1"],
    ] as const) {
      expect(engine.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team,
        offender: { kind: FoulOffenderKind.PLAYER, playerId: offenderId },
        context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
        fouledPlayerId,
        stoppageId: "peer-rederive",
        sequence,
      })).accepted).toBe(true);
    }
    expect(engine.removeEvent("event-5").accepted).toBe(true);
    expect(engine.getState()).toMatchObject({
      possession: TeamSide.AWAY,
      penaltyResolution: {
        orderedEntitlements: [{ penaltyId: penaltyIdFor("event-4") }],
      },
    });

    const { engine: blocked, initialState: blockedInitialState } = createEngineFixture();
    for (const [sequence, team, offenderId, fouledPlayerId] of [
      [4, TeamSide.HOME, "home-1", "away-1"],
      [5, TeamSide.AWAY, "away-1", "home-1"],
    ] as const) {
      expect(blocked.process(matchEvent({
        type: EventType.PERSONAL_FOUL,
        team,
        offender: { kind: FoulOffenderKind.PLAYER, playerId: offenderId },
        context: { kind: FoulContextKind.NON_SHOOTING, teamControlFoul: false },
        fouledPlayerId,
        stoppageId: "blocking-rederive",
        sequence,
      })).accepted).toBe(true);
    }
    expect(blocked.process(matchEvent({
      type: EventType.TWO_POINT,
      team: TeamSide.HOME,
      playerId: "home-1",
      sequence: 6,
    })).accepted).toBe(true);
    const removed = blocked.removeEvent("event-5");
    expect(removed).toMatchObject({ accepted: true });
    expect(blocked.getEvents().map((event) => event.id)).toEqual(["event-1", "event-2", "event-3", "event-4", "event-6"]);
    expect(new Set(blocked.getEvents().map((event) => event.id)).size).toBe(blocked.getEvents().length);
    expect(blocked.getState()).toMatchObject({ possession: TeamSide.AWAY, home: { score: 2 }, away: { score: 0 } });
    const replayed = MatchEngine.fromInitialState(blockedInitialState);
    for (const event of blocked.getEvents()) expect(replayed.process(event).accepted).toBe(true);
    expect(replayed.getState()).toEqual(blocked.getState());
  });

  it("rejects a new shooting shot while an earlier shooting-foul penalty remains unresolved", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT_MISSED,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "pending-shooting-foul",
      sequence: 4,
    }))).toMatchObject({ accepted: true });
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "pending-shooting-foul",
      sequence: 5,
    }))).toMatchObject({ accepted: true });

    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT,
      team: TeamSide.AWAY,
      playerId: "away-1",
      sequence: 6,
    }))).toMatchObject({ accepted: false, reason: "PENALTY_IN_PROGRESS" });
  });

  it("keeps clock controls orthogonal to an active free-throw penalty", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({
      type: EventType.TWO_POINT_MISSED,
      team: TeamSide.HOME,
      playerId: "home-1",
      stoppageId: "clock-penalty",
      sequence: 4,
    }))).toMatchObject({ accepted: true });
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: "home-1",
      relatedShotEventId: "event-4",
      stoppageId: "clock-penalty",
      sequence: 5,
    }))).toMatchObject({ accepted: true });
    const penaltyBefore = engine.getState().penaltyResolution;

    expect(engine.process(matchEvent({ type: EventType.CLOCK_START, sequence: 6 }))).toMatchObject({ accepted: true });
    expect(engine.getState().penaltyResolution).toEqual(penaltyBefore);
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 27, sequence: 7 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({ clock: 27, clockRunning: true, penaltyResolution: penaltyBefore });
    expect(engine.process(matchEvent({ type: EventType.CLOCK_STOP, sequence: 8 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({ clock: 27, clockRunning: false, penaltyResolution: penaltyBefore });
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: 9 }))).toMatchObject({ accepted: true });
    expect(engine.getState()).toMatchObject({ clock: 0, clockRunning: false, penaltyResolution: penaltyBefore });

    expect(engine.process(matchEvent({ type: EventType.CLOCK_START, sequence: 10 }))).toMatchObject({ accepted: false, reason: "INVALID_CLOCK_VALUE" });
    expect(engine.process(matchEvent({ type: EventType.CLOCK_SET, remainingSeconds: 601, sequence: 10 }))).toMatchObject({ accepted: false, reason: "INVALID_CLOCK_VALUE" });
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT, team: TeamSide.AWAY, playerId: "away-1", sequence: 10 }))).toMatchObject({ accepted: false, reason: "PENALTY_IN_PROGRESS" });
    expect(engine.getState().penaltyResolution).toEqual(penaltyBefore);
  });

  it.each([
    [TeamSide.HOME, TeamSide.AWAY, 2, false, 2],
    [TeamSide.AWAY, TeamSide.HOME, 2, false, 2],
    [TeamSide.HOME, TeamSide.AWAY, 2, true, 1],
    [TeamSide.AWAY, TeamSide.HOME, 2, true, 1],
    [TeamSide.HOME, TeamSide.AWAY, 3, false, 3],
    [TeamSide.AWAY, TeamSide.HOME, 3, false, 3],
    [TeamSide.HOME, TeamSide.AWAY, 3, true, 1],
    [TeamSide.AWAY, TeamSide.HOME, 3, true, 1],
  ] as const)("derives the correct shooting-foul penalty for %s foul against %s %sPT made=%s", (foulingTeam, shootingTeam, points, made, attempts) => {
    const engine = createStartedEngine();
    const shooterId = shootingTeam === TeamSide.HOME ? "home-1" : "away-1";
    const foulerId = foulingTeam === TeamSide.HOME ? "home-1" : "away-1";
    const shotType = points === 2 ? (made ? EventType.TWO_POINT : EventType.TWO_POINT_MISSED) : (made ? EventType.THREE_POINT : EventType.THREE_POINT_MISSED);
    expect(engine.process(matchEvent({ type: shotType, team: shootingTeam, playerId: shooterId, stoppageId: `shooting-${foulingTeam}-${shootingTeam}-${points}-${made}`, sequence: 4 }))).toMatchObject({ accepted: true });
    expect(engine.process(matchEvent({
      type: EventType.PERSONAL_FOUL,
      team: foulingTeam,
      offender: { kind: FoulOffenderKind.PLAYER, playerId: foulerId },
      context: { kind: FoulContextKind.SHOOTING },
      fouledPlayerId: shooterId,
      relatedShotEventId: "event-4",
      stoppageId: `shooting-${foulingTeam}-${shootingTeam}-${points}-${made}`,
      sequence: 5,
    }))).toMatchObject({ accepted: true });

    expect(engine.getState()[shootingTeam === TeamSide.HOME ? "home" : "away"].score).toBe(made ? points : 0);
    expect(engine.getState().penaltyResolution?.freeThrowQueue[0]).toMatchObject({ beneficiaryTeam: shootingTeam, attempts, designatedPlayerId: shooterId });
    expect(engine.getEvents().filter((event) => event.type === EventType.TWO_POINT || event.type === EventType.THREE_POINT || event.type === EventType.TWO_POINT_MISSED || event.type === EventType.THREE_POINT_MISSED)).toHaveLength(1);
  });

  it("keeps TEAM final-free-throw rebound as a possession outcome with no rebound statistics", () => {
    const engine = createStartedEngine();
    expect(engine.process(matchEvent({ type: EventType.TWO_POINT_MISSED, team: TeamSide.HOME, playerId: "home-1", stoppageId: "team-final-ft", sequence: 4 }))).toMatchObject({ accepted: true });
    expect(engine.process(matchEvent({ type: EventType.PERSONAL_FOUL, team: TeamSide.AWAY, offender: { kind: FoulOffenderKind.PLAYER, playerId: "away-1" }, context: { kind: FoulContextKind.SHOOTING }, fouledPlayerId: "home-1", relatedShotEventId: "event-4", stoppageId: "team-final-ft", sequence: 5 }))).toMatchObject({ accepted: true });
    const penaltyId = engine.getState().penaltyResolution?.freeThrowQueue[0]?.penaltyId ?? "";
    for (const attemptIndex of [1, 2]) expect(engine.process(matchEvent({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", penaltyId, attemptIndex, made: false, sequence: attemptIndex + 5 }))).toMatchObject({ accepted: true });
    const teamStatisticsBefore = JSON.parse(JSON.stringify(engine.getState().home.statistics));
    const opposingTeamStatisticsBefore = JSON.parse(JSON.stringify(engine.getState().away.statistics));
    expect(engine.process(matchEvent({ type: EventType.REBOUND, team: TeamSide.AWAY, offensive: false, teamRebound: true, sequence: 8 }))).toMatchObject({ accepted: true });
    expect(engine.getState().possession).toBe(TeamSide.AWAY);
    expect(engine.getState().home.statistics).toEqual(teamStatisticsBefore);
    expect(engine.getState().away.statistics).toEqual(opposingTeamStatisticsBefore);
  });

  it("records a TEAM rebound as possession only without rebound statistics", () => {
    const engine = createStartedEngine();
    const playersBefore = engine.getState().home.players.map((item) => item.statistics);
    const teamStatisticsBefore = JSON.parse(JSON.stringify(engine.getState().home.statistics));
    expect(engine.process(matchEvent({
      type: EventType.REBOUND,
      team: TeamSide.HOME,
      offensive: true,
      teamRebound: true,
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.getState().possession).toBe(TeamSide.HOME);
    expect(engine.getState().home.players.map((item) => item.statistics)).toEqual(playersBefore);
    expect(engine.getState().home.statistics).toEqual(teamStatisticsBefore);
    expect(engine.getEvents().at(-1)).toMatchObject({ type: EventType.REBOUND, teamRebound: true });
  });
});
