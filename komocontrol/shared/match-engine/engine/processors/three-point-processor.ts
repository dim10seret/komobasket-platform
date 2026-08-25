import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { PossessionEngine } from "../possession-engine.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class ThreePointProcessor {
  private readonly statistics: StatisticsEngine;
  private readonly possession: PossessionEngine;

  constructor(statistics = new StatisticsEngine(), possession = new PossessionEngine()) {
    this.statistics = statistics;
    this.possession = possession;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.THREE_POINT }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a three-point event.");

    this.statistics.recordThreePoint(team, player);
    if (event.assistPlayerId) {
      const assister = team.players.find((candidate) => candidate.id === event.assistPlayerId);
      if (!assister) throw new Error("Validated assisting player was not found while processing a three-point event.");
      this.statistics.recordAssist(team, assister);
    }
    this.possession.switch(state);
  }
}
