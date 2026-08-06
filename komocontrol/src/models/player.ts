import type { Player } from "../types/player";
import type { TeamSide } from "../types/team-side";

export function createPlayer(id: string, team: TeamSide, number: number, firstName: string, lastName: string): Player {
  return {
    id, team, number, firstName, lastName, onCourt: false, fouls: 0, disqualified: false,
    statistics: {
      points: 0, twoPointAttempts: 0, twoPointMade: 0, threePointAttempts: 0,
      threePointMade: 0, freeThrowAttempts: 0, freeThrowMade: 0, turnovers: 0, shootingFouls: 0, technicalFouls: 0, unsportsmanlikeFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, steals: 0, blocks: 0,
    },
  };
}
