import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { PossessionEngine } from "../possession-engine.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class FreeThrowProcessor {
  private readonly statistics: StatisticsEngine;
  private readonly possession: PossessionEngine;

  constructor(statistics = new StatisticsEngine(), possession = new PossessionEngine()) {
    this.statistics = statistics;
    this.possession = possession;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.FREE_THROW }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a free throw event.");

    this.statistics.recordFreeThrow(team, player, event.made);
    const series = state.freeThrowSeries;
    if (!series) throw new Error("Validated free-throw series was not found.");
    series.remainingAttempts -= 1;
    if (series.remainingAttempts !== 0) return;

    state.freeThrowSeries = undefined;
    if (series.possessionAfter === "SHOOTING_TEAM") {
      this.possession.set(state, event.team);
      return;
    }
    if (series.possessionAfter === "LIVE_BALL" && event.made) {
      this.possession.set(state, event.team === "HOME" ? "AWAY" : "HOME");
    }
  }
}
