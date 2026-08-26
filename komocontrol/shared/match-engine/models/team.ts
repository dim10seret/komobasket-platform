import type { Player } from "../types/player.js";
import type { Team } from "../types/team.js";
import type { TeamSide } from "../types/team-side.js";

export function createTeam(id: string, name: string, side: TeamSide, players: Player[] = []): Team {
  return {
    id,
    name,
    side,
    score: 0,
    timeouts: 5,
    teamFouls: 0,
    discipline: {
      headCoachCategory1TechnicalCount: 0,
      benchCategory1TechnicalCount: 0,
      headCoachDisqualified: false,
      disqualifiedBenchPersonIds: [],
    },
    players,
    statistics: {
      twoPointAttempts: 0,
      twoPointMade: 0,
      threePointAttempts: 0,
      threePointMade: 0,
      freeThrowAttempts: 0,
      freeThrowMade: 0,
      turnovers: 0,
      personalFouls: 0,
      technicalFouls: 0,
      disruptiveFouls: 0,
      flagrantFouls: 0,
      disqualifyingFouls: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
    },
  };
}
