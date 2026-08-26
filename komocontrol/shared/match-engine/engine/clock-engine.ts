import type { MatchState } from "../types/match-state.js";
import { PeriodKind, type MatchPeriod } from "../types/period.js";
import type { MatchRulesV1 } from "../types/rules.js";

export class ClockEngine {
  start(state: MatchState): void {
    state.clockRunning = true;
  }

  stop(state: MatchState): void {
    state.clockRunning = false;
  }

  set(state: MatchState, remainingSeconds: number): void {
    state.clock = remainingSeconds;
    if (remainingSeconds === 0) state.clockRunning = false;
  }

  maximumFor(period: MatchPeriod, rules: MatchRulesV1): number {
    return period.kind === PeriodKind.REGULATION ? rules.regulationPeriodSeconds : rules.overtimeSeconds;
  }
}
