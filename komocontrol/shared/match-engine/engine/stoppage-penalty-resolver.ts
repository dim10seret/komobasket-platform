import { EventType } from "../types/event-type.js";
import type { FoulEvent, MatchEvent, ScoringShotEvent } from "../types/event.js";
import { FoulContextKind, FoulOffenderKind } from "../types/foul.js";
import type { MatchState } from "../types/match-state.js";
import {
  PenaltyEntitlementKind,
  PenaltyRestartKind,
  isFreeThrowPenalty,
  type PenaltyEntitlement,
  type PenaltyRestart,
  type StoppagePenaltyResolution,
} from "../types/penalty.js";
import { TeamSide } from "../types/team-side.js";

interface ResolveStoppageOptions {
  stoppageId: string;
  interruptedPossession: TeamSide | null;
  interruptedAlternatingPossession: TeamSide;
  entitlements: readonly PenaltyEntitlement[];
  events: readonly MatchEvent[];
}

interface FinalFreeThrow {
  team: TeamSide;
  made: boolean;
}

export class StoppagePenaltyResolver {
  resolve(options: ResolveStoppageOptions): StoppagePenaltyResolution {
    const entitlements = structuredClone(options.entitlements) as PenaltyEntitlement[];
    const fouls = options.events
      .filter(isFoulEvent)
      .filter((event) => event.stoppageId === options.stoppageId)
      .sort(compareEvents);
    const sourceById = new Map(fouls.map((event) => [event.id, event]));
    const cancelled = this.cancelDoubleFouls(fouls, entitlements);
    this.cancelEqualOpposingPenalties(entitlements, cancelled);

    const orderedEntitlements = entitlements
      .filter((penalty) => !cancelled.has(penalty.penaltyId))
      .sort((left, right) => {
        const leftEvent = sourceById.get(left.sourceFoulEventId);
        const rightEvent = sourceById.get(right.sourceFoulEventId);
        const priorityDifference = technicalPriority(leftEvent) - technicalPriority(rightEvent);
        return priorityDifference !== 0
          ? priorityDifference
          : compareEvents(leftEvent, rightEvent);
      });
    const finalRestart = orderedEntitlements.length > 0
      ? structuredClone(orderedEntitlements[orderedEntitlements.length - 1].restart)
      : this.restartAfterAllCancellation(options);

    return {
      stoppageId: options.stoppageId,
      interruptedPossession: options.interruptedPossession,
      interruptedAlternatingPossession: options.interruptedAlternatingPossession,
      entitlements,
      cancelledPenaltyIds: [...cancelled].sort((left, right) => {
        const leftPenalty = entitlements.find((penalty) => penalty.penaltyId === left);
        const rightPenalty = entitlements.find((penalty) => penalty.penaltyId === right);
        return compareEvents(
          leftPenalty ? sourceById.get(leftPenalty.sourceFoulEventId) : undefined,
          rightPenalty ? sourceById.get(rightPenalty.sourceFoulEventId) : undefined,
        );
      }),
      orderedEntitlements,
      freeThrowQueue: orderedEntitlements.filter(isFreeThrowPenalty),
      administrationStarted: false,
      finalRestart,
    };
  }

  private cancelDoubleFouls(
    fouls: readonly FoulEvent[],
    entitlements: readonly PenaltyEntitlement[],
  ): Set<string> {
    const cancelled = new Set<string>();
    for (let leftIndex = 0; leftIndex < fouls.length; leftIndex += 1) {
      const left = fouls[leftIndex];
      const leftPenalty = entitlementFor(entitlements, left.id);
      if (!leftPenalty || cancelled.has(leftPenalty.penaltyId)) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < fouls.length; rightIndex += 1) {
        const right = fouls[rightIndex];
        const rightPenalty = entitlementFor(entitlements, right.id);
        if (!rightPenalty || cancelled.has(rightPenalty.penaltyId)) continue;
        if (!isDoubleFoulPair(left, right)) continue;
        cancelled.add(leftPenalty.penaltyId);
        cancelled.add(rightPenalty.penaltyId);
        break;
      }
    }
    return cancelled;
  }

  private cancelEqualOpposingPenalties(
    entitlements: readonly PenaltyEntitlement[],
    cancelled: Set<string>,
  ): void {
    for (let leftIndex = 0; leftIndex < entitlements.length; leftIndex += 1) {
      const left = entitlements[leftIndex];
      if (cancelled.has(left.penaltyId)) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < entitlements.length; rightIndex += 1) {
        const right = entitlements[rightIndex];
        if (
          cancelled.has(right.penaltyId)
          || left.beneficiaryTeam === right.beneficiaryTeam
          || penaltySignature(left) !== penaltySignature(right)
        ) continue;
        cancelled.add(left.penaltyId);
        cancelled.add(right.penaltyId);
        break;
      }
    }
  }

  private restartAfterAllCancellation(options: ResolveStoppageOptions): PenaltyRestart {
    const madeShots = options.events
      .filter(isMadeScoringShot)
      .filter((event) => event.stoppageId === options.stoppageId)
      .sort(compareEvents);
    const madeShot = madeShots[madeShots.length - 1];
    if (madeShot) {
      return { kind: PenaltyRestartKind.ENDLINE_THROW_IN, team: opposite(madeShot.team) };
    }
    if (options.interruptedPossession) {
      return {
        kind: PenaltyRestartKind.NEAREST_THROW_IN,
        team: options.interruptedPossession,
      };
    }
    return { kind: PenaltyRestartKind.ALTERNATING_POSSESSION };
  }
}

