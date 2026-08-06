import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { MatchState } from "../../types/match-state";
import { StatisticsEngine } from "../statistics-engine";

export class ShootingFoulProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.SHOOTING_FOUL }>): void {
    const foulingTeam = event.team === "HOME" ? state.home : state.away;
    const player = foulingTeam.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a shooting foul event.");

    this.statistics.recordShootingFoul(foulingTeam, player);
    state.freeThrowSeries = {
      shootingTeam: event.team === "HOME" ? "AWAY" : "HOME",
      shooterId: event.fouledPlayerId,
      remainingAttempts: event.freeThrows,
      totalAttempts: event.freeThrows,
      possessionAfter: "LIVE_BALL",
    };
  }
}
