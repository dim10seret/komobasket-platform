import { describe, expect, it } from "vitest";
import { MatchEngine } from "./match-engine";
import { PeriodEngine } from "./period-engine";
import { resolveResultPolicy } from "./rules-engine";
import { createPlayer } from "../models/player";
import { EventType } from "../types/event-type";
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

  it("records a verified bench technical without incrementing team fouls", () => {
    const engine = createStartedEngine();
    const result = engine.process(matchEvent({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.AWAY,
      offender: { kind: FoulOffenderKind.BENCH, personId: "coach-away", role: BenchRole.HEAD_COACH },
      category: TechnicalFoulCategory.CATEGORY_1,
      context: { kind: FoulContextKind.NON_CONTACT },
      stoppageId: "bench-technical",
      sequence: 4,
    }));

    expect(result.accepted).toBe(true);
    expect(result.state.away.teamFouls).toBe(0);
    expect(result.state.away.discipline).toMatchObject({
      headCoachCategory1TechnicalCount: 1,
      headCoachDisqualified: false,
    });
    expect(result.state.penaltyResolution?.freeThrowQueue[0]).toMatchObject({
      attempts: 1,
      shooterPolicy: ShooterPolicy.ANY_OPPONENT,
    });
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
      onCourt: false,
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
      onCourt: false,
      foulState: {
        total: 5,
        status: PlayerFoulStatus.EXCLUDED,
        statusReason: PlayerFoulStatusReason.FIVE_FOULS,
      },
    });
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

    const blocked = createStartedEngine();
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
    const before = blocked.getState();
    expect(blocked.removeEvent("event-5")).toMatchObject({
      accepted: false,
      reason: "INVALID_SCORING_TEAM",
      blockingEventId: "event-6",
    });
    expect(blocked.getState()).toEqual(before);
  });
});