export function applyResolvedRestart(
  state: MatchState,
  restart: PenaltyRestart,
  finalFreeThrow?: FinalFreeThrow,
): PenaltyRestart {
  switch (restart.kind) {
    case PenaltyRestartKind.LIVE_BALL:
      if (!finalFreeThrow) return restart;
      if (!finalFreeThrow.made) {
        state.possession = null;
        return restart;
      }
      state.possession = opposite(finalFreeThrow.team);
      return {
        kind: PenaltyRestartKind.ENDLINE_THROW_IN,
        team: opposite(finalFreeThrow.team),
      };
    case PenaltyRestartKind.NEAREST_THROW_IN:
    case PenaltyRestartKind.FRONTCOURT_THROW_IN:
    case PenaltyRestartKind.ENDLINE_THROW_IN:
      state.possession = restart.team;
      return restart;
    case PenaltyRestartKind.RESUME_INTERRUPTED:
      state.possession = restart.possession;
      return restart;
    case PenaltyRestartKind.ALTERNATING_POSSESSION:
      state.possession = state.alternatingPossession;
      state.alternatingPossession = opposite(state.alternatingPossession);
      return restart;
  }
}

function entitlementFor(
  entitlements: readonly PenaltyEntitlement[],
  sourceFoulEventId: string,
): PenaltyEntitlement | undefined {
  return entitlements.find((penalty) => penalty.sourceFoulEventId === sourceFoulEventId);
}

function isDoubleFoulPair(left: FoulEvent, right: FoulEvent): boolean {
  if (
    left.team === right.team
    || left.offender.kind !== FoulOffenderKind.PLAYER
    || right.offender.kind !== FoulOffenderKind.PLAYER
    || left.context.kind === FoulContextKind.NON_CONTACT
    || right.context.kind === FoulContextKind.NON_CONTACT
  ) return false;
  const leftFouledPlayerId = "fouledPlayerId" in left ? left.fouledPlayerId : undefined;
  const rightFouledPlayerId = "fouledPlayerId" in right ? right.fouledPlayerId : undefined;
  if (
    leftFouledPlayerId !== right.offender.playerId
    || rightFouledPlayerId !== left.offender.playerId
  ) return false;
  if (left.type === EventType.PERSONAL_FOUL || right.type === EventType.PERSONAL_FOUL) {
    return left.type === EventType.PERSONAL_FOUL && right.type === EventType.PERSONAL_FOUL;
  }
  return isSevereContactFoul(left) && isSevereContactFoul(right);
}

function isSevereContactFoul(event: FoulEvent): boolean {
  return event.type === EventType.DISRUPTIVE_FOUL
    || event.type === EventType.FLAGRANT_FOUL
    || event.type === EventType.DISQUALIFYING_FOUL;
}

function penaltySignature(penalty: PenaltyEntitlement): string {
  const attempts = penalty.kind === PenaltyEntitlementKind.FREE_THROWS
    ? penalty.attempts
    : 0;
  return `${attempts}:${possessionRight(penalty.restart)}`;
}

function possessionRight(restart: PenaltyRestart): string {
  switch (restart.kind) {
    case PenaltyRestartKind.NEAREST_THROW_IN:
    case PenaltyRestartKind.FRONTCOURT_THROW_IN:
    case PenaltyRestartKind.ENDLINE_THROW_IN:
      return restart.kind;
    case PenaltyRestartKind.ALTERNATING_POSSESSION:
      return PenaltyRestartKind.ALTERNATING_POSSESSION;
    case PenaltyRestartKind.LIVE_BALL:
    case PenaltyRestartKind.RESUME_INTERRUPTED:
      return "NO_ADDITIONAL_POSSESSION_RIGHT";
  }
}

function technicalPriority(event: FoulEvent | undefined): number {
  return event?.type === EventType.TECHNICAL_FOUL ? 0 : 1;
}

function compareEvents(left: MatchEvent | undefined, right: MatchEvent | undefined): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}

function isMadeScoringShot(event: MatchEvent): event is ScoringShotEvent {
  return event.type === EventType.TWO_POINT || event.type === EventType.THREE_POINT;
}

function isFoulEvent(event: MatchEvent): event is FoulEvent {
  return event.type === EventType.PERSONAL_FOUL
    || event.type === EventType.TECHNICAL_FOUL
    || event.type === EventType.DISRUPTIVE_FOUL
    || event.type === EventType.FLAGRANT_FOUL
    || event.type === EventType.DISQUALIFYING_FOUL;
}

function opposite(team: TeamSide): TeamSide {
  return team === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}
