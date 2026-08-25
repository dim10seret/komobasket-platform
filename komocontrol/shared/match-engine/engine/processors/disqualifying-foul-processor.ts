import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class DisqualifyingFoulProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.DISQUALIFYING_FOUL }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a disqualifying foul event.");
    this.statistics.recordDisqualifyingFoul(team, player);
    state.freeThrowSeries = {
      shootingTeam: event.team === "HOME" ? "AWAY" : "HOME",
      shooterId: event.freeThrowPlayerId,
      remainingAttempts: 2,
      totalAttempts: 2,
      possessionAfter: "SHOOTING_TEAM",
    };
  }
}
