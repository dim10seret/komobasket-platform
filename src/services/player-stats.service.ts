import { playerStats } from "@/data/player-stats";
import { PlayerStats } from "@/types/player-stats";

export function getPlayerStats(playerSlug: string): PlayerStats | undefined {
  return playerStats.find(
    (stats) => stats.playerSlug === playerSlug
  );
}