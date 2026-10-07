import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { PlatformMatchReportStatisticsLine } from "@/lib/platform-match-report";
import { aggregateLine, ZERO_STATISTICS } from "@/lib/public-team-statistics";
import { readMobileCompetitionWithDb } from "@/services/public-mobile-catalogue.service";
import { readAuthoritativePhaseStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export const RANKING_CATEGORIES = ["points", "rebounds", "assists", "efficiency", "2pt", "3pt", "ft"] as const;
export type RankingCategory = typeof RANKING_CATEGORIES[number];
export type RankingIdentity = {
  rank: number;
  playerId: string;
  playerName: string;
  playerPhotoUrl: string | null;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  gamesPlayed: number;
};
export type CountingRankingRow = RankingIdentity & { total: number; perGameAverage: number };
export type ShootingRankingRow = RankingIdentity & { made: number; attempted: number; percentage: number | null };
export type RankingRow = CountingRankingRow | ShootingRankingRow;
export type RankingResponse = {
  data: RankingRow[];
  meta: { competitionId: string; phaseIds: string[]; category: RankingCategory; nextCursor: string | null; hasMore: boolean };
};
export type RankingInput = { competitionId: string; phaseIds: string[]; category: RankingCategory; cursor?: string; limit: number };

export class MobileRankingError extends Error {
  constructor(readonly code: "COMPETITION_NOT_FOUND" | "INVALID_PHASES" | "INVALID_CURSOR" | "STALE_CURSOR" | "DATABASE_UNAVAILABLE") {
    super(code);
  }
}

type Aggregate = {
  playerId: string;
  playerName: string;
  latestTeamId: string;
  latestTeamName: string;
  gamesPlayed: number;
  statistics: PlatformMatchReportStatisticsLine;
};
type IdentityRow = { id: string; display_name: string | null; photo_url: string | null; team_id: string | null;
  team_name: string | null; team_logo_url: string | null; fallback_logo_url: string | null };
type PhaseRow = { id: string };
type ParticipatingGame = Awaited<ReturnType<typeof readAuthoritativePhaseStatisticalGamesWithDb>>[number];

export function aggregateMobileRankingGames(games: ParticipatingGame[]): Map<string, Aggregate> {
  const players = new Map<string, Aggregate>();
  const seenGames = new Set<string>();
  const sortedGames = [...games].sort((a, b) => (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "")
    || (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? "") || a.gameId.localeCompare(b.gameId));
  for (const game of sortedGames) {
    if (seenGames.has(game.gameId)) continue;
    seenGames.add(game.gameId);
    const participating = new Set(game.participatingPlayerIds);
    const seenPlayers = new Set<string>();
    for (const [teamId, teamName, roster] of [
      [game.homeTeamId, game.homeTeamName, game.homePlayers],
      [game.awayTeamId, game.awayTeamName, game.awayPlayers],
    ] as const) {
      for (const player of roster) {
        if (seenPlayers.has(player.canonicalPlayerId)) throw new MobileRankingError("DATABASE_UNAVAILABLE");
        seenPlayers.add(player.canonicalPlayerId);
        const previous = players.get(player.canonicalPlayerId);
        players.set(player.canonicalPlayerId, {
          playerId: player.canonicalPlayerId,
          playerName: player.displayName,
          latestTeamId: teamId,
          latestTeamName: teamName,
          gamesPlayed: (previous?.gamesPlayed ?? 0) + (participating.has(player.canonicalPlayerId) ? 1 : 0),
          statistics: aggregateLine(previous?.statistics ?? ZERO_STATISTICS, player.statistics),
        });
      }
    }
  }
  return new Map([...players].filter(([, player]) => player.gamesPlayed > 0));
}

function metric(player: Aggregate, category: RankingCategory): number {
  const stats = player.statistics;
  switch (category) {
    case "2pt": return stats.twoPointMade;
    case "3pt": return stats.threePointMade;
    case "ft": return stats.freeThrowMade;
    default: return stats[category];
  }
}

function shooting(player: Aggregate, category: RankingCategory): { made: number; attempted: number } {
  if (category === "2pt") return { made: player.statistics.twoPointMade, attempted: player.statistics.twoPointAttempts };
  if (category === "3pt") return { made: player.statistics.threePointMade, attempted: player.statistics.threePointAttempts };
  return { made: player.statistics.freeThrowMade, attempted: player.statistics.freeThrowAttempts };
}

function encodeCursor(value: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string): unknown {
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid");
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch { throw new MobileRankingError("INVALID_CURSOR"); }
}

async function revision(rows: RankingRow[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readMobileRankingsWithDb(db: D1DatabaseBinding, input: RankingInput): Promise<RankingResponse> {
  const competition = await readMobileCompetitionWithDb(db, input.competitionId);
  if (!competition) throw new MobileRankingError("COMPETITION_NOT_FOUND");
  const phaseIds = [...new Set(input.phaseIds)].sort();
  if (!phaseIds.length || phaseIds.length > 12 || phaseIds.some((id) => !id || id.length > 200)) throw new MobileRankingError("INVALID_PHASES");
  const phaseResult = await db.prepare(`SELECT id FROM league_phases
    WHERE competition_id=? AND lifecycle_status IN ('active','finalized')
      AND id IN (SELECT value FROM json_each(?))`).bind(competition.id, JSON.stringify(phaseIds)).all<PhaseRow>();
  if ((phaseResult.results ?? []).length !== phaseIds.length) throw new MobileRankingError("INVALID_PHASES");

  const games = await readAuthoritativePhaseStatisticalGamesWithDb(db, competition.id, competition.organizationId, phaseIds);
  const aggregates = aggregateMobileRankingGames(games);
  const identity = new Map<string, IdentityRow>();
  if (aggregates.size) {
    const result = await db.prepare(`SELECT json_extract(selected.value,'$.playerId') AS id,
        p.display_name, NULLIF(TRIM(p.photo_url),'') AS photo_url,
        t.id AS team_id, t.name AS team_name, NULLIF(TRIM(t.logo_url),'') AS team_logo_url,
        NULLIF(TRIM(fallback.logo_url),'') AS fallback_logo_url
      FROM json_each(?) selected
      LEFT JOIN league_players p ON p.id=json_extract(selected.value,'$.playerId') AND p.organization_id=?
      LEFT JOIN league_roster_memberships rm ON rm.id=(
        SELECT membership.id FROM league_roster_memberships membership
        JOIN league_teams roster_team ON roster_team.id=membership.team_id AND roster_team.organization_id=?
        JOIN league_season_teams st ON st.team_id=roster_team.id AND st.season_id=?
        JOIN league_competition_teams ct ON ct.season_team_id=st.id AND ct.competition_id=? AND ct.status='active'
        WHERE membership.player_id=p.id AND membership.season_id=? AND membership.competition_id=?
          AND membership.status='active'
        ORDER BY membership.joined_on DESC, membership.updated_at DESC, membership.id DESC LIMIT 1)
      LEFT JOIN league_teams t ON t.id=rm.team_id AND t.organization_id=?
      LEFT JOIN league_teams fallback ON fallback.id=json_extract(selected.value,'$.teamId')
        AND fallback.organization_id=?`)
      .bind(JSON.stringify([...aggregates.values()].map((player) => ({ playerId: player.playerId, teamId: player.latestTeamId }))),
        competition.organizationId, competition.organizationId, competition.seasonId, competition.id, competition.seasonId,
        competition.id, competition.organizationId, competition.organizationId)
      .all<IdentityRow>();
    for (const row of result.results ?? []) identity.set(row.id, row);
  }
  const sorted = [...aggregates.values()].sort((a, b) => metric(b, input.category) - metric(a, input.category)
    || a.gamesPlayed - b.gamesPlayed
    || b.statistics.efficiency - a.statistics.efficiency
    || (identity.get(a.playerId)?.display_name ?? a.playerName).localeCompare(identity.get(b.playerId)?.display_name ?? b.playerName, "el")
    || (identity.get(a.playerId)?.team_name ?? a.latestTeamName).localeCompare(identity.get(b.playerId)?.team_name ?? b.latestTeamName, "el")
    || a.playerId.localeCompare(b.playerId));
  const rows: RankingRow[] = sorted.map((player, index) => {
    const canonical = identity.get(player.playerId);
    const common: RankingIdentity = {
      rank: index + 1, playerId: player.playerId, playerName: canonical?.display_name ?? player.playerName,
      playerPhotoUrl: canonical?.photo_url ?? null,
      teamId: canonical?.team_id ?? player.latestTeamId,
      teamName: canonical?.team_name ?? player.latestTeamName,
      teamLogoUrl: canonical?.team_id ? canonical.team_logo_url : canonical?.fallback_logo_url ?? null,
      gamesPlayed: player.gamesPlayed,
    };
    if (input.category === "2pt" || input.category === "3pt" || input.category === "ft") {
      const { made, attempted } = shooting(player, input.category);
      return { ...common, made, attempted, percentage: attempted === 0 ? null : made / attempted * 100 };
    }
    const total = metric(player, input.category);
    return { ...common, total, perGameAverage: total / player.gamesPlayed };
  });
  const hash = await revision(rows);
  let start = 0;
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) throw new MobileRankingError("INVALID_CURSOR");
    const fields = cursor as Record<string, unknown>;
    if (fields.v !== 1 || fields.competitionId !== competition.id || fields.category !== input.category
      || JSON.stringify(fields.phaseIds) !== JSON.stringify(phaseIds) || typeof fields.lastPlayerId !== "string"
      || typeof fields.hash !== "string") throw new MobileRankingError("INVALID_CURSOR");
    if (fields.hash !== hash) throw new MobileRankingError("STALE_CURSOR");
    const lastIndex = rows.findIndex((row) => row.playerId === fields.lastPlayerId);
    if (lastIndex < 0 || lastIndex === rows.length - 1) throw new MobileRankingError("INVALID_CURSOR");
    start = lastIndex + 1;
  }
  const data = rows.slice(start, start + input.limit);
  const hasMore = start + data.length < rows.length;
  const nextCursor = hasMore ? encodeCursor({ v: 1, competitionId: competition.id, phaseIds,
    category: input.category, hash, lastPlayerId: data[data.length - 1].playerId }) : null;
  return { data, meta: { competitionId: competition.id, phaseIds, category: input.category, nextCursor, hasMore } };
}

export async function readMobileRankings(input: RankingInput): Promise<RankingResponse> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new MobileRankingError("DATABASE_UNAVAILABLE");
  return readMobileRankingsWithDb(environment.NEWS_DB, input);
}
