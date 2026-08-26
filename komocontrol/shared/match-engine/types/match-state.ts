import type { MatchPeriod } from "./period.js";
import type { MatchRulesV1 } from "./rules.js";
import type { Team } from "./team.js";
import type { TeamSide } from "./team-side.js";
import type { FreeThrowSeries } from "./free-throw-series.js";

export interface MatchState {
  id: string;
  readonly rules: MatchRulesV1;
  period: MatchPeriod;
  clock: number;
  clockRunning: boolean;
  started: boolean;
  home: Team;
  away: Team;
  possession: TeamSide;
  alternatingPossession: TeamSide;
  freeThrowSeries?: FreeThrowSeries;
  finished: boolean;
  lastProcessedSequence: number;
}
