import { TeamSide } from "./team-side";
import type { Player } from "./player";
import type { TeamStatistics } from "./statistics";

export interface Team {

  id: string;

  name: string;

  side: TeamSide;

  score: number;

  timeouts: number;

  teamFouls: number;

  players: Player[];

  statistics: TeamStatistics;

}
