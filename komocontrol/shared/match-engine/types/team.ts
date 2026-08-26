import type { TeamDisciplineState } from "./foul.js";
import type { Player } from "./player.js";
import type { TeamStatistics } from "./statistics.js";
import type { TeamSide } from "./team-side.js";

export interface Team {
  id: string;
  name: string;
  side: TeamSide;
  score: number;
  timeouts: number;
  teamFouls: number;
  discipline: TeamDisciplineState;
  players: Player[];
  statistics: TeamStatistics;
}
