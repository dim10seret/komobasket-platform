export type SeasonStatus = "draft" | "active" | "completed";
export type CompetitionType = "league" | "cup" | "tournament";
export type RosterStatus = "active" | "departed" | "transferred";
export type GameStatus = "scheduled" | "completed" | "postponed" | "cancelled";

export interface LeagueSeason {
  id: string;
  name: string;
  slug: string;
  startsOn: string | null;
  endsOn: string | null;
  status: SeasonStatus;
}

export interface LeagueCompetition {
  id: string;
  seasonId: string;
  seasonName?: string;
  name: string;
  slug: string;
  type: CompetitionType;
  description: string;
  status: SeasonStatus;
}

export interface LeagueTeam {
  id: string;
  name: string;
  slug: string;
  city: string;
  logoUrl: string | null;
  active: boolean;
}

export interface LeaguePlayer {
  id: string;
  slug: string;
  displayName: string;
  normalizedName: string;
  active: boolean;
}

export interface LeagueRosterEntry {
  id: string;
  seasonId: string;
  seasonName?: string;
  competitionId: string | null;
  playerId: string;
  playerName?: string;
  teamId: string;
  teamName?: string;
  shirtNumber: number | null;
  joinedOn: string | null;
  leftOn: string | null;
  status: RosterStatus;
}

export interface LeaguePhase {
  id: string;
  competitionId: string;
  name: string;
  slug: string;
  phaseType: string;
  orderIndex: number;
}

export interface LeagueGame {
  id: string;
  competitionId: string;
  phaseId: string | null;
  phaseName?: string;
  roundLabel: string;
  scheduledAt: string | null;
  venue: string;
  homeTeamId: string;
  homeTeamName?: string;
  awayTeamId: string;
  awayTeamName?: string;
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
}

export interface PlayerCareerSeason {
  season: string;
  team: string;
  competition: string;
  status: RosterStatus;
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threes: number;
}

export interface PlayerCareer {
  playerId: string;
  slug: string;
  name: string;
  seasons: PlayerCareerSeason[];
  totals: Omit<PlayerCareerSeason, "season" | "team" | "competition" | "status">;
}
