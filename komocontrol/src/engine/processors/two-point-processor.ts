import type { MatchState } from "../../types/match-state";
import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import { PossessionEngine } from "../possession-engine";
import { StatisticsEngine } from "../statistics-engine";

export class TwoPointProcessor {
  private readonly statistics: StatisticsEngine;
  private readonly possession: PossessionEngine;

  constructor(statistics = new StatisticsEngine(), possession = new PossessionEngine()) {
    this.statistics = statistics;
    this.possession = possession;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.TWO_POINT }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a two-point event.");

    this.statistics.recordTwoPoint(team, player);
    if (event.assistPlayerId) {
      const assister = team.players.find((candidate) => candidate.id === event.assistPlayerId);
      if (!assister) throw new Error("Validated assisting player was not found while processing a two-point event.");
      this.statistics.recordAssist(team, assister);
    }
    this.possession.switch(state);
  }
}
