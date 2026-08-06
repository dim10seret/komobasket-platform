import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { MatchState } from "../../types/match-state";
import { StatisticsEngine } from "../statistics-engine";

export class MissedShotProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  processTwoPoint(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.TWO_POINT_MISSED }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a missed two-point shot.");
    this.statistics.recordMissedTwoPoint(team, player);
  }

  processThreePoint(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.THREE_POINT_MISSED }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a missed three-point shot.");
    this.statistics.recordMissedThreePoint(team, player);
  }
}
