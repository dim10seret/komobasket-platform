import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { PossessionEngine } from "../possession-engine.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class ReboundProcessor {
  private readonly statistics: StatisticsEngine;
  private readonly possession: PossessionEngine;

  constructor(statistics = new StatisticsEngine(), possession = new PossessionEngine()) {
    this.statistics = statistics;
    this.possession = possession;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.REBOUND }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.playerId === event.playerId);
    if (!player) throw new Error("Validated player was not found while processing a rebound event.");
    this.statistics.recordRebound(team, player, event.offensive);
    this.possession.set(state, event.team);
  }
}
