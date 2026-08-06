import type { MatchState } from "../types/match-state";
import { Quarter } from "../types/quarter";

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

  maximumFor(quarter: Quarter): number {
    return quarter <= Quarter.Q4 ? 600 : 300;
  }
}
