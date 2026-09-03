import type { PlatformMatchReportStatisticsLine } from "./platform-match-report";
import type { PublicTeamStatisticsSourceGame } from "./public-team-statistics";
import { aggregateLine, ZERO_STATISTICS } from "./public-team-statistics";

export const PUBLIC_LEADER_CATEGORIES = ["points", "threePointers", "twoPointers", "freeThrows", "rebounds", "offensiveRebounds", "defensiveRebounds", "assists", "steals", "blocks", "efficiency"] as const;
export type PublicLeaderCategory = typeof PUBLIC_LEADER_CATEGORIES[number];

export type PublicCompetitionStatisticsPlayer = {
  displayName: string;
  teamName: string;
  gamesPlayed: number;
  statistics: PlatformMatchReportStatisticsLine;
};

export type PublicTopPerformance = {
  player: { shirtNumber: string; displayName: string };
  teamName: string;
  opponentName: string;
  finalScore: { team: number; opponent: number };
  scheduledDate: string | null;
  statistics: PlatformMatchReportStatisticsLine;
};

export type PublicStatisticsMatchday = {
  id: string;
  label: string;
  roundNumber: number;
  finalizedEligibleGames: number;
  totalRealGames: number;
  incomplete: boolean;
  topPerformance: PublicTopPerformance | null;
};

export type PublicCompetitionStatistics = {
  gamesIncluded: number;
  leaders: {
    points: PublicCompetitionStatisticsPlayer | null;
    threePointers: PublicCompetitionStatisticsPlayer | null;
    rebounds: PublicCompetitionStatisticsPlayer | null;
    assists: PublicCompetitionStatisticsPlayer | null;
    efficiency: PublicCompetitionStatisticsPlayer | null;
  };
  rankings: Record<PublicLeaderCategory, PublicCompetitionStatisticsPlayer[]>;
  matchdays: PublicStatisticsMatchday[];
};

export type PublicCompetitionStatisticsSourceGame = PublicTeamStatisticsSourceGame & {
  roundNumber: number | null;
};

export type PublicCompetitionStatisticsRound = {
  roundNumber: number;
  label: string;
  totalRealGames: number;
};

type InternalPlayer = PublicCompetitionStatisticsPlayer & { canonicalPlayerId: string; teamId: string };

export function publicLeaderValue(player: PublicCompetitionStatisticsPlayer, category: PublicLeaderCategory): number {
  const statistics = player.statistics;
  if (category === "threePointers") return statistics.threePointMade;
  if (category === "twoPointers") return statistics.twoPointMade;
  if (category === "freeThrows") return statistics.freeThrowMade;
  if (category === "offensiveRebounds") return statistics.offensiveRebounds;
  if (category === "defensiveRebounds") return statistics.defensiveRebounds;
  return statistics[category];
}

function publicPlayer(player: InternalPlayer): PublicCompetitionStatisticsPlayer {
  return { displayName: player.displayName, teamName: player.teamName, gamesPlayed: player.gamesPlayed, statistics: { ...player.statistics } };
}

function rank(players: InternalPlayer[], category: PublicLeaderCategory) {
  return [...players].sort((left, right) => publicLeaderValue(right, category) - publicLeaderValue(left, category)
    || left.gamesPlayed - right.gamesPlayed
    || right.statistics.efficiency - left.statistics.efficiency
    || left.displayName.localeCompare(right.displayName, "el")
    || left.teamName.localeCompare(right.teamName, "el")
    || left.canonicalPlayerId.localeCompare(right.canonicalPlayerId));
}

function topPerformance(games: PublicCompetitionStatisticsSourceGame[]): PublicTopPerformance | null {
  const candidates = games.flatMap((game) => ([
    ...game.homePlayers.map((player) => ({ player, teamName: game.homeTeamName, opponentName: game.awayTeamName, teamScore: game.homeScore, opponentScore: game.awayScore, date: game.scheduledDate })),
    ...game.awayPlayers.map((player) => ({ player, teamName: game.awayTeamName, opponentName: game.homeTeamName, teamScore: game.awayScore, opponentScore: game.homeScore, date: game.scheduledDate })),
  ]));
  candidates.sort((left, right) => right.player.statistics.efficiency - left.player.statistics.efficiency
    || right.player.statistics.points - left.player.statistics.points
    || right.player.statistics.rebounds - left.player.statistics.rebounds
    || right.player.statistics.assists - left.player.statistics.assists
    || left.player.displayName.localeCompare(right.player.displayName, "el")
    || left.player.canonicalPlayerId.localeCompare(right.player.canonicalPlayerId));
  const winner = candidates[0];
  return winner ? { player: { shirtNumber: winner.player.shirtNumber, displayName: winner.player.displayName }, teamName: winner.teamName, opponentName: winner.opponentName, finalScore: { team: winner.teamScore, opponent: winner.opponentScore }, scheduledDate: winner.date, statistics: { ...winner.player.statistics } } : null;
}

export function buildPublicCompetitionStatistics(input: { games: PublicCompetitionStatisticsSourceGame[]; rounds: PublicCompetitionStatisticsRound[] }): PublicCompetitionStatistics {
  const players = new Map<string, InternalPlayer>();
  for (const game of input.games) {
    const gamePlayers = new Set<string>();
    for (const [teamId, teamName, sourcePlayers] of [[game.homeTeamId, game.homeTeamName, game.homePlayers], [game.awayTeamId, game.awayTeamName, game.awayPlayers]] as const) {
      for (const source of sourcePlayers) {
        if (gamePlayers.has(source.canonicalPlayerId)) throw new Error("PUBLIC_COMPETITION_PLAYER_DUPLICATE");
        gamePlayers.add(source.canonicalPlayerId);
        const current = players.get(source.canonicalPlayerId);
        if (current && current.teamId !== teamId) throw new Error("PUBLIC_COMPETITION_PLAYER_TEAM_AMBIGUOUS");
        players.set(source.canonicalPlayerId, {
          canonicalPlayerId: source.canonicalPlayerId,
          teamId,
          teamName,
          displayName: source.displayName,
          gamesPlayed: (current?.gamesPlayed ?? 0) + 1,
          statistics: aggregateLine(current?.statistics ?? ZERO_STATISTICS, source.statistics),
        });
      }
    }
  }
  const allPlayers = [...players.values()];
  const rankings = Object.fromEntries(PUBLIC_LEADER_CATEGORIES.map((category) => [category, rank(allPlayers, category).slice(0, 20).map(publicPlayer)])) as Record<PublicLeaderCategory, PublicCompetitionStatisticsPlayer[]>;
  const leader = (category: PublicLeaderCategory) => rankings[category][0] ?? null;
  return {
    gamesIncluded: input.games.length,
    leaders: { points: leader("points"), threePointers: leader("threePointers"), rebounds: leader("rebounds"), assists: leader("assists"), efficiency: leader("efficiency") },
    rankings,
    matchdays: [...input.rounds].sort((left, right) => left.roundNumber - right.roundNumber).map((round) => {
      const eligible = input.games.filter((game) => game.roundNumber === round.roundNumber);
      const complete = round.totalRealGames > 0 && eligible.length === round.totalRealGames;
      return { id: `round-${round.roundNumber}`, label: round.label, roundNumber: round.roundNumber, finalizedEligibleGames: eligible.length, totalRealGames: round.totalRealGames, incomplete: !complete && round.totalRealGames > 0, topPerformance: complete ? topPerformance(eligible) : null };
    }),
  };
}
