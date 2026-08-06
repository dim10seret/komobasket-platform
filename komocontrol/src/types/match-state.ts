import type { Quarter } from "./quarter";
import type { Team } from "./team";
import type { TeamSide } from "./team-side";
import type { FreeThrowSeries } from "./free-throw-series";

export interface MatchState {

  id: string;

  quarter: Quarter;

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
