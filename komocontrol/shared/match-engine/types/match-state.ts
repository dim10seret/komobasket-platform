import type { Quarter } from "./quarter.js";
import type { Team } from "./team.js";
import type { TeamSide } from "./team-side.js";
import type { FreeThrowSeries } from "./free-throw-series.js";

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
