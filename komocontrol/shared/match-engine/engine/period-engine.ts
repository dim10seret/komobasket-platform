import type { MatchState } from "../types/match-state.js";
import {
  PeriodKind,
  isMatchPeriod,
  overtimePeriod,
  periodsEqual,
  regulationPeriod,
  type MatchPeriod,
} from "../types/period.js";
import { ResultPolicy, type MatchRulesV1 } from "../types/rules.js";

export class PeriodEngine {
  isValid(period: unknown, rules: MatchRulesV1): period is MatchPeriod {
    return isMatchPeriod(period)
      && (period.kind === PeriodKind.OVERTIME || period.index <= rules.regulationPeriods);
  }

  isFinalRegulation(period: MatchPeriod, rules: MatchRulesV1): boolean {
    return period.kind === PeriodKind.REGULATION && period.index === rules.regulationPeriods;
  }

  next(period: MatchPeriod, rules: MatchRulesV1, homeScore: number, awayScore: number): MatchPeriod | undefined {
    if (!this.isValid(period, rules)) return undefined;
    if (period.kind === PeriodKind.REGULATION && period.index < rules.regulationPeriods) {
      return regulationPeriod(period.index + 1);
    }
    if (homeScore !== awayScore || rules.resultPolicy === ResultPolicy.ALLOW_TIE) return undefined;
    return period.kind === PeriodKind.REGULATION ? overtimePeriod(1) : overtimePeriod(period.index + 1);
  }

  durationFor(period: MatchPeriod, rules: MatchRulesV1): number {
    if (!this.isValid(period, rules)) throw new Error("Cannot resolve duration for an invalid match period.");
    return period.kind === PeriodKind.REGULATION ? rules.regulationPeriodSeconds : rules.overtimeSeconds;
  }

  shouldResetTeamFouls(current: MatchPeriod, next: MatchPeriod, rules: MatchRulesV1): boolean {
    return this.isValid(current, rules)
      && this.isValid(next, rules)
      && current.kind === PeriodKind.REGULATION
      && next.kind === PeriodKind.REGULATION
      && next.index === current.index + 1;
  }

  start(state: MatchState, period: MatchPeriod): void {
    state.period = { ...period };
    state.clock = this.durationFor(period, state.rules);
    state.clockRunning = false;
  }

  end(state: MatchState, period: MatchPeriod): void {
    if (!periodsEqual(state.period, period)) return;
    state.clock = 0;
    state.clockRunning = false;
  }
}
