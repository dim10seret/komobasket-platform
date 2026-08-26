import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class TechnicalFoulProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.TECHNICAL_FOUL }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = event.playerId ? team.players.find((candidate) => candidate.playerId === event.playerId) : undefined;
    if (event.playerId && !player) throw new Error("Validated player was not found while processing a technical foul event.");

    this.statistics.recordTechnicalFoul(team, player);
    state.freeThrowSeries = {
      shootingTeam: event.team === "HOME" ? "AWAY" : "HOME",
      shooterId: event.freeThrowPlayerId,
      remainingAttempts: 1,
      totalAttempts: 1,
      possessionAfter: "UNCHANGED",
    };
  }
}
