import { describe, expect, it } from "vitest";
import { MatchEngine } from "../../shared/match-engine/engine/match-engine";
import { createPlayer } from "../../shared/match-engine/models/player";
import { TeamSide } from "../../shared/match-engine/types/team-side";
import type { MatchEvent } from "../../shared/match-engine/types/event";

function engineFixture(): { engine: MatchEngine; initialState: ReturnType<MatchEngine["getState"]> } {
  const engine = new MatchEngine({
    id: "incremental-run",
    rules: {
      schemaVersion: 1,
      rulesEdition: "FIBA_2026",
      minPlayers: 1,
      maxPlayers: 12,
      startingPlayers: 1,
      regulationPeriods: 4,
      regulationPeriodSeconds: 600,
      overtimeSeconds: 300,
      resultPolicy: "REQUIRE_WINNER",
      teamFoulPenaltyThreshold: 5,
      overtimeTeamFoulPolicy: "CARRY_FROM_FINAL_REGULATION",
    },
    homeTeam: { id: "home", name: "Home", players: [createPlayer({ playerId: "home-1", displayName: "Home One", team: TeamSide.HOME, shirtNumber: "0", onCourt: true })] },
    awayTeam: { id: "away", name: "Away", players: [createPlayer({ playerId: "away-1", displayName: "Away One", team: TeamSide.AWAY, shirtNumber: "00", onCourt: true })] },
  });
  return { engine, initialState: engine.getState() };
}

function event(sequence: number): MatchEvent {
  const common = { schemaVersion: 2 as const, id: `incremental-event-${sequence}`, occurredAt: sequence, sequence };
  if (sequence === 1) return { ...common, type: "MATCH_START" };
  const phase = (sequence - 2) % 3;
  if (phase === 0) return { ...common, type: "CLOCK_START" };
  if (phase === 1) {
    const team = Math.floor((sequence - 2) / 3) % 2 === 0 ? TeamSide.HOME : TeamSide.AWAY;
    return { ...common, type: "TWO_POINT", team, playerId: team === TeamSide.HOME ? "home-1" : "away-1" };
  }
  return { ...common, type: "CLOCK_STOP" };
}

function replay(initialState: ReturnType<MatchEngine["getState"]>, events: MatchEvent[]): MatchEngine {
  const engine = MatchEngine.fromInitialState(initialState);
  for (const item of events) expect(engine.process(item).accepted).toBe(true);
  return engine;
}

describe("incremental MatchEngine runtime", () => {
  it("is state-equivalent to fresh deterministic replay at 100, 250, 500, and 1000 events", () => {
    const { engine, initialState } = engineFixture();
    const events: MatchEvent[] = [];
    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      const item = event(sequence);
      events.push(item);
      const result = engine.process(item);
      expect(result.accepted, `sequence ${sequence}: ${result.accepted ? "accepted" : result.reason}`).toBe(true);
      if ([100, 250, 500, 1_000].includes(sequence)) {
        const reconstructed = replay(initialState, events);
        expect(reconstructed.getState()).toEqual(engine.getState());
        expect(reconstructed.getEvents()).toEqual(engine.getEvents());
      }
    }
  });

  it("previews a candidate without advancing state or event history", () => {
    const { engine } = engineFixture();
    expect(engine.process(event(1)).accepted).toBe(true);
    const beforeState = engine.getState();
    const beforeEvents = engine.getEvents();
    expect(engine.preview(event(2)).accepted).toBe(true);
    expect(engine.getState()).toEqual(beforeState);
    expect(engine.getEvents()).toEqual(beforeEvents);
  });

  it("continues incrementally after deterministic correction and removal replay", () => {
    const { engine, initialState } = engineFixture();
    const first = [event(1), event(2), event(3), event(4)];
    for (const item of first) expect(engine.process(item).accepted).toBe(true);
    const scoringEvent = first[2];
    if (scoringEvent.type !== "TWO_POINT") throw new Error("incremental correction fixture expected TWO_POINT");
    const correctedScoringEvent = { ...scoringEvent, type: "THREE_POINT" as const };
    expect(engine.correctEvent(scoringEvent.id, correctedScoringEvent).accepted).toBe(true);
    expect(engine.removeEvent(first[3].id).accepted).toBe(true);
    const next = { ...event(5), type: "CLOCK_STOP" } as MatchEvent;
    expect(engine.process(next).accepted).toBe(true);
    const surviving = [first[0], first[1], correctedScoringEvent, next];
    expect(engine.getState()).toEqual(replay(initialState, surviving).getState());
  });
});
