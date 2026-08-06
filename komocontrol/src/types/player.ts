import { TeamSide } from "./team-side";
import type { PlayerStatistics } from "./statistics";

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
