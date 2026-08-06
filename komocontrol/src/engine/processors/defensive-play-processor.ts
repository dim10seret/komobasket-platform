import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { MatchState } from "../../types/match-state";
import { PossessionEngine } from "../possession-engine";
import { StatisticsEngine } from "../statistics-engine";

export class DefensivePlayProcessor {
  private readonly statistics: StatisticsEngine;
  private readonly possession: PossessionEngine;

  constructor(statistics = new StatisticsEngine(), possession = new PossessionEngine()) {
    this.statistics = statistics;
    this.possession = possession;
  }

  processSteal(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.STEAL }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a steal event.");
    this.statistics.recordSteal(team, player);
    this.possession.set(state, event.team);
  }

  processBlock(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.BLOCK }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.id === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a block event.");
    this.statistics.recordBlock(team, player);
  }
}
