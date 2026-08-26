import { EventType } from "../types/event-type.js";
import type { FoulEvent, MatchEvent, ScoringShotEvent } from "../types/event.js";
import { FoulContextKind, FoulOffenderKind } from "../types/foul.js";
import type { MatchState } from "../types/match-state.js";
import {
  PenaltyRestartKind,
  ShooterPolicy,
  penaltyIdFor,
  type FoulResolution,
  type PenaltyEntitlement,
  type PenaltyRestart,
} from "../types/penalty.js";
import { RulesEdition } from "../types/rules.js";
import { TeamSide } from "../types/team-side.js";

export class FoulPolicyEngine {
  resolve(
    state: MatchState,
    event: FoulEvent,
    priorEvents: readonly MatchEvent[],
  ): FoulResolution {
    if (state.rules.rulesEdition !== RulesEdition.FIBA_2026) {
      throw new Error("Foul policy is not defined for the pinned rules edition.");
    }

    const countsAsTeamFoul = this.countsAsTeamFoul(event);
    const team = event.team === TeamSide.HOME ? state.home : state.away;
    const projectedTeamFouls = team.teamFouls + (countsAsTeamFoul ? 1 : 0);
    const opponent = opposite(event.team);

    if (event.type === EventType.TECHNICAL_FOUL) {
      return {
        countsAsTeamFoul,
        penalty: this.penalty(event, opponent, 1, ShooterPolicy.ANY_OPPONENT, {
          kind: PenaltyRestartKind.RESUME_INTERRUPTED,
          possession: state.possession,
        }),
      };
    }

    if (event.context.kind === FoulContextKind.SHOOTING) {
      const shot = this.requireRelatedShot(event, priorEvents);
      const attempts = isMadeShot(shot) ? 1 : shot.type === EventType.TWO_POINT_MISSED ? 2 : 3;
      const restart: PenaltyRestart = event.type === EventType.PERSONAL_FOUL
        ? { kind: PenaltyRestartKind.LIVE_BALL }
        : { kind: PenaltyRestartKind.FRONTCOURT_THROW_IN, team: shot.team };
      return {
        countsAsTeamFoul,
        penalty: this.penalty(
          event,
          shot.team,
          attempts,
          ShooterPolicy.FOULED_PLAYER,
          restart,
          event.fouledPlayerId,
        ),
      };
    }

    if (event.type === EventType.PERSONAL_FOUL) {
      const restart: PenaltyRestart = {
        kind: PenaltyRestartKind.NEAREST_THROW_IN,
        team: opponent,
      };
      if (
        event.context.kind === FoulContextKind.NON_SHOOTING
        && (event.context.teamControlFoul || projectedTeamFouls < state.rules.teamFoulPenaltyThreshold)
      ) {
        return { countsAsTeamFoul, immediateRestart: restart };
      }
      return {
        countsAsTeamFoul,
        penalty: this.penalty(
          event,
          opponent,
          2,
          ShooterPolicy.FOULED_PLAYER,
          { kind: PenaltyRestartKind.LIVE_BALL },
          event.fouledPlayerId,
        ),
      };
    }

    const designatedPlayerId = event.fouledPlayerId;
    return {
      countsAsTeamFoul,
      penalty: this.penalty(
        event,
        opponent,
        2,
        designatedPlayerId ? ShooterPolicy.FOULED_PLAYER : ShooterPolicy.ANY_OPPONENT,
        { kind: PenaltyRestartKind.FRONTCOURT_THROW_IN, team: opponent },
        designatedPlayerId,
      ),
    };
  }

  countsAsTeamFoul(event: FoulEvent): boolean {
    return event.offender.kind === FoulOffenderKind.PLAYER;
  }

  private penalty(
    event: FoulEvent,
    shootingTeam: TeamSide,
    attempts: number,
    shooterPolicy: ShooterPolicy,
    restart: PenaltyRestart,
    designatedPlayerId?: string,
  ): PenaltyEntitlement {
    return {
      penaltyId: penaltyIdFor(event.id),
      sourceFoulEventId: event.id,
      shootingTeam,
      attempts,
      shooterPolicy,
      ...(designatedPlayerId ? { designatedPlayerId } : {}),
      restart,
      completedAttempts: 0,
    };
  }

  private requireRelatedShot(
    event: FoulEvent,
    priorEvents: readonly MatchEvent[],
  ): ScoringShotEvent {
    const relatedShotEventId = "relatedShotEventId" in event
      ? event.relatedShotEventId
      : undefined;
    const shot = priorEvents.find((candidate) => candidate.id === relatedShotEventId);
    if (!shot || !isShotEvent(shot)) {
      throw new Error("Validated shooting-foul context has no related shot.");
    }
    return shot;
  }
}

function isShotEvent(event: MatchEvent): event is ScoringShotEvent {
  return event.type === EventType.TWO_POINT
    || event.type === EventType.TWO_POINT_MISSED
    || event.type === EventType.THREE_POINT
    || event.type === EventType.THREE_POINT_MISSED;
}

function isMadeShot(event: ScoringShotEvent): boolean {
  return event.type === EventType.TWO_POINT || event.type === EventType.THREE_POINT;
}

function opposite(team: TeamSide): TeamSide {
  return team === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}
