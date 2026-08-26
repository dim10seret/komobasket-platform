import type { MatchPeriod } from "./period.js";
import type { PenaltyEntitlement } from "./penalty.js";
import type { MatchRulesV1 } from "./rules.js";
import type { Team } from "./team.js";
import type { TeamSide } from "./team-side.js";

export interface MatchState {
  id: string;
  readonly rules: MatchRulesV1;
  period: MatchPeriod;
  clock: number;
  clockRunning: boolean;
  started: boolean;
  home: Team;
  away: Team;
  possession: TeamSide | null;
  alternatingPossession: TeamSide;
  penaltyEntitlement?: PenaltyEntitlement;
  finished: boolean;
  lastProcessedSequence: number;
}
