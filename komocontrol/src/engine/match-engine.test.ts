import { describe, expect, it } from "vitest";
import { MatchEngine } from "./match-engine";
import { createPlayer } from "../models/player";
import { EventType } from "../types/event-type";
import { TeamSide } from "../types/team-side";
import type { MatchEvent } from "../types/event";
import { Quarter } from "../types/quarter";
import type { MatchState } from "../types/match-state";

const event = <T extends Omit<MatchEvent, "id" | "occurredAt">>(data: T): MatchEvent => ({
  ...data,
  id: `event-${data.sequence}`,
  occurredAt: data.sequence,
} as MatchEvent);

function createEngineFixture(): { engine: MatchEngine; initialState: MatchState } {
  const homePlayers = Array.from({ length: 6 }, (_, index) => createPlayer(`home-${index + 1}`, TeamSide.HOME, index + 1, "Home", `${index + 1}`));
  const awayPlayers = Array.from({ length: 5 }, (_, index) => createPlayer(`away-${index + 1}`, TeamSide.AWAY, index + 1, "Away", `${index + 1}`));
  const engine = new MatchEngine({
    homeTeam: { id: "home", name: "Home", players: homePlayers },
    awayTeam: { id: "away", name: "Away", players: awayPlayers },
  });
  const initialState = engine.getState();

  expect(engine.process(event({ type: EventType.LINEUP_SET, team: TeamSide.HOME, playerIds: homePlayers.slice(0, 5).map((player) => player.id), sequence: 1 })).accepted).toBe(true);
  expect(engine.process(event({ type: EventType.LINEUP_SET, team: TeamSide.AWAY, playerIds: awayPlayers.map((player) => player.id), sequence: 2 })).accepted).toBe(true);
  expect(engine.process(event({ type: EventType.MATCH_START, sequence: 3 })).accepted).toBe(true);
  return { engine, initialState };
}

function createStartedEngine(): MatchEngine {
  return createEngineFixture().engine;
}

function advanceToQuarter(engine: MatchEngine, from: Quarter, to: Quarter, firstSequence: number): number {
  expect(engine.process(event({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence: firstSequence })).accepted).toBe(true);
  expect(engine.process(event({ type: EventType.QUARTER_END, quarter: from, sequence: firstSequence + 1 })).accepted).toBe(true);
  expect(engine.process(event({ type: EventType.QUARTER_START, quarter: to, sequence: firstSequence + 2 })).accepted).toBe(true);
  return firstSequence + 3;
}

