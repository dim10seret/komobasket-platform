export interface Game {
  id: number;

  season: string;

  round: number;

  date: string;

  homeTeamId: number;

  awayTeamId: number;

  homeScore: number;

  awayScore: number;

  played: boolean;
}