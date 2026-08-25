import { TeamSide } from "./team-side.js";
import type { PlayerStatistics } from "./statistics.js";

export interface Player {

  id: string;

  number: number;

  firstName: string;

  lastName: string;

  team: TeamSide;

  onCourt: boolean;

  fouls: number;

  disqualified: boolean;

  statistics: PlayerStatistics;

}
