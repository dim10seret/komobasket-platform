import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class UnsportsmanlikeFoulProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.UNSPORTSMANLIKE_FOUL }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing an unsportsmanlike foul event.");
    this.statistics.recordUnsportsmanlikeFoul(team, player);
    state.freeThrowSeries = {
      shootingTeam: event.team === "HOME" ? "AWAY" : "HOME",
      shooterId: event.fouledPlayerId,
      remainingAttempts: 2,
      totalAttempts: 2,
      possessionAfter: "SHOOTING_TEAM",
    };
  }
}
