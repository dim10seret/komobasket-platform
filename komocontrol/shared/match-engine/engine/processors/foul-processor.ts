import { EventType } from "../../types/event-type.js";
import type { FoulEvent, MatchEvent } from "../../types/event.js";
import {
  BenchRole,
  FoulOffenderKind,
  PlayerFoulStatus,
  PlayerFoulStatusReason,
  TechnicalFoulCategory,
} from "../../types/foul.js";
import type { MatchState } from "../../types/match-state.js";
import type { Player } from "../../types/player.js";
import type { Team } from "../../types/team.js";
import { FoulPolicyEngine } from "../foul-policy-engine.js";
import { StoppagePenaltyResolver, applyResolvedRestart } from "../stoppage-penalty-resolver.js";
import { StatisticsEngine } from "../statistics-engine.js";

export class FoulProcessor {
  private readonly policy: FoulPolicyEngine;
  private readonly statistics: StatisticsEngine;
  private readonly stoppages: StoppagePenaltyResolver;

  constructor(
    policy = new FoulPolicyEngine(),
    statistics = new StatisticsEngine(),
    stoppages = new StoppagePenaltyResolver(),
  ) {
    this.policy = policy;
    this.statistics = statistics;
    this.stoppages = stoppages;
  }

  process(
    state: MatchState,
    event: FoulEvent,
    priorEvents: readonly MatchEvent[],
  ): void {
    const existing = state.penaltyResolution?.stoppageId === event.stoppageId
      && !state.penaltyResolution.administrationStarted
      ? state.penaltyResolution
      : undefined;
    if (existing) {
      state.possession = existing.interruptedPossession;
      state.alternatingPossession = existing.interruptedAlternatingPossession;
    }
    const interruptedPossession = existing?.interruptedPossession ?? state.possession;
    const interruptedAlternatingPossession =
      existing?.interruptedAlternatingPossession ?? state.alternatingPossession;
    const resolution = this.policy.resolve(
      state,
      event,
      priorEvents,
      interruptedPossession,
    );
    const team = event.team === "HOME" ? state.home : state.away;
    const playerId = event.offender.kind === FoulOffenderKind.PLAYER
      ? event.offender.playerId
      : undefined;
    const player = playerId
      ? team.players.find((candidate) => candidate.playerId === playerId)
      : undefined;

    if (event.offender.kind === FoulOffenderKind.PLAYER && !player) {
      throw new Error("Validated player was not found while processing a foul.");
    }

    this.statistics.recordFoul(team, player, event.type);
    if (resolution.countsAsTeamFoul) team.teamFouls += 1;
    if (player) this.recordPlayerFoul(player, event);
    else this.recordBenchFoul(team, event);

    const stoppageResolution = this.stoppages.resolve({
      stoppageId: event.stoppageId,
      interruptedPossession,
      interruptedAlternatingPossession,
      entitlements: [...(existing?.entitlements ?? []), resolution.penalty],
      events: [...priorEvents, event],
    });
    state.penaltyResolution = stoppageResolution;
    if (stoppageResolution.freeThrowQueue.length === 0) {
      stoppageResolution.finalRestart = applyResolvedRestart(state, stoppageResolution.finalRestart);
    }
  }

  private recordPlayerFoul(player: Player, event: FoulEvent): void {
    const foulState = player.foulState;
    foulState.total += 1;

    if (event.type === EventType.TECHNICAL_FOUL) {
      if (event.category === TechnicalFoulCategory.CATEGORY_1) foulState.category1TechnicalCount += 1;
      else foulState.category2TechnicalCount += 1;
    } else if (event.type === EventType.DISRUPTIVE_FOUL) {
      foulState.disruptiveCount += 1;
    } else if (event.type === EventType.FLAGRANT_FOUL) {
      foulState.flagrantCount += 1;
    } else if (event.type === EventType.DISQUALIFYING_FOUL) {
      foulState.directDisqualification = true;
    }

    if (foulState.directDisqualification) {
      this.removePlayer(player, PlayerFoulStatus.DISQUALIFIED, PlayerFoulStatusReason.DIRECT_DISQUALIFICATION);
    } else if (foulState.category1TechnicalCount >= 2) {
      this.removePlayer(player, PlayerFoulStatus.DISQUALIFIED, PlayerFoulStatusReason.TWO_CATEGORY_1_TECHNICALS);
    } else if (foulState.flagrantCount >= 2) {
      this.removePlayer(player, PlayerFoulStatus.DISQUALIFIED, PlayerFoulStatusReason.TWO_FLAGRANT_FOULS);
    } else if (foulState.category1TechnicalCount >= 1 && foulState.flagrantCount >= 1) {
      this.removePlayer(
        player,
        PlayerFoulStatus.DISQUALIFIED,
        PlayerFoulStatusReason.MIXED_CATEGORY_1_TECHNICAL_AND_FLAGRANT,
      );
    } else if (foulState.total >= 5) {
      this.removePlayer(player, PlayerFoulStatus.EXCLUDED, PlayerFoulStatusReason.FIVE_FOULS);
    }
  }

  private recordBenchFoul(team: Team, event: FoulEvent): void {
    if (event.offender.kind !== FoulOffenderKind.BENCH) return;

    if (event.type === EventType.TECHNICAL_FOUL) {
      if (event.offender.role === BenchRole.HEAD_COACH) {
        team.discipline.headCoachCategory1TechnicalCount += 1;
      } else {
        team.discipline.benchCategory1TechnicalCount += 1;
      }
      team.discipline.headCoachDisqualified =
        team.discipline.headCoachCategory1TechnicalCount >= 2
        || team.discipline.headCoachCategory1TechnicalCount
          + team.discipline.benchCategory1TechnicalCount >= 3;
      return;
    }

    if (event.type === EventType.DISQUALIFYING_FOUL) {
      if (!team.discipline.disqualifiedBenchPersonIds.includes(event.offender.personId)) {
        team.discipline.disqualifiedBenchPersonIds.push(event.offender.personId);
      }
      if (event.offender.role === BenchRole.HEAD_COACH) team.discipline.headCoachDisqualified = true;
    }
  }

  private removePlayer(
    player: Player,
    status: PlayerFoulStatus,
    reason: PlayerFoulStatusReason,
  ): void {
    player.foulState.status = status;
    player.foulState.statusReason = reason;
  }

}
