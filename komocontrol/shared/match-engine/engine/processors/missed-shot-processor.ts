import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class MissedShotProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  processTwoPoint(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.TWO_POINT_MISSED }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.playerId === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a missed two-point shot.");
    this.statistics.recordMissedTwoPoint(team, player);
  }

  processThreePoint(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.THREE_POINT_MISSED }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.playerId === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a missed three-point shot.");
    this.statistics.recordMissedThreePoint(team, player);
  }
}
