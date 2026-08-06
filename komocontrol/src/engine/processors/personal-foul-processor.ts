import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { MatchState } from "../../types/match-state";
import { StatisticsEngine } from "../statistics-engine";

export class PersonalFoulProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.PERSONAL_FOUL }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a personal foul event.");

    this.statistics.recordPersonalFoul(team, player);
    if (team.teamFouls > 4 && event.fouledPlayerId) {
      state.freeThrowSeries = {
        shootingTeam: event.team === "HOME" ? "AWAY" : "HOME",
        shooterId: event.fouledPlayerId,
        remainingAttempts: 2,
        totalAttempts: 2,
        possessionAfter: "LIVE_BALL",
      };
    }
  }
}
