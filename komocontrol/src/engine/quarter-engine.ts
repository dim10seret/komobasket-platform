import { Quarter } from "../types/quarter";
import type { MatchState } from "../types/match-state";

const REGULATION_QUARTERS = new Set<Quarter>([Quarter.Q1, Quarter.Q2, Quarter.Q3, Quarter.Q4]);

export class QuarterEngine {
  next(quarter: Quarter): Quarter | undefined {
    const periods: Quarter[] = [Quarter.Q1, Quarter.Q2, Quarter.Q3, Quarter.Q4, Quarter.OT1, Quarter.OT2, Quarter.OT3];
    const index = periods.indexOf(quarter);
    return periods[index + 1];
  }

  start(state: MatchState, quarter: Quarter): void {
    state.quarter = quarter;
    state.clock = REGULATION_QUARTERS.has(quarter) ? 600 : 300;
    state.clockRunning = false;
    state.home.teamFouls = 0;
    state.away.teamFouls = 0;
  }

  end(state: MatchState, quarter: Quarter): void {
    if (state.quarter === quarter) {
      state.clock = 0;
      state.clockRunning = false;
    }
  }
}
