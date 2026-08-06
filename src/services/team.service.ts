import { teams } from "@/data/teams";
import { Team } from "@/types/team";

export function getTeams(): Team[] {
  return teams;
}

export function getTeamBySlug(slug: string): Team | undefined {
  return teams.find((team) => team.slug === slug);
}

export function getTeamById(id: number): Team | undefined {
  return teams.find((team) => team.id === id);
}

export function getTeamsBySeason(season: string): Team[] {
  return teams.filter((team) => team.season === season);
}
