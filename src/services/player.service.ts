import { players } from "@/data/players";
import { Player } from "@/types/player";

export function getPlayers(): Player[] {
  return players;
}

export function getPlayerById(id: number): Player | undefined {
  return players.find((player) => player.id === id);
}

export function getPlayerBySlug(slug: string): Player | undefined {
  return players.find((player) => player.slug === slug);
}

export function getPlayersByTeam(teamSlug: string, season?: string): Player[] {
  return players.filter(
    (player) => player.teamSlug === teamSlug && (!season || player.season === season),
  );
}

export function getPlayersBySeason(season: string): Player[] {
  return players.filter((player) => player.season === season);
}
