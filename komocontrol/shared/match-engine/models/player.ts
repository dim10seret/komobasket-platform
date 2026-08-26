import type { Player, ShirtNumber } from "../types/player.js";
import type { TeamSide } from "../types/team-side.js";

export interface CreatePlayerOptions {
  playerId: string;
  displayName: string;
  shirtNumber: string;
  team: TeamSide;
  onCourt?: boolean;
}

export function isShirtNumber(value: string): value is ShirtNumber {
  return /^(?:0|00|[1-9][0-9]?)$/.test(value);
}

export function createPlayer(options: CreatePlayerOptions): Player {
  if (options.playerId.trim().length === 0) throw new Error("Player ID is required.");
  if (options.displayName.trim().length === 0) throw new Error("Player display name is required.");
  if (!isShirtNumber(options.shirtNumber)) throw new Error("Invalid shirt number.");

  return {
    playerId: options.playerId,
    displayName: options.displayName,
    shirtNumber: options.shirtNumber,
    team: options.team,
    onCourt: options.onCourt ?? false,
    fouls: 0,
    disqualified: false,
    statistics: {
      points: 0, twoPointAttempts: 0, twoPointMade: 0, threePointAttempts: 0,
      threePointMade: 0, freeThrowAttempts: 0, freeThrowMade: 0, turnovers: 0, shootingFouls: 0, technicalFouls: 0, unsportsmanlikeFouls: 0, disqualifyingFouls: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, steals: 0, blocks: 0,
    },
  };
}
