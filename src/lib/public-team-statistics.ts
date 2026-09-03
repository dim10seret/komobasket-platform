import { matchReportEfficiency } from "./platform-match-report-statistics";
import type { PlatformMatchReportStatisticsLine } from "./platform-match-report";

export type PublicTeamStatisticsSourcePlayer = {
  canonicalPlayerId: string;
  displayName: string;
  shirtNumber: string;
  statistics: PlatformMatchReportStatisticsLine;
};

export type PublicTeamStatisticsSourceGame = {
  gameId: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  homePlayers: PublicTeamStatisticsSourcePlayer[];
  awayPlayers: PublicTeamStatisticsSourcePlayer[];
};

export type PublicTeamStatisticsPlayer = PublicTeamStatisticsSourcePlayer & {
  gamesPlayed: number;
};

export type PublicTeamStatisticsGame = {
  gameId: string;
  scheduledDate: string | null;
  opponentName: string;
  scoreFor: number;
  scoreAgainst: number;
  label: string;
  matchupLabel: string;
  players: PublicTeamStatisticsPlayer[];
};

export type PublicTeamStatistics = {
  team: { id: string; name: string };
  games: PublicTeamStatisticsGame[];
  total: {
    teamGamesPlayed: number;
    players: PublicTeamStatisticsPlayer[];
  };
};

export type PublicTeamStatisticsRosterPlayer = {
  id: string;
  displayName: string;
  shirtNumber: number | null;
};

export const ZERO_STATISTICS: PlatformMatchReportStatisticsLine = {
  points: 0,
  twoPointMade: 0,
  twoPointAttempts: 0,
  threePointMade: 0,
  threePointAttempts: 0,
  freeThrowMade: 0,
  freeThrowAttempts: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
  efficiency: 0,
};

function dateLabel(value: string | null): string {
  if (!value) return "Χωρίς ημερομηνία";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function aggregateLine(left: PlatformMatchReportStatisticsLine, right: PlatformMatchReportStatisticsLine): PlatformMatchReportStatisticsLine {
  const base = {
    points: left.points + right.points,
    twoPointMade: left.twoPointMade + right.twoPointMade,
    twoPointAttempts: left.twoPointAttempts + right.twoPointAttempts,
    threePointMade: left.threePointMade + right.threePointMade,
    threePointAttempts: left.threePointAttempts + right.threePointAttempts,
    freeThrowMade: left.freeThrowMade + right.freeThrowMade,
    freeThrowAttempts: left.freeThrowAttempts + right.freeThrowAttempts,
    offensiveRebounds: left.offensiveRebounds + right.offensiveRebounds,
    defensiveRebounds: left.defensiveRebounds + right.defensiveRebounds,
    rebounds: left.offensiveRebounds + right.offensiveRebounds + left.defensiveRebounds + right.defensiveRebounds,
    assists: left.assists + right.assists,
    steals: left.steals + right.steals,
    blocks: left.blocks + right.blocks,
    turnovers: left.turnovers + right.turnovers,
    fouls: left.fouls + right.fouls,
  };
  return { ...base, efficiency: matchReportEfficiency(base) };
}

function shirtSort(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return Number.MAX_SAFE_INTEGER;
  return value === "00" ? 0.5 : Number(value);
}

function sortPlayers(players: PublicTeamStatisticsPlayer[]): PublicTeamStatisticsPlayer[] {
  return [...players].sort((left, right) => shirtSort(left.shirtNumber) - shirtSort(right.shirtNumber)
    || left.displayName.localeCompare(right.displayName, "el")
    || left.canonicalPlayerId.localeCompare(right.canonicalPlayerId));
}

export function buildPublicTeamStatistics(input: {
  team: { id: string; name: string };
  roster: PublicTeamStatisticsRosterPlayer[];
  games: PublicTeamStatisticsSourceGame[];
}): PublicTeamStatistics {
  const games = [...input.games].sort((left, right) => (left.scheduledDate ?? "9999-99-99").localeCompare(right.scheduledDate ?? "9999-99-99")
    || (left.scheduledTime ?? "99:99").localeCompare(right.scheduledTime ?? "99:99")
    || left.gameId.localeCompare(right.gameId));
  const currentRoster = new Map(input.roster.map((player) => [player.id, player]));
  const totals = new Map<string, PublicTeamStatisticsPlayer>();
  for (const player of input.roster) {
    totals.set(player.id, {
      canonicalPlayerId: player.id,
      displayName: player.displayName,
      shirtNumber: player.shirtNumber === null ? "" : String(player.shirtNumber),
      gamesPlayed: 0,
      statistics: { ...ZERO_STATISTICS },
    });
  }

  const projectedGames = games.flatMap((game): PublicTeamStatisticsGame[] => {
    const isHome = game.homeTeamId === input.team.id;
    const isAway = game.awayTeamId === input.team.id;
    if (!isHome && !isAway) return [];
    const sourcePlayers = isHome ? game.homePlayers : game.awayPlayers;
    const scoreFor = isHome ? game.homeScore : game.awayScore;
    const scoreAgainst = isHome ? game.awayScore : game.homeScore;
    const opponentName = isHome ? game.awayTeamName : game.homeTeamName;
    for (const player of sourcePlayers) {
      const existing = totals.get(player.canonicalPlayerId);
      const rosterPlayer = currentRoster.get(player.canonicalPlayerId);
      totals.set(player.canonicalPlayerId, {
        canonicalPlayerId: player.canonicalPlayerId,
        displayName: rosterPlayer?.displayName ?? player.displayName,
        shirtNumber: rosterPlayer ? (rosterPlayer.shirtNumber === null ? "" : String(rosterPlayer.shirtNumber)) : player.shirtNumber,
        gamesPlayed: (existing?.gamesPlayed ?? 0) + 1,
        statistics: aggregateLine(existing?.statistics ?? ZERO_STATISTICS, player.statistics),
      });
    }
    const label = `${dateLabel(game.scheduledDate)} · vs ${opponentName} · ${scoreFor}-${scoreAgainst}`;
    return [{
      gameId: game.gameId,
      scheduledDate: game.scheduledDate,
      opponentName,
      scoreFor,
      scoreAgainst,
      label,
      matchupLabel: `${game.homeTeamName} ${game.homeScore}-${game.awayScore} ${game.awayTeamName}`,
      players: sourcePlayers.map((player) => ({ ...player, gamesPlayed: 1 })),
    }];
  });

  return {
    team: input.team,
    games: projectedGames,
    total: {
      teamGamesPlayed: projectedGames.length,
      players: sortPlayers([...totals.values()]),
    },
  };
}
