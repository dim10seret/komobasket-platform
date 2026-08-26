import { EventType } from "../../types/event-type.js";
import type { MatchEvent } from "../../types/event.js";
import type { MatchState } from "../../types/match-state.js";
import { TeamSide } from "../../types/team-side.js";
import { StatisticsEngine } from "../statistics-engine.js";
import { applyResolvedRestart } from "../stoppage-penalty-resolver.js";

export class FreeThrowProcessor {
  private readonly statistics: StatisticsEngine;

  constructor(statistics = new StatisticsEngine()) {
    this.statistics = statistics;
  }

  process(
    state: MatchState,
    event: Extract<MatchEvent, { type: typeof EventType.FREE_THROW }>,
  ): void {
    const team = event.team === TeamSide.HOME ? state.home : state.away;
    const player = team.players.find((candidate) => candidate.playerId === event.playerId);
    const resolution = state.penaltyResolution;
    const penalty = resolution?.freeThrowQueue[0];
    if (!player || !penalty) {
      throw new Error("Validated free-throw player or penalty was not found.");
    }

    this.statistics.recordFreeThrow(team, player, event.made);
    resolution.administrationStarted = true;
    penalty.completedAttempts += 1;
    if (penalty.completedAttempts < penalty.attempts) return;

    resolution.freeThrowQueue = resolution.freeThrowQueue.slice(1);
    if (resolution.freeThrowQueue.length > 0) return;
    resolution.finalRestart = applyResolvedRestart(state, resolution.finalRestart, {
      team: event.team,
      made: event.made,
    });
  }
}
