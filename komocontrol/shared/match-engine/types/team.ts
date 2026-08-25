import { TeamSide } from "./team-side.js";
import type { Player } from "./player.js";
import type { TeamStatistics } from "./statistics.js";

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
