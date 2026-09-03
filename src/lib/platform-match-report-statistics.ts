import type { MatchState } from "../../komocontrol/shared/match-engine/types/match-state";
import type { Team } from "../../komocontrol/shared/match-engine/types/team";
import type {
  PlatformMatchReportStatisticsLine,
  PlatformMatchReportTeamStatistics,
} from "./platform-match-report";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMatchReportState(value: string): MatchState {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.finished !== "boolean"
    || !isRecord(parsed.home) || !Array.isArray(parsed.home.players)
    || !isRecord(parsed.away) || !Array.isArray(parsed.away.players)) {
    throw new Error("MATCH_REPORT_STATE_INVALID");
  }
  return parsed as unknown as MatchState;
}

export function matchReportEfficiency(statistics: Omit<PlatformMatchReportStatisticsLine, "efficiency" | "fouls">): number {
  return statistics.points + statistics.rebounds + statistics.assists + statistics.steals + statistics.blocks
    - statistics.turnovers
    - (statistics.freeThrowAttempts - statistics.freeThrowMade)
    - (statistics.twoPointAttempts - statistics.twoPointMade)
    - (statistics.threePointAttempts - statistics.threePointMade);
}

export function matchReportShootingPercentage(made: number, attempts: number): string {
  return attempts === 0 ? "-" : `${Math.round((made / attempts) * 100)}%`;
}

export function projectMatchReportPlayerLine(player: Team["players"][number]): PlatformMatchReportStatisticsLine {
  const base = {
    points: player.statistics.points,
    twoPointMade: player.statistics.twoPointMade,
    twoPointAttempts: player.statistics.twoPointAttempts,
    threePointMade: player.statistics.threePointMade,
    threePointAttempts: player.statistics.threePointAttempts,
    freeThrowMade: player.statistics.freeThrowMade,
    freeThrowAttempts: player.statistics.freeThrowAttempts,
    offensiveRebounds: player.statistics.offensiveRebounds,
    defensiveRebounds: player.statistics.defensiveRebounds,
    rebounds: player.statistics.offensiveRebounds + player.statistics.defensiveRebounds,
    assists: player.statistics.assists,
    steals: player.statistics.steals,
    blocks: player.statistics.blocks,
    turnovers: player.statistics.turnovers,
  };
  return { ...base, fouls: player.foulState.total, efficiency: matchReportEfficiency(base) };
}

export function projectMatchReportTeamLine(team: Team): PlatformMatchReportStatisticsLine {
  const statistics = team.statistics;
  const base = {
    points: team.score,
    twoPointMade: statistics.twoPointMade,
    twoPointAttempts: statistics.twoPointAttempts,
    threePointMade: statistics.threePointMade,
    threePointAttempts: statistics.threePointAttempts,
    freeThrowMade: statistics.freeThrowMade,
    freeThrowAttempts: statistics.freeThrowAttempts,
    offensiveRebounds: statistics.offensiveRebounds,
    defensiveRebounds: statistics.defensiveRebounds,
    rebounds: statistics.offensiveRebounds + statistics.defensiveRebounds,
    assists: statistics.assists,
    steals: statistics.steals,
    blocks: statistics.blocks,
    turnovers: statistics.turnovers,
  };
  const fouls = statistics.personalFouls + statistics.technicalFouls + statistics.disruptiveFouls
    + statistics.flagrantFouls + statistics.disqualifyingFouls;
  return { ...base, fouls, efficiency: matchReportEfficiency(base) };
}

function teamStatistics(initialTeam: Team, finalTeam: Team): PlatformMatchReportTeamStatistics {
  const starters = new Set(initialTeam.players.filter((player) => player.onCourt).map((player) => player.playerId));
  return {
    players: finalTeam.players.map((player) => ({
      shirtNumber: player.shirtNumber,
      displayName: player.displayName,
      starter: starters.has(player.playerId),
      finalStatus: player.foulState.status,
      finalStatusReason: player.foulState.statusReason ?? null,
      statistics: projectMatchReportPlayerLine(player),
    })),
    totals: projectMatchReportTeamLine(finalTeam),
  };
}

export function projectPlatformMatchReportStatistics(initialState: MatchState, finalState: MatchState) {
  if (initialState.id !== finalState.id || !finalState.finished) throw new Error("MATCH_REPORT_STATE_INCONSISTENT");
  return {
    home: teamStatistics(initialState.home, finalState.home),
    away: teamStatistics(initialState.away, finalState.away),
  };
}
