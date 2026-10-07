import "server-only";

import { normalizeOptionalJerseyNumber } from "@/lib/jersey-number";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { PlatformMatchReportStatisticsLine } from "@/lib/platform-match-report";
import { ZERO_STATISTICS } from "@/lib/public-team-statistics";
import { readMobileCompetitionWithDb } from "@/services/public-mobile-catalogue.service";
import { aggregateMobileRankingGames } from "@/services/public-mobile-rankings.service";
import { readAuthoritativePhaseStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type Team = { id: string; name: string; logoUrl: string | null };
type GameTeam = Pick<Team, "id" | "name">;
type Shooting = { made: number; attempted: number; percentage: number | null };
type PlayerAverages = Record<"points" | "rebounds" | "assists" | "steals" | "blocks" | "turnovers" | "fouls" | "efficiency", number | null>;
export type MobilePlayerRecentGame = {
  gameId: string; phaseId: string; round: number | null; roundLabel: string | null;
  scheduledDate: string | null; scheduledTime: string | null;
  playerTeam: GameTeam; opponentTeam: GameTeam;
  teamScore: number; opponentScore: number; outcome: "win" | "loss" | "tie";
  points: number; rebounds: number; assists: number; efficiency: number;
};
export type MobilePlayerProfile = {
  id: string; name: string; photoUrl: string | null; competitionId: string; seasonId: string;
  currentTeam: Team | null; jerseyNumber: string | null; phaseIds: string[]; gamesPlayed: number;
  totals: PlatformMatchReportStatisticsLine; perGame: PlayerAverages;
  shooting: { twoPoint: Shooting; threePoint: Shooting; freeThrow: Shooting };
  recentGames: MobilePlayerRecentGame[];
};
export type MobilePlayerResponse = { data: MobilePlayerProfile };
export type MobilePlayerInput = { competitionId: string; playerId: string; phaseIds: string[] };

export class MobilePlayerError extends Error {
  constructor(readonly code: "COMPETITION_NOT_FOUND" | "PLAYER_NOT_FOUND" | "INVALID_PHASES" | "DATABASE_UNAVAILABLE") {
    super(code);
  }
}

type IdentityRow = {
  display_name: string | null; photo_url: string | null; has_membership: number;
  team_id: string | null; team_name: string | null; team_logo_url: string | null;
  shirt_number: string | null; fallback_logo_url: string | null;
};
type PhaseRow = { id: string };
type Game = Awaited<ReturnType<typeof readAuthoritativePhaseStatisticalGamesWithDb>>[number];

function shooting(made: number, attempted: number): Shooting {
  return { made, attempted, percentage: attempted === 0 ? null : made / attempted * 100 };
}

function compareGameOrder(left: Game, right: Game): number {
  for (let index = 0; index < left.sortKey.length; index++) {
    const a = left.sortKey[index];
    const b = right.sortKey[index];
    const difference = typeof a === "number" && typeof b === "number" ? a - b : a === b ? 0 : a < b ? -1 : 1;
    if (difference) return difference;
  }
  return 0;
}

function recentGames(games: Game[], playerId: string): MobilePlayerRecentGame[] {
  const seen = new Set<string>();
  const result: MobilePlayerRecentGame[] = [];
  for (const game of [...games].sort((a, b) => compareGameOrder(b, a))) {
    if (seen.has(game.gameId) || !game.participatingPlayerIds.includes(playerId)) continue;
    seen.add(game.gameId);
    const home = game.homePlayers.find((player) => player.canonicalPlayerId === playerId);
    const away = game.awayPlayers.find((player) => player.canonicalPlayerId === playerId);
    const player = home ?? away;
    if (!player || (home && away)) throw new MobilePlayerError("DATABASE_UNAVAILABLE");
    const isHome = Boolean(home);
    const teamScore = isHome ? game.homeScore : game.awayScore;
    const opponentScore = isHome ? game.awayScore : game.homeScore;
    result.push({
      gameId: game.gameId, phaseId: game.phaseId, round: game.round, roundLabel: game.roundLabel,
      scheduledDate: game.scheduledDate, scheduledTime: game.scheduledTime,
      playerTeam: { id: isHome ? game.homeTeamId : game.awayTeamId,
        name: isHome ? game.homeTeamName : game.awayTeamName },
      opponentTeam: { id: isHome ? game.awayTeamId : game.homeTeamId,
        name: isHome ? game.awayTeamName : game.homeTeamName },
      teamScore, opponentScore, outcome: teamScore > opponentScore ? "win" : teamScore < opponentScore ? "loss" : "tie",
      points: player.statistics.points, rebounds: player.statistics.rebounds,
      assists: player.statistics.assists, efficiency: player.statistics.efficiency,
    });
    if (result.length === 5) break;
  }
  return result;
}

export async function readMobilePlayerWithDb(db: D1DatabaseBinding, input: MobilePlayerInput): Promise<MobilePlayerResponse> {
  const competition = await readMobileCompetitionWithDb(db, input.competitionId);
  if (!competition) throw new MobilePlayerError("COMPETITION_NOT_FOUND");
  const phaseIds = [...new Set(input.phaseIds)].sort();
  if (!phaseIds.length || phaseIds.length > 12 || phaseIds.some((id) => !id || id.length > 200)) {
    throw new MobilePlayerError("INVALID_PHASES");
  }
  const phases = await db.prepare(`SELECT id FROM league_phases
    WHERE competition_id=? AND lifecycle_status IN ('active','finalized')
      AND id IN (SELECT value FROM json_each(?))`).bind(competition.id, JSON.stringify(phaseIds)).all<PhaseRow>();
  if ((phases.results ?? []).length !== phaseIds.length) throw new MobilePlayerError("INVALID_PHASES");

  const games = await readAuthoritativePhaseStatisticalGamesWithDb(db, competition.id, competition.organizationId, phaseIds);
  const aggregate = aggregateMobileRankingGames(games).get(input.playerId);
  const latestGame = [...games].sort((a, b) => (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "")
    || (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? "") || a.gameId.localeCompare(b.gameId))
    .filter((game) => game.homePlayers.some((player) => player.canonicalPlayerId === input.playerId)
      || game.awayPlayers.some((player) => player.canonicalPlayerId === input.playerId)).at(-1);
  const latestLine = latestGame?.homePlayers.find((player) => player.canonicalPlayerId === input.playerId)
    ?? latestGame?.awayPlayers.find((player) => player.canonicalPlayerId === input.playerId);
  const identity = await db.prepare(`SELECT p.display_name, NULLIF(TRIM(p.photo_url),'') AS photo_url,
      EXISTS (SELECT 1 FROM league_roster_memberships membership
        JOIN league_teams roster_team ON roster_team.id=membership.team_id AND roster_team.organization_id=?
        JOIN league_season_teams st ON st.team_id=roster_team.id AND st.season_id=?
        JOIN league_competition_teams ct ON ct.season_team_id=st.id AND ct.competition_id=?
        WHERE membership.player_id=p.id AND membership.season_id=? AND membership.competition_id=?
          AND membership.status IN ('active','transferred','departed')) AS has_membership,
      team.id AS team_id, team.name AS team_name, NULLIF(TRIM(team.logo_url),'') AS team_logo_url,
      current.shirt_number, NULLIF(TRIM(fallback.logo_url),'') AS fallback_logo_url
    FROM (SELECT ? AS requested_id) requested
    LEFT JOIN league_players p ON p.id=requested.requested_id AND p.organization_id=?
    LEFT JOIN league_roster_memberships current ON current.id=(
      SELECT membership.id FROM league_roster_memberships membership
      JOIN league_teams roster_team ON roster_team.id=membership.team_id AND roster_team.organization_id=?
      JOIN league_season_teams st ON st.team_id=roster_team.id AND st.season_id=?
      JOIN league_competition_teams ct ON ct.season_team_id=st.id AND ct.competition_id=? AND ct.status='active'
      WHERE membership.player_id=p.id AND membership.season_id=? AND membership.competition_id=?
        AND membership.status='active'
      ORDER BY membership.joined_on DESC, membership.updated_at DESC, membership.id DESC LIMIT 1)
    LEFT JOIN league_teams team ON team.id=current.team_id AND team.organization_id=?
    LEFT JOIN league_teams fallback ON fallback.id=? AND fallback.organization_id=?`)
    .bind(competition.organizationId, competition.seasonId, competition.id, competition.seasonId, competition.id,
      input.playerId, competition.organizationId, competition.organizationId, competition.seasonId, competition.id,
      competition.seasonId, competition.id, competition.organizationId,
      aggregate?.latestTeamId ?? null, competition.organizationId).first<IdentityRow>();
  if (!identity?.has_membership && !aggregate) throw new MobilePlayerError("PLAYER_NOT_FOUND");

  const statistics = aggregate?.statistics ?? { ...ZERO_STATISTICS };
  const gamesPlayed = aggregate?.gamesPlayed ?? 0;
  const average = (value: number) => gamesPlayed === 0 ? null : value / gamesPlayed;
  const currentTeam = identity?.team_id ? { id: identity.team_id, name: identity.team_name!, logoUrl: identity.team_logo_url }
    : aggregate ? { id: aggregate.latestTeamId, name: aggregate.latestTeamName,
      logoUrl: identity?.fallback_logo_url ?? null } : null;
  return { data: {
    id: input.playerId, name: identity?.display_name ?? aggregate?.playerName ?? "",
    photoUrl: identity?.photo_url ?? null, competitionId: competition.id, seasonId: competition.seasonId,
    currentTeam, jerseyNumber: identity?.team_id
      ? normalizeOptionalJerseyNumber(identity.shirt_number)
      : latestLine?.shirtNumber || null,
    phaseIds, gamesPlayed, totals: statistics,
    perGame: {
      points: average(statistics.points), rebounds: average(statistics.rebounds), assists: average(statistics.assists),
      steals: average(statistics.steals), blocks: average(statistics.blocks),
      turnovers: average(statistics.turnovers), fouls: average(statistics.fouls),
      efficiency: average(statistics.efficiency),
    },
    shooting: {
      twoPoint: shooting(statistics.twoPointMade, statistics.twoPointAttempts),
      threePoint: shooting(statistics.threePointMade, statistics.threePointAttempts),
      freeThrow: shooting(statistics.freeThrowMade, statistics.freeThrowAttempts),
    },
    recentGames: recentGames(games, input.playerId),
  } };
}

export async function readMobilePlayer(input: MobilePlayerInput): Promise<MobilePlayerResponse> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new MobilePlayerError("DATABASE_UNAVAILABLE");
  return readMobilePlayerWithDb(environment.NEWS_DB, input);
}