describe("MatchEngine", () => {
  it("updates score and possession after a made two-point shot", () => {
    const engine = createStartedEngine();
    const result = engine.process(event({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }));

    expect(result.accepted).toBe(true);
    expect(result.state.home.score).toBe(2);
    expect(result.state.home.players[0].statistics.points).toBe(2);
    expect(result.state.possession).toBe(TeamSide.AWAY);
  });

  it("records a personal foul and disqualifies a player on the fifth foul", () => {
    const engine = createStartedEngine();
    for (let sequence = 4; sequence <= 8; sequence += 1) {
      expect(engine.process(event({ type: EventType.PERSONAL_FOUL, team: TeamSide.HOME, playerId: "home-1", ...(sequence === 8 ? { fouledPlayerId: "away-1" } : {}), sequence })).accepted).toBe(true);
    }

    const player = engine.getState().home.players[0];
    expect(player.fouls).toBe(5);
    expect(player.disqualified).toBe(true);
  });

  it("updates the active lineup through a substitution", () => {
    const engine = createStartedEngine();
    const result = engine.process(event({
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
    expect(engine.process(event({ type: EventType.SHOOTING_FOUL, team: TeamSide.AWAY, playerId: "away-1", fouledPlayerId: "home-1", freeThrows: 2, sequence: 4 })).accepted).toBe(true);
    const result = engine.process(event({ type: EventType.SUBSTITUTION, team: TeamSide.HOME, playerOutId: "home-1", playerInId: "home-6", sequence: 5 }));

    expect(result.accepted).toBe(true);
    expect(result.state.freeThrowSeries).toMatchObject({ shootingTeam: TeamSide.HOME, shooterId: "home-1", remainingAttempts: 2 });
  });

  it("controls the match clock through typed clock events", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({ type: EventType.CLOCK_START, sequence: 4 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.CLOCK_SET, remainingSeconds: 245, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.CLOCK_STOP, sequence: 6 })).accepted).toBe(true);

    const state = engine.getState();
    expect(state.clock).toBe(245);
    expect(state.clockRunning).toBe(false);
  });

  it("replays the event log after undo without leaving stale score or possession", () => {
    const engine = createStartedEngine();
    engine.process(event({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }));
    const result = engine.undoLast();

    expect(result?.accepted).toBe(true);
    expect(result?.state.home.score).toBe(0);
    expect(result?.state.possession).toBe(TeamSide.HOME);
    expect(engine.getEvents()).toHaveLength(3);
  });

  it("runs a free-throw series and gives possession to the opponent after the final made attempt", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({
      type: EventType.SHOOTING_FOUL,
      team: TeamSide.HOME,
      playerId: "home-1",
      fouledPlayerId: "away-1",
      freeThrows: 2,
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: false, sequence: 5 })).accepted).toBe(true);
    expect(engine.getState().freeThrowSeries?.remainingAttempts).toBe(1);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: true, sequence: 6 })).accepted).toBe(true);

    const state = engine.getState();
    expect(state.away.score).toBe(2);
    expect(state.freeThrowSeries).toBeUndefined();
    expect(state.possession).toBe(TeamSide.HOME);
  });

  it("records a missed shot followed by a defensive rebound and changes possession", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({ type: EventType.THREE_POINT_MISSED, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.REBOUND, team: TeamSide.AWAY, playerId: "away-1", offensive: false, sequence: 5 })).accepted).toBe(true);

    const state = engine.getState();
    expect(state.home.players[0].statistics.threePointAttempts).toBe(1);
    expect(state.away.players[0].statistics.defensiveRebounds).toBe(1);
    expect(state.possession).toBe(TeamSide.AWAY);
  });

  it("starts overtime only after a tied fourth quarter has finished", () => {
    const engine = createStartedEngine();
    let sequence = 4;
    sequence = advanceToQuarter(engine, Quarter.Q1, Quarter.Q2, sequence);
    sequence = advanceToQuarter(engine, Quarter.Q2, Quarter.Q3, sequence);
    sequence = advanceToQuarter(engine, Quarter.Q3, Quarter.Q4, sequence);
    expect(engine.process(event({ type: EventType.CLOCK_SET, remainingSeconds: 0, sequence })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.QUARTER_END, quarter: Quarter.Q4, sequence: sequence + 1 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.OVERTIME_START, quarter: Quarter.OT1, sequence: sequence + 2 })).accepted).toBe(true);

    const state = engine.getState();
    expect(state.quarter).toBe(Quarter.OT1);
    expect(state.clock).toBe(300);
  });

  it("disqualifies a player immediately after a disqualifying foul and rejects later actions by that player", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({ type: EventType.DISQUALIFYING_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: false, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: true, sequence: 6 })).accepted).toBe(true);
    const rejected = engine.process(event({ type: EventType.PERSONAL_FOUL, team: TeamSide.HOME, playerId: "home-1", sequence: 7 }));

    expect(engine.getState().home.players[0]).toMatchObject({ disqualified: true, onCourt: false });
    expect(rejected).toMatchObject({ accepted: false, reason: "PLAYER_DISQUALIFIED" });
  });

  it("awards one technical free throw and keeps the existing possession", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({
      type: EventType.TECHNICAL_FOUL,
      team: TeamSide.AWAY,
      playerId: "away-1",
      freeThrowPlayerId: "home-1",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.getState().freeThrowSeries).toMatchObject({ shootingTeam: TeamSide.HOME, remainingAttempts: 1, possessionAfter: "UNCHANGED" });
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: true, isFinalAttempt: true, sequence: 5 })).accepted).toBe(true);
    expect(engine.getState()).toMatchObject({ possession: TeamSide.HOME, freeThrowSeries: undefined });
  });

  it("awards two free throws and possession after an unsportsmanlike foul", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({
      type: EventType.UNSPORTSMANLIKE_FOUL,
      team: TeamSide.AWAY,
      playerId: "away-1",
      fouledPlayerId: "home-1",
      sequence: 4,
    })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: false, isFinalAttempt: false, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: false, isFinalAttempt: true, sequence: 6 })).accepted).toBe(true);
    expect(engine.getState()).toMatchObject({ possession: TeamSide.HOME, freeThrowSeries: undefined });
  });

  it("removes a player from the five immediately after a disqualifying technical or unsportsmanlike threshold", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({ type: EventType.TECHNICAL_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: true, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.TECHNICAL_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 6 })).accepted).toBe(true);

    expect(engine.getState().home.players[0]).toMatchObject({ disqualified: true, onCourt: false });
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: true, isFinalAttempt: true, sequence: 7 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.SUBSTITUTION, team: TeamSide.HOME, playerOutId: "home-1", playerInId: "home-6", sequence: 8 }))).toMatchObject({ accepted: false, reason: "PLAYER_NOT_ON_COURT" });
  });

  it("disqualifies and removes a player after one technical and one unsportsmanlike foul", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({ type: EventType.TECHNICAL_FOUL, team: TeamSide.HOME, playerId: "home-1", freeThrowPlayerId: "away-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.FREE_THROW, team: TeamSide.AWAY, playerId: "away-1", made: false, isFinalAttempt: true, sequence: 5 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.UNSPORTSMANLIKE_FOUL, team: TeamSide.HOME, playerId: "home-1", fouledPlayerId: "away-1", sequence: 6 })).accepted).toBe(true);

    expect(engine.getState().home.players[0]).toMatchObject({ disqualified: true, onCourt: false });
  });

  it("replays a correction from the original snapshot without stale score", () => {
    const engine = createStartedEngine();
    expect(engine.process(event({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    const corrected = engine.correctEvent("event-4", event({ type: EventType.THREE_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 }));

    expect(corrected.accepted).toBe(true);
    expect(corrected.state.home.score).toBe(3);
    expect(corrected.state.home.players[0].statistics).toMatchObject({ twoPointAttempts: 0, threePointAttempts: 1, points: 3 });
    expect(engine.getEvents()[3]).toMatchObject({ id: "event-4", sequence: 4, type: EventType.THREE_POINT });
  });

  it("restores the same match state when persisted events are replayed from the initial snapshot", () => {
    const { engine, initialState } = createEngineFixture();
    expect(engine.process(event({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", sequence: 4 })).accepted).toBe(true);
    expect(engine.process(event({ type: EventType.TURNOVER, team: TeamSide.AWAY, playerId: "away-1", sequence: 5 })).accepted).toBe(true);

    const restored = MatchEngine.fromInitialState(initialState);
    for (const persistedEvent of engine.getEvents()) {
      expect(restored.process(persistedEvent).accepted).toBe(true);
    }

    expect(restored.getState()).toEqual(engine.getState());
    expect(restored.getEvents()).toEqual(engine.getEvents());
  });
});
