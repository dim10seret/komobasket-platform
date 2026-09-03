import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { buildPublicCompetitionStatistics, type PublicCompetitionStatistics } from "@/lib/public-competition-statistics";
import { CANONICAL_PUBLIC_SEASON_START, PUBLIC_KOMOBASKET_ORGANIZATION_ID } from "@/services/public-competition.service";
import { readAuthoritativeCompetitionStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type CatalogueRow = { season_id: string; season_name: string; season_slug: string; starts_on: string; competition_id: string; competition_name: string; competition_slug: string };
type RoundGameRow = { game_id: string; round_number: number; round_label: string | null };

export type PublicCompetitionStatisticsPageData = {
  seasons: Array<{ slug: string; name: string }>;
  competitions: Array<{ slug: string; name: string }>;
  selectedSeason: { slug: string; name: string } | null;
  selectedCompetition: { slug: string; name: string } | null;
  statistics: PublicCompetitionStatistics | null;
};

export async function readPublicCompetitionStatisticsWithDb(database: D1DatabaseBinding, input: { seasonSlug?: string | null; competitionSlug?: string | null } = {}): Promise<PublicCompetitionStatisticsPageData> {
  const catalogue = await database.prepare(`SELECT season.id AS season_id, season.name AS season_name, season.slug AS season_slug, season.starts_on,
      competition.id AS competition_id, competition.name AS competition_name, competition.slug AS competition_slug
    FROM league_competitions competition
    JOIN league_seasons season ON season.id=competition.season_id
    LEFT JOIN league_competition_publication publication ON publication.competition_id=competition.id
    WHERE competition.organization_id=? AND season.starts_on>=?
      AND season.status IN ('active','completed')
      AND COALESCE(publication.lifecycle_status, CASE competition.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END) IN ('online','complete')
    ORDER BY season.starts_on DESC, season.name DESC, competition.name COLLATE NOCASE, competition.id`)
    .bind(PUBLIC_KOMOBASKET_ORGANIZATION_ID, CANONICAL_PUBLIC_SEASON_START).all<CatalogueRow>();
  const rows = catalogue.results ?? [];
  const seasons = Array.from(new Map(rows.map((row) => [row.season_id, { slug: row.season_slug, name: row.season_name }])).values());
  const selectedSeasonRow = rows.find((row) => row.season_slug === input.seasonSlug) ?? rows[0] ?? null;
  const selectedSeason = selectedSeasonRow ? { slug: selectedSeasonRow.season_slug, name: selectedSeasonRow.season_name } : null;
  const seasonRows = selectedSeasonRow ? rows.filter((row) => row.season_id === selectedSeasonRow.season_id) : [];
  const competitions = seasonRows.map((row) => ({ slug: row.competition_slug, name: row.competition_name }));
  const selectedCompetitionRow = seasonRows.find((row) => row.competition_slug === input.competitionSlug) ?? seasonRows[0] ?? null;
  const selectedCompetition = selectedCompetitionRow ? { slug: selectedCompetitionRow.competition_slug, name: selectedCompetitionRow.competition_name } : null;
  if (!selectedCompetitionRow) return { seasons, competitions, selectedSeason, selectedCompetition, statistics: null };

  const [eligibleGames, roundResult] = await Promise.all([
    readAuthoritativeCompetitionStatisticalGamesWithDb(database, selectedCompetitionRow.competition_id, PUBLIC_KOMOBASKET_ORGANIZATION_ID),
    database.prepare(`SELECT game.id AS game_id, game.round_number, game.round_label
      FROM league_games game JOIN league_phases phase ON phase.id=game.phase_id
      WHERE game.competition_id=? AND phase.format='standings' AND game.round_number IS NOT NULL
        AND game.status IN ('scheduled','completed')
      ORDER BY game.round_number, game.game_order, game.id`).bind(selectedCompetitionRow.competition_id).all<RoundGameRow>(),
  ]);
  const roundRows = roundResult.results ?? [];
  const roundByGame = new Map(roundRows.map((row) => [row.game_id, Number(row.round_number)]));
  const roundGroups = new Map<number, { roundNumber: number; label: string; totalRealGames: number }>();
  for (const row of roundRows) {
    const roundNumber = Number(row.round_number);
    const current = roundGroups.get(roundNumber);
    roundGroups.set(roundNumber, { roundNumber, label: row.round_label?.trim() || `${roundNumber}η Αγωνιστική`, totalRealGames: (current?.totalRealGames ?? 0) + 1 });
  }
  return {
    seasons,
    competitions,
    selectedSeason,
    selectedCompetition,
    statistics: buildPublicCompetitionStatistics({ games: eligibleGames.map((game) => ({ ...game, roundNumber: roundByGame.get(game.gameId) ?? null })), rounds: [...roundGroups.values()] }),
  };
}

export async function readPublicCompetitionStatistics(input: { seasonSlug?: string | null; competitionSlug?: string | null } = {}) {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("PUBLIC_COMPETITION_STATISTICS_UNAVAILABLE");
  return readPublicCompetitionStatisticsWithDb(environment.NEWS_DB, input);
}
