import type { Team } from "../types/team";
import type { TeamSide } from "../types/team-side";
import type { Player } from "../types/player";

export function createTeam(id: string, name: string, side: TeamSide, players: Player[] = []): Team {
  return {
    id, name, side, score: 0, timeouts: 5, teamFouls: 0, players,
    statistics: {
      twoPointAttempts: 0, twoPointMade: 0, threePointAttempts: 0, threePointMade: 0,
      freeThrowAttempts: 0, freeThrowMade: 0, turnovers: 0, personalFouls: 0, shootingFouls: 0, technicalFouls: 0, unsportsmanlikeFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, steals: 0, blocks: 0,
    },
  };
}
