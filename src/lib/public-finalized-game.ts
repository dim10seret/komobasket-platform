import type {
  PlatformMatchReport,
  PlatformMatchReportPeriodScore,
  PlatformMatchReportPlayer,
  PlatformMatchReportStatisticsLine,
} from "./platform-match-report";

export type PublicFinalizedGamePlayer = PlatformMatchReportPlayer;
export type PublicFinalizedGameTeam = {
  name: string;
  logoUrl: string | null;
  players: PublicFinalizedGamePlayer[];
  totals: PlatformMatchReportStatisticsLine;
};

export type PublicFinalizedGameDetail = {
  status: "finalized";
  game: {
    gameId: string;
    competition: string;
    season: string;
    phase: string | null;
    round: string | null;
    scheduledDate: string | null;
    scheduledTime: string | null;
    venue: string | null;
    finalScore: { home: number; away: number };
    winner: "HOME" | "AWAY" | null;
    periodScores: PlatformMatchReportPeriodScore[];
  };
  teams: {
    home: PublicFinalizedGameTeam;
    away: PublicFinalizedGameTeam;
  };
};

function publicTeam(
  identity: PlatformMatchReport["game"]["homeTeam"],
  statistics: PlatformMatchReport["statistics"]["home"],
): PublicFinalizedGameTeam {
  return {
    name: identity.name,
    logoUrl: identity.logoUrl,
    players: statistics.players.map((player) => ({
      shirtNumber: player.shirtNumber,
      displayName: player.displayName,
      starter: player.starter,
      finalStatus: player.finalStatus,
      finalStatusReason: player.finalStatusReason,
      statistics: { ...player.statistics },
    })),
    totals: { ...statistics.totals },
  };
}

export function projectPublicFinalizedGame(report: PlatformMatchReport): PublicFinalizedGameDetail {
  return {
    status: "finalized",
    game: {
      gameId: report.game.gameId,
      competition: report.game.competition,
      season: report.game.season,
      phase: report.game.phase,
      round: report.game.round,
      scheduledDate: report.game.scheduledDate,
      scheduledTime: report.game.scheduledTime,
      venue: report.game.venue,
      finalScore: { ...report.game.finalScore },
      winner: report.game.winner,
      periodScores: report.game.periodScores.map((period) => ({ period: { ...period.period }, home: period.home, away: period.away })),
    },
    teams: {
      home: publicTeam(report.game.homeTeam, report.statistics.home),
      away: publicTeam(report.game.awayTeam, report.statistics.away),
    },
  };
}
