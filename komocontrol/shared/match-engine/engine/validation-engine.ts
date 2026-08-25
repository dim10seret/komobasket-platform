import { EventType } from "../types/event-type.js";
import type { MatchEvent } from "../types/event.js";
import type { EventRejectionReason } from "../types/event-result.js";
import type { MatchState } from "../types/match-state.js";
import { QuarterEngine } from "./quarter-engine.js";
import { ClockEngine } from "./clock-engine.js";
import { Quarter } from "../types/quarter.js";

export class ValidationEngine {
  private readonly quarterEngine = new QuarterEngine();
  private readonly clockEngine = new ClockEngine();

  validate(state: MatchState, event: MatchEvent): EventRejectionReason | undefined {
    if (event.sequence <= state.lastProcessedSequence) return "INVALID_EVENT_SEQUENCE";
    if (state.finished) return "MATCH_ALREADY_FINISHED";
    if (event.type === EventType.MATCH_START) {
      if (state.started) return "MATCH_ALREADY_STARTED";
      return state.home.players.filter((player) => player.onCourt).length === 5
        && state.away.players.filter((player) => player.onCourt).length === 5
        ? undefined
        : "INVALID_LINEUP";
    }
    if (event.type === EventType.LINEUP_SET) {
      if (state.started || event.playerIds.length !== 5 || new Set(event.playerIds).size !== 5) return "INVALID_LINEUP";
      const team = event.team === "HOME" ? state.home : state.away;
      const valid = event.playerIds.every((id) => {
        const player = team.players.find((candidate) => candidate.id === id);
        return player !== undefined && !player.disqualified;
      });
      return valid ? undefined : "INVALID_LINEUP";
    }
    if (!state.started) return "MATCH_NOT_STARTED";
    // A substitution is allowed between free throws; it must not make the scorer
    // wait until the complete series has been recorded.
    if (state.freeThrowSeries && event.type !== EventType.FREE_THROW && event.type !== EventType.SUBSTITUTION) return "FREE_THROW_SERIES_IN_PROGRESS";
    if (event.type === EventType.CLOCK_START) {
      if (state.clockRunning) return "CLOCK_ALREADY_RUNNING";
      return state.clock > 0 ? undefined : "INVALID_CLOCK_VALUE";
    }
    if (event.type === EventType.CLOCK_STOP) return state.clockRunning ? undefined : "CLOCK_NOT_RUNNING";
    if (event.type === EventType.CLOCK_SET) {
      const maximum = this.clockEngine.maximumFor(state.quarter);
      return Number.isInteger(event.remainingSeconds) && event.remainingSeconds >= 0 && event.remainingSeconds <= maximum
        ? undefined
        : "INVALID_CLOCK_VALUE";
    }
    if (event.type === EventType.MATCH_END) {
      if (state.clock !== 0 || state.quarter < Quarter.Q4) return "MATCH_NOT_READY_TO_FINISH";
      return state.home.score === state.away.score ? "MATCH_TIED" : undefined;
    }
    if (
      event.type === EventType.TWO_POINT || event.type === EventType.TWO_POINT_MISSED
      || event.type === EventType.THREE_POINT || event.type === EventType.THREE_POINT_MISSED
      || event.type === EventType.TURNOVER
    ) {
      if (event.team !== state.possession) {
        return event.type === EventType.TURNOVER ? "INVALID_POSSESSION_TEAM" : "INVALID_SCORING_TEAM";
      }
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
      if (!player.onCourt) return "PLAYER_NOT_ON_COURT";
      if ((event.type === EventType.TWO_POINT || event.type === EventType.THREE_POINT) && event.assistPlayerId) {
        if (event.assistPlayerId === event.playerId) return "INVALID_ASSIST";
        const assister = team.players.find((candidate) => candidate.id === event.assistPlayerId);
        if (!assister || assister.disqualified || !assister.onCourt) return "INVALID_ASSIST";
      }
    }
    if (event.type === EventType.PERSONAL_FOUL || event.type === EventType.SHOOTING_FOUL) {
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
      if (event.type === EventType.SHOOTING_FOUL) {
        const shootingTeam = event.team === "HOME" ? state.away : state.home;
        const shooter = shootingTeam.players.find((candidate) => candidate.id === event.fouledPlayerId);
        if (!shooter || shooter.disqualified) return "INVALID_FREE_THROW_SHOOTER";
      }
      if (event.type === EventType.PERSONAL_FOUL && team.teamFouls >= 4) {
        if (!event.fouledPlayerId) return "INVALID_FREE_THROW_SHOOTER";
        return this.validatePenaltyShooter(state, event.team, event.fouledPlayerId, true);
      }
    }
    if (event.type === EventType.FREE_THROW) {
      const series = state.freeThrowSeries;
      if (!series) return "NO_FREE_THROW_SERIES";
      if (event.team !== series.shootingTeam || event.playerId !== series.shooterId) return "INVALID_FREE_THROW_SHOOTER";
      if (event.isFinalAttempt !== (series.remainingAttempts === 1)) return "INVALID_FREE_THROW_ORDER";
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
    }
    if (event.type === EventType.SUBSTITUTION) {
      if (event.playerInId === event.playerOutId) return "INVALID_SUBSTITUTION";
      const team = event.team === "HOME" ? state.home : state.away;
      const playerOut = team.players.find((candidate) => candidate.id === event.playerOutId);
      const playerIn = team.players.find((candidate) => candidate.id === event.playerInId);
      if (!playerOut || !playerIn) return "PLAYER_NOT_FOUND";
      if (!playerOut.onCourt) return "PLAYER_NOT_ON_COURT";
      if (playerIn.onCourt) return "PLAYER_ALREADY_ON_COURT";
      if (playerIn.disqualified) return "PLAYER_DISQUALIFIED";
    }
    if (event.type === EventType.TIMEOUT) {
      const team = event.team === "HOME" ? state.home : state.away;
      if (team.timeouts === 0) return "NO_TIMEOUTS_REMAINING";
    }
    if (event.type === EventType.TECHNICAL_FOUL && event.playerId) {
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
    }
    if (event.type === EventType.TECHNICAL_FOUL) {
      return this.validatePenaltyShooter(state, event.team, event.freeThrowPlayerId);
    }
    if (event.type === EventType.UNSPORTSMANLIKE_FOUL) {
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
      return this.validatePenaltyShooter(state, event.team, event.fouledPlayerId, true);
    }
    if (event.type === EventType.DISQUALIFYING_FOUL) {
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
      return this.validatePenaltyShooter(state, event.team, event.freeThrowPlayerId);
    }
    if (event.type === EventType.REBOUND) {
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
    }
    if (event.type === EventType.STEAL || event.type === EventType.BLOCK) {
      if (event.team === state.possession) return "INVALID_DEFENSIVE_TEAM";
      const team = event.team === "HOME" ? state.home : state.away;
      const player = team.players.find((candidate) => candidate.id === event.playerId);
      if (!player) return "PLAYER_NOT_FOUND";
      if (player.disqualified) return "PLAYER_DISQUALIFIED";
    }
    if (event.type === EventType.QUARTER_END) {
      return event.quarter === state.quarter ? undefined : "INVALID_QUARTER";
    }
    if (event.type === EventType.QUARTER_START) {
      if (state.clock !== 0) return "PERIOD_NOT_FINISHED";
      if (event.quarter > Quarter.Q4) return "INVALID_QUARTER";
      return event.quarter === this.quarterEngine.next(state.quarter) ? undefined : "INVALID_QUARTER";
    }
    if (event.type === EventType.OVERTIME_START) {
      if (state.clock !== 0) return "PERIOD_NOT_FINISHED";
      if (state.home.score !== state.away.score) return "OVERTIME_NOT_REQUIRED";
      if (event.quarter < Quarter.OT1) return "INVALID_QUARTER";
      return event.quarter === this.quarterEngine.next(state.quarter) ? undefined : "INVALID_QUARTER";
    }
    return undefined;
  }

  private validatePenaltyShooter(
    state: MatchState,
    foulingTeam: "HOME" | "AWAY",
    shooterId: string,
    mustBeOnCourt = false,
  ): EventRejectionReason | undefined {
    const shootingTeam = foulingTeam === "HOME" ? state.away : state.home;
    const shooter = shootingTeam.players.find((candidate) => candidate.id === shooterId);
    if (!shooter || shooter.disqualified) return "INVALID_FREE_THROW_SHOOTER";
    return mustBeOnCourt && !shooter.onCourt ? "PLAYER_NOT_ON_COURT" : undefined;
  }
}
