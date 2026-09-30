import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { buildPublicCompetitionStatistics, type PublicCompetitionStatistics, type PublicTopPerformance } from "@/lib/public-competition-statistics";
import { buildPhaseTournamentGroups, resolvePhaseTournamentGraph } from "@/lib/phase-root-source";
import { readPublicMatchdayMvpSelectionsWithDb } from "@/services/matchday-mvp.service";
import { CANONICAL_PUBLIC_SEASON_START, PUBLIC_KOMOBASKET_ORGANIZATION_ID, type PublicTournament } from "@/services/public-competition.service";
import { readAuthoritativeCompetitionStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type CatalogueRow = { season_id: string; season_name: string; season_slug: string; starts_on: string; competition_id: string; competition_name: string; competition_slug: string };
type StatisticsPhaseRow = { id: string; slug: string; name: string; previous_phase_id: string | null; tournament_name: string | null; phase_order: number | null; lifecycle_status: string | null };
type RoundGameRow = { game_id: string; phase_id: string; round_number: number; round_label: string | null };

export type PublicCompetitionStatisticsPageData = {
  seasons: Array<{ slug: string; name: string }>;
  competitions: Array<{ slug: string; name: string }>;
  tournaments: PublicTournament[];
  selectedSeason: { slug: string; name: string } | null;
  selectedCompetition: { slug: string; name: string } | null;
  selectedTournament: PublicTournament | null;
  statistics: (Omit<PublicCompetitionStatistics, "matchdays"> & {
    matchdays: Array<PublicCompetitionStatistics["matchdays"][number] & { mvp: PublicTopPerformance | null }>;
  }) | null;
};

export async function readPublicCompetitionStatisticsForOrganizationWithDb(
  database: D1DatabaseBinding,
  organizationId: string,
  input: { seasonSlug?: string | null; competitionSlug?: string | null; tournamentSlug?: string | null } = {},
): Promise<PublicCompetitionStatisticsPageData> {
  const catalogue = await database.prepare(`SELECT season.id AS season_id, season.name AS season_name, season.slug AS season_slug, season.starts_on,
      competition.id AS competition_id, competition.name AS competition_name, competition.slug AS competition_slug
    FROM league_competitions competition
    JOIN league_seasons season ON season.id=competition.season_id
    LEFT JOIN league_competition_publication publication ON publication.competition_id=competition.id
    WHERE competition.organization_id=? AND season.starts_on>=?
      AND season.status IN ('active','completed')
      AND COALESCE(publication.lifecycle_status, CASE competition.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END) IN ('online','complete')
    ORDER BY season.starts_on DESC, season.name DESC, competition.name COLLATE NOCASE, competition.id`)
    .bind(organizationId, CANONICAL_PUBLIC_SEASON_START).all<CatalogueRow>();
  const rows = catalogue.results ?? [];
  const seasons = Array.from(new Map(rows.map((row) => [row.season_id, { slug: row.season_slug, name: row.season_name }])).values());
  const selectedSeasonRow = rows.find((row) => row.season_slug === input.seasonSlug) ?? rows[0] ?? null;
  const selectedSeason = selectedSeasonRow ? { slug: selectedSeasonRow.season_slug, name: selectedSeasonRow.season_name } : null;
  const seasonRows = selectedSeasonRow ? rows.filter((row) => row.season_id === selectedSeasonRow.season_id) : [];
  const competitions = seasonRows.map((row) => ({ slug: row.competition_slug, name: row.competition_name }));
  const selectedCompetitionRow = seasonRows.find((row) => row.competition_slug === input.competitionSlug) ?? seasonRows[0] ?? null;
  const selectedCompetition = selectedCompetitionRow ? { slug: selectedCompetitionRow.competition_slug, name: selectedCompetitionRow.competition_name } : null;
  if (!selectedCompetitionRow) return { seasons, competitions, tournaments: [], selectedSeason, selectedCompetition, selectedTournament: null, statistics: null };

  const [eligibleGames, phaseResult, roundResult] = await Promise.all([
    readAuthoritativeCompetitionStatisticalGamesWithDb(database, selectedCompetitionRow.competition_id, organizationId),
    database.prepare(`SELECT id, slug, name, previous_phase_id, tournament_name,
        COALESCE(phase_order, order_index) AS phase_order, lifecycle_status
      FROM league_phases WHERE competition_id=?
      ORDER BY COALESCE(phase_order, order_index), id`).bind(selectedCompetitionRow.competition_id).all<StatisticsPhaseRow>(),
    database.prepare(`SELECT game.id AS game_id, game.phase_id, game.round_number, game.round_label
      FROM league_games game JOIN league_phases phase ON phase.id=game.phase_id
      WHERE game.competition_id=? AND phase.format='standings' AND game.round_number IS NOT NULL
        AND game.status IN ('scheduled','completed')
      ORDER BY game.round_number, game.game_order, game.id`).bind(selectedCompetitionRow.competition_id).all<RoundGameRow>(),
  ]);
  const phaseRows = phaseResult.results ?? [];
  const tournamentInputs = phaseRows.map((phase) => ({ ...phase, competition_id: selectedCompetitionRow.competition_id }));
  const graph = resolvePhaseTournamentGraph(tournamentInputs);
  const phaseById = new Map(phaseRows.map((phase) => [phase.id, phase]));
  const tournaments = buildPhaseTournamentGroups(tournamentInputs).flatMap<PublicTournament>((group) => {
    const root = phaseById.get(group.rootPhaseId);
    return root ? [{ rootPhaseId: group.rootPhaseId, slug: root.slug, name: graph.effectiveTournamentNameByRootPhaseId.get(group.rootPhaseId) ?? group.tournamentName, phaseIds: group.phases.map((phase) => phase.id), finalized: group.finalized }] : [];
  });
  const selectedTournament = tournaments.find((tournament) => tournament.slug === input.tournamentSlug) ?? tournaments[0] ?? null;
  const selectedPhaseIds = new Set(selectedTournament?.phaseIds ?? []);
  const roundRows = roundResult.results ?? [];
  const roundByGame = new Map(roundRows.map((row) => [row.game_id, { phaseId: row.phase_id, roundNumber: Number(row.round_number) }]));
  const roundGroups = new Map<string, { phaseId: string; phaseOrder: number; roundNumber: number; label: string; totalRealGames: number }>();
  for (const row of roundRows) {
    if (!selectedPhaseIds.has(row.phase_id)) continue;
    const roundNumber = Number(row.round_number);
    const key = `${row.phase_id}:${roundNumber}`;
    const current = roundGroups.get(key);
    roundGroups.set(key, { phaseId: row.phase_id, phaseOrder: Number(phaseById.get(row.phase_id)?.phase_order ?? 0), roundNumber, label: row.round_label?.trim() || `${roundNumber}η Αγωνιστική`, totalRealGames: (current?.totalRealGames ?? 0) + 1 });
  }
  const sourceGames = eligibleGames.flatMap((game) => {
    const metadata = roundByGame.get(game.gameId);
    return metadata && selectedPhaseIds.has(metadata.phaseId) ? [{ ...game, phaseId: metadata.phaseId, roundNumber: metadata.roundNumber }] : [];
  });
  const statistics = buildPublicCompetitionStatistics({ games: sourceGames, rounds: [...roundGroups.values()] });
  const mvpByMatchday = new Map<string, PublicTopPerformance>();
  for (const phaseId of selectedTournament?.phaseIds ?? []) {
    const phaseGames = sourceGames.filter((game) => game.phaseId === phaseId);
    const mvpByRound = await readPublicMatchdayMvpSelectionsWithDb(database, organizationId, selectedCompetitionRow.competition_id, phaseGames);
    for (const [roundNumber, mvp] of mvpByRound) mvpByMatchday.set(`${phaseId}-round-${roundNumber}`, mvp);
  }
  return {
    seasons,
    competitions,
    tournaments,
    selectedSeason,
    selectedCompetition,
    selectedTournament,
    statistics: { ...statistics, matchdays: statistics.matchdays.map((matchday) => ({ ...matchday, mvp: mvpByMatchday.get(matchday.id) ?? null })) },
  };
}

export async function readPublicCompetitionStatisticsWithDb(
  database: D1DatabaseBinding,
  input: { seasonSlug?: string | null; competitionSlug?: string | null; tournamentSlug?: string | null } = {},
): Promise<PublicCompetitionStatisticsPageData> {
  return readPublicCompetitionStatisticsForOrganizationWithDb(database, PUBLIC_KOMOBASKET_ORGANIZATION_ID, input);
}

export async function readPublicCompetitionStatisticsForOrganization(
  organizationId: string,
  input: { seasonSlug?: string | null; competitionSlug?: string | null; tournamentSlug?: string | null } = {},
) {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("PUBLIC_COMPETITION_STATISTICS_UNAVAILABLE");
  return readPublicCompetitionStatisticsForOrganizationWithDb(environment.NEWS_DB, organizationId, input);
}

export async function readPublicCompetitionStatistics(input: { seasonSlug?: string | null; competitionSlug?: string | null; tournamentSlug?: string | null } = {}) {
  return readPublicCompetitionStatisticsForOrganization(PUBLIC_KOMOBASKET_ORGANIZATION_ID, input);
}
