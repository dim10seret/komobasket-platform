import { EventType } from "../types/event-type.js";
import {
  MATCH_EVENT_SCHEMA_VERSION,
  type FoulEvent,
  type MatchEvent,
  type ScoringShotEvent,
} from "../types/event.js";
import type { EventRejectionReason } from "../types/event-result.js";
import {
  FoulContextKind,
  FoulOffenderKind,
  PlayerFoulStatus,
  TechnicalFoulCategory,
} from "../types/foul.js";
import type { MatchState } from "../types/match-state.js";
import { ShooterPolicy } from "../types/penalty.js";
import { PeriodKind, periodsEqual } from "../types/period.js";
import type { Player } from "../types/player.js";
import { isShirtNumber } from "../models/player.js";
import { ResultPolicy } from "../types/rules.js";
import type { Team } from "../types/team.js";
import { TeamSide } from "../types/team-side.js";
import { ClockEngine } from "./clock-engine.js";
import { PeriodEngine } from "./period-engine.js";

export class ValidationEngine {
  private readonly periodEngine = new PeriodEngine();
  private readonly clockEngine = new ClockEngine();

  validate(
    state: MatchState,
    event: MatchEvent,
    priorEvents: readonly MatchEvent[] = [],
  ): EventRejectionReason | undefined {
    if (event.schemaVersion !== MATCH_EVENT_SCHEMA_VERSION) return "UNSUPPORTED_EVENT_SCHEMA";
    if (event.sequence <= state.lastProcessedSequence) return "INVALID_EVENT_SEQUENCE";
    if (priorEvents.some((candidate) => candidate.id === event.id)) return "DUPLICATE_EVENT_ID";
    if (state.finished) return "MATCH_ALREADY_FINISHED";

    if (event.type === EventType.MATCH_START) {
      if (state.started) return "MATCH_ALREADY_STARTED";
      return state.home.players.filter((player) => player.onCourt).length === state.rules.startingPlayers
        && state.away.players.filter((player) => player.onCourt).length === state.rules.startingPlayers
        ? undefined
        : "INVALID_LINEUP";
    }

    if (event.type === EventType.LINEUP_SET) {
      if (
        state.started
        || event.playerIds.length !== state.rules.startingPlayers
        || new Set(event.playerIds).size !== state.rules.startingPlayers
      ) return "INVALID_LINEUP";
      const team = teamFor(state, event.team);
      const valid = event.playerIds.every((id) => {
        const player = team.players.find((candidate) => candidate.playerId === id);
        return player !== undefined && isPlayerEligible(player);
      });
      return valid ? undefined : "INVALID_LINEUP";
    }

    if (!state.started) return "MATCH_NOT_STARTED";
    if (event.type === EventType.ROSTER_PLAYER_ADDED) {
      if (!event.playerId.trim() || !event.displayName.trim() || !isShirtNumber(event.shirtNumber)) {
        return "INVALID_ROSTER_AMENDMENT";
      }
      if ([...state.home.players, ...state.away.players].some((player) => player.playerId === event.playerId)) {
        return "PLAYER_ALREADY_REGISTERED";
      }
      return teamFor(state, event.team).players.length < state.rules.maxPlayers
        ? undefined
        : "ROSTER_LIMIT_REACHED";
    }
    const penaltyResolution = state.penaltyResolution;
    if (isFoulEvent(event)) {
      const priorSameStoppageFoul = priorEvents.some(
        (candidate) => isFoulEvent(candidate) && candidate.stoppageId === event.stoppageId,
      );
      if (
        priorSameStoppageFoul
        && penaltyResolution?.stoppageId !== event.stoppageId
      ) return "STOPPAGE_RESOLUTION_LOCKED";
      if (
        penaltyResolution?.stoppageId === event.stoppageId
        && penaltyResolution.administrationStarted
      ) return "STOPPAGE_RESOLUTION_LOCKED";
      if (
        penaltyResolution?.freeThrowQueue.length
        && penaltyResolution.stoppageId !== event.stoppageId
      ) return "PENALTY_IN_PROGRESS";
    } else if (
      penaltyResolution?.freeThrowQueue.length
      && event.type !== EventType.FREE_THROW
      && event.type !== EventType.SUBSTITUTION
    ) return "PENALTY_IN_PROGRESS";

    if (event.type === EventType.CLOCK_START) {
      if (state.clockRunning) return "CLOCK_ALREADY_RUNNING";
      return state.clock > 0 ? undefined : "INVALID_CLOCK_VALUE";
    }
    if (event.type === EventType.CLOCK_STOP) return state.clockRunning ? undefined : "CLOCK_NOT_RUNNING";
    if (event.type === EventType.CLOCK_SET) {
      const maximum = this.clockEngine.maximumFor(state.period, state.rules);
      return Number.isInteger(event.remainingSeconds) && event.remainingSeconds >= 0 && event.remainingSeconds <= maximum
        ? undefined
        : "INVALID_CLOCK_VALUE";
    }
    if (event.type === EventType.MATCH_END) {
      const canFinishPeriod = this.periodEngine.isFinalRegulation(state.period, state.rules)
        || state.period.kind === PeriodKind.OVERTIME;
      if (state.clock !== 0 || !canFinishPeriod) return "MATCH_NOT_READY_TO_FINISH";
      return state.home.score === state.away.score && state.rules.resultPolicy === ResultPolicy.REQUIRE_WINNER
        ? "MATCH_TIED"
        : undefined;
    }

    if (
      event.type === EventType.TWO_POINT
      || event.type === EventType.TWO_POINT_MISSED
      || event.type === EventType.THREE_POINT
      || event.type === EventType.THREE_POINT_MISSED
      || event.type === EventType.TURNOVER
    ) {
      if (event.team !== state.possession) {
        return event.type === EventType.TURNOVER ? "INVALID_POSSESSION_TEAM" : "INVALID_SCORING_TEAM";
      }
      const team = teamFor(state, event.team);
      const player = team.players.find((candidate) => candidate.playerId === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (!isPlayerEligible(player)) return "PLAYER_DISQUALIFIED";
      if (!player.onCourt) return "PLAYER_NOT_ON_COURT";
      if ((event.type === EventType.TWO_POINT || event.type === EventType.THREE_POINT) && event.assistPlayerId) {
        if (event.assistPlayerId === event.playerId) return "INVALID_ASSIST";
        const assister = team.players.find((candidate) => candidate.playerId === event.assistPlayerId);
        if (!assister || !isPlayerEligible(assister) || !assister.onCourt) return "INVALID_ASSIST";
      }
    }

    if (isFoulEvent(event)) return this.validateFoul(state, event, priorEvents);
    if (event.type === EventType.FREE_THROW) return this.validateFreeThrow(state, event);

    if (event.type === EventType.SUBSTITUTION) {
      if (event.playerInId === event.playerOutId) return "INVALID_SUBSTITUTION";
      const team = teamFor(state, event.team);
      const playerOut = team.players.find((candidate) => candidate.playerId === event.playerOutId);
      const playerIn = team.players.find((candidate) => candidate.playerId === event.playerInId);
      if (!playerOut || !playerIn) return "PLAYER_NOT_FOUND";
      if (!playerOut.onCourt) return "PLAYER_NOT_ON_COURT";
      if (playerIn.onCourt) return "PLAYER_ALREADY_ON_COURT";
      if (!isPlayerEligible(playerIn)) return "PLAYER_DISQUALIFIED";
    }
    if (event.type === EventType.TIMEOUT) {
      const team = teamFor(state, event.team);
      if (team.timeouts === 0) return "NO_TIMEOUTS_REMAINING";
    }
    if (event.type === EventType.REBOUND) {
      const player = teamFor(state, event.team).players.find(
        (candidate) => candidate.playerId === event.playerId,
      );
      const rejection = validateAvailablePlayer(player);
      if (rejection) return rejection;
    }
    if (event.type === EventType.STEAL || event.type === EventType.BLOCK) {
      if (event.team === state.possession) return "INVALID_DEFENSIVE_TEAM";
      const player = teamFor(state, event.team).players.find(
        (candidate) => candidate.playerId === event.playerId,
      );
      const rejection = validateAvailablePlayer(player);
      if (rejection) return rejection;
    }
    if (event.type === EventType.PERIOD_END) {
      if (!this.periodEngine.isValid(event.period, state.rules) || !periodsEqual(event.period, state.period)) {
        return "INVALID_PERIOD";
      }
      return state.clock === 0 ? undefined : "PERIOD_NOT_FINISHED";
    }
    if (event.type === EventType.PERIOD_START) {
      if (state.clock !== 0) return "PERIOD_NOT_FINISHED";
      if (!this.periodEngine.isValid(event.period, state.rules)) return "INVALID_PERIOD";
      const next = this.periodEngine.next(state.period, state.rules, state.home.score, state.away.score);
      if (!next) return event.period.kind === PeriodKind.OVERTIME ? "OVERTIME_NOT_REQUIRED" : "INVALID_PERIOD";
      return periodsEqual(event.period, next) ? undefined : "INVALID_PERIOD";
    }
    return undefined;
  }

  private validateFoul(
    state: MatchState,
    event: FoulEvent,
    priorEvents: readonly MatchEvent[],
  ): EventRejectionReason | undefined {
    if (event.stoppageId.trim().length === 0) return "INVALID_FOUL_CONTEXT";
    const foulingTeam = teamFor(state, event.team);

    if (event.offender.kind === FoulOffenderKind.PLAYER) {
      const playerId = event.offender.playerId;
      const player = foulingTeam.players.find(
        (candidate) => candidate.playerId === playerId,
      );
      const rejection = validateAvailablePlayer(player);
      if (rejection) return rejection;
    } else {
      if (event.offender.personId.trim().length === 0) return "INVALID_FOUL_OFFENDER";
      if (event.type !== EventType.TECHNICAL_FOUL && event.type !== EventType.DISQUALIFYING_FOUL) {
        return "INVALID_FOUL_OFFENDER";
      }
    }

    if (event.type === EventType.TECHNICAL_FOUL) {
      if (event.context.kind !== FoulContextKind.NON_CONTACT) return "INVALID_FOUL_CONTEXT";
      if (
        event.offender.kind === FoulOffenderKind.BENCH
        && event.category !== TechnicalFoulCategory.CATEGORY_1
      ) return "INVALID_FOUL_CONTEXT";
      return undefined;
    }

    if (event.offender.kind === FoulOffenderKind.BENCH) {
      return event.type === EventType.DISQUALIFYING_FOUL
        && event.context.kind === FoulContextKind.NON_CONTACT
        ? undefined
        : "INVALID_FOUL_CONTEXT";
    }

    if (event.context.kind === FoulContextKind.SHOOTING) {
      const relatedShotEventId = "relatedShotEventId" in event
        ? event.relatedShotEventId
        : undefined;
      if (!relatedShotEventId || !event.fouledPlayerId) return "INVALID_CAUSAL_REFERENCE";
      const shot = priorEvents.find((candidate) => candidate.id === relatedShotEventId);
      if (
        !shot
        || !isShotEvent(shot)
        || !shot.stoppageId
        || shot.stoppageId !== event.stoppageId
        || shot.team === event.team
        || shot.playerId !== event.fouledPlayerId
      ) return "INVALID_CAUSAL_REFERENCE";
      return this.validateFouledPlayer(state, event.team, event.fouledPlayerId, true);
    }

    if (event.context.kind === FoulContextKind.NON_CONTACT) {
      return event.type === EventType.DISQUALIFYING_FOUL
        ? undefined
        : "INVALID_FOUL_CONTEXT";
    }

    if (event.fouledPlayerId) {
      const rejection = this.validateFouledPlayer(state, event.team, event.fouledPlayerId, true);
      if (rejection) return rejection;
    }

    if (
      (event.type === EventType.DISRUPTIVE_FOUL || event.type === EventType.FLAGRANT_FOUL)
      && !event.fouledPlayerId
    ) return "INVALID_FOUL_CONTEXT";

    if (
      event.type === EventType.PERSONAL_FOUL
      && !event.context.teamControlFoul
      && foulingTeam.teamFouls + 1 >= state.rules.teamFoulPenaltyThreshold
      && !event.fouledPlayerId
    ) return "INVALID_FREE_THROW_SHOOTER";

    return undefined;
  }

  private validateFreeThrow(
    state: MatchState,
    event: Extract<MatchEvent, { type: typeof EventType.FREE_THROW }>,
  ): EventRejectionReason | undefined {
    const penalty = state.penaltyResolution?.freeThrowQueue[0];
    if (!penalty) return "NO_ACTIVE_PENALTY";
    if (event.penaltyId !== penalty.penaltyId) return "INVALID_PENALTY_ID";
    if (event.attemptIndex !== penalty.completedAttempts + 1) return "INVALID_FREE_THROW_ORDER";
    if (event.team !== penalty.beneficiaryTeam) return "INVALID_FREE_THROW_SHOOTER";

    const player = teamFor(state, event.team).players.find(
      (candidate) => candidate.playerId === event.playerId,
    );
    if (!player || !isPlayerEligible(player)) return "INVALID_FREE_THROW_SHOOTER";
    if (
      penalty.shooterPolicy === ShooterPolicy.FOULED_PLAYER
      && event.playerId !== penalty.designatedPlayerId
    ) return "INVALID_FREE_THROW_SHOOTER";
    return undefined;
  }

  private validateFouledPlayer(
    state: MatchState,
    foulingTeam: TeamSide,
    playerId: string,
    mustBeOnCourt: boolean,
  ): EventRejectionReason | undefined {
    const player = teamFor(state, opposite(foulingTeam)).players.find(
      (candidate) => candidate.playerId === playerId,
    );
    if (!player || !isPlayerEligible(player)) return "INVALID_FREE_THROW_SHOOTER";
    return mustBeOnCourt && !player.onCourt ? "PLAYER_NOT_ON_COURT" : undefined;
  }
}

function teamFor(state: MatchState, side: TeamSide): Team {
  return side === TeamSide.HOME ? state.home : state.away;
}

function opposite(side: TeamSide): TeamSide {
  return side === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME;
}

function isPlayerEligible(player: Player): boolean {
  return player.foulState.status === PlayerFoulStatus.ELIGIBLE;
}

function validateAvailablePlayer(player: Player | undefined): EventRejectionReason | undefined {
  if (!player) return "PLAYER_NOT_FOUND";
  return isPlayerEligible(player) ? undefined : "PLAYER_DISQUALIFIED";
}

function isShotEvent(event: MatchEvent): event is ScoringShotEvent {
  return event.type === EventType.TWO_POINT
    || event.type === EventType.TWO_POINT_MISSED
    || event.type === EventType.THREE_POINT
    || event.type === EventType.THREE_POINT_MISSED;
}

function isFoulEvent(event: MatchEvent): event is FoulEvent {
  return event.type === EventType.PERSONAL_FOUL
    || event.type === EventType.TECHNICAL_FOUL
    || event.type === EventType.DISRUPTIVE_FOUL
    || event.type === EventType.FLAGRANT_FOUL
    || event.type === EventType.DISQUALIFYING_FOUL;
}
