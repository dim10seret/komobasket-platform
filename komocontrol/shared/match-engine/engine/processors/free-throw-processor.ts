import { EventType } from "../../types/event-type.js";
import type { MatchEvent } from "../../types/event.js";
import type { MatchState } from "../../types/match-state.js";
import { PenaltyRestartKind } from "../../types/penalty.js";
import { TeamSide } from "../../types/team-side.js";
import { StatisticsEngine } from "../statistics-engine.js";

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
    const penalty = state.penaltyEntitlement;
    if (!player || !penalty) {
      throw new Error("Validated free-throw player or penalty was not found.");
    }

    this.statistics.recordFreeThrow(team, player, event.made);
    penalty.completedAttempts += 1;
    if (penalty.completedAttempts < penalty.attempts) return;

    state.penaltyEntitlement = undefined;
    switch (penalty.restart.kind) {
      case PenaltyRestartKind.LIVE_BALL:
        state.possession = event.made ? opposite(event.team) : null;
        return;
      case PenaltyRestartKind.NEAREST_THROW_IN:
      case PenaltyRestartKind.FRONTCOURT_THROW_IN:
        state.possession = penalty.restart.team;
        return;
      case PenaltyRestartKind.RESUME_INTERRUPTED:
        state.possession = penalty.restart.possession;
        return;
    }
  }
}

function opposite(team: TeamSide): TeamSide {
  return team === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}
