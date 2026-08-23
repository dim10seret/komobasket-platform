import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { resolveSeriesCarryOver, type SeriesCarryOverGameLike, type SeriesCarryOverPhaseLike } from "@/lib/series-carry-over";
import { calculateSeriesProgression, type SeriesProgressionMaterializedGame, type SeriesProgressionTransferredGame } from "@/lib/series-progression";
import { calculateStandings, type StandingsTieBreakerKey } from "@/lib/standings-calculator";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export const PUBLIC_KOMOBASKET_ORGANIZATION_ID = "organization_komobasket";
const CANONICAL_PUBLIC_SEASON_START = "2026-01-01";

export type PublicStandingsPresentation = {
  directQualification: number[];
  playOut: number[];
  eliminated: number[];
};

export type PublicDirectAdvancement = {
  matchupId: string;
  label: string;
  participantSlotType: string;
};

export type PublicGameTeam = {
  id: string;
  name: string;
  logoUrl: string | null;
};

export type PublicGame = {
  id: string;
  roundNumber: number;
  gameOrder: number | null;
  roundLabel: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  venue: string | null;
  homeScore: number | null;
  awayScore: number | null;
  videoUrl: string | null;
  homeTeam: PublicGameTeam;
  awayTeam: PublicGameTeam;
};

export type PublicStandingRow = { rank: number; team: PublicGameTeam; gamesPlayed: number; wins: number; losses: number; standingsPoints: number; pointsFor: number; pointsAgainst: number; pointDifference: number };
export type PublicSeriesRound = { roundNumber: number; kind: "transferred" | "game" | "not_needed"; sourcePhaseName: string | null; game: PublicGame | null };
export type PublicSeriesMatchupHistory = { matchupId: string; label: string; maximumSeriesRounds: number; rounds: PublicSeriesRound[] };
export type PublicBracketParticipant = { slot: "A" | "B"; team: PublicGameTeam | null; originLabel: string | null };
export type PublicBracketMatchup = { matchupId: string; kind: "series" | "direct_qualifier" | "standings_origin"; participants: PublicBracketParticipant[]; winnerTeamId: string | null; seriesScore: { winsA: number; winsB: number; winsRequired: number } | null; directAdvancement: boolean };
export type PublicBracketStage = { phaseId: string; phaseSlug: string; label: string; order: number; kind: "standings_origin" | "series"; matchups: PublicBracketMatchup[] };
export type PublicBracketEdge = { id: string; from: { phaseId: string; matchupId: string; outcome: "winner" | "loser" | "standing_position" }; to: { phaseId: string; matchupId: string; slot: "A" | "B" } };
export type CompetitionBracketProjection = { meaningful: boolean; stages: PublicBracketStage[]; edges: PublicBracketEdge[] };

export type PublicPhase = {
  id: string;
  slug: string;
  name: string;
  format: "standings" | "series" | "custom";
  phaseType: string;
  participantCount: number | null;
  roundCount: number | null;
  winsRequired: number | null;
  directAdvancements: PublicDirectAdvancement[];
  standingsPresentation: PublicStandingsPresentation;
};

export type PublicCompetition = {
  id: string;
  slug: string;
  name: string;
  type: string;
  lifecycleStatus: "online" | "complete";
};

export type PublicSeason = {
  id: string;
  slug: string;
  name: string;
};

export type PublicCompetitionContext = {
  seasons: PublicSeason[];
  competitions: PublicCompetition[];
  phases: PublicPhase[];
  games: PublicGame[];
  standings: PublicStandingRow[];
  seriesHistory: PublicSeriesMatchupHistory[];
  bracket: CompetitionBracketProjection | null;
  selectedSeason: PublicSeason | null;
  selectedCompetition: PublicCompetition | null;
  selectedPhase: PublicPhase | null;
};

type PublicCompetitionRow = {
  season_id: string;
  season_name: string;
  season_slug: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  competition_type: string;
  lifecycle_status: "online" | "complete";
};

type PublicPhaseRow = {
  id: string;
  slug: string;
  name: string;
  format: string;
  phase_type: string;
  phase_kind: string | null;
  lifecycle_status: string | null;
  phase_order: number | null;
  previous_phase_id: string | null;
  participant_count: number | null;
  round_count: number | null;
  wins_required: number | null;
  carry_over_enabled: number | null;
  carry_over_source_phase_id: string | null;
  settings_json: string | null;
  rule_settings_json: string | null;
  standings_presentation_json: string;
};

type PublicGameRow = {
  id: string;
  competition_id: string;
  phase_id: string;
  schedule_id: string | null;
  cycle_number: number | null;
  round_number: number | null;
  series_round_number: number | null;
  game_order: number | null;
  round_label: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  result_source: string | null;
  series_matchup_id: string | null;
  video_url: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_logo_url: string | null;
};

type PublicTeamRow = { id: string; name: string; logo_url: string | null };

async function getDb(): Promise<D1DatabaseBinding> {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_DB) throw new Error("Η canonical δημόσια βάση διοργανώσεων δεν είναι διαθέσιμη.");
  return env.NEWS_DB;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  try {
    return parseRecord(JSON.parse(value ?? "{}"));
  } catch {
    return {};
  }
}

function parseStandingsPresentation(value: string): PublicStandingsPresentation {
  const presentation: PublicStandingsPresentation = {
    directQualification: [],
    playOut: [],
    eliminated: [],
  };
  try {
    const entries = JSON.parse(value);
    if (!Array.isArray(entries)) return presentation;
    for (const entry of entries) {
      const category = String(entry?.category ?? "");
      const position = Number(entry?.position);
      if (!Number.isInteger(position) || position < 1) continue;
      if (category === "direct_qualification") presentation.directQualification.push(position);
      if (category === "play_out") presentation.playOut.push(position);
      if (category === "eliminated") presentation.eliminated.push(position);
    }
  } catch {
    return presentation;
  }
  for (const positions of Object.values(presentation)) positions.sort((left, right) => left - right);
  return presentation;
}

function parseDirectAdvancements(settingsJson: string | null): PublicDirectAdvancement[] {
  const settings = parseJsonRecord(settingsJson);
  const bracket = parseRecord(settings.bracketConfiguration);
  const matchups = Array.isArray(bracket.matchups) ? bracket.matchups : [];
  return matchups.flatMap((rawMatchup) => {
    const matchup = parseRecord(rawMatchup);
    const slotA = parseRecord(matchup.slotA);
    const slotB = parseRecord(matchup.slotB);
    const byeA = String(slotA.type ?? "") === "bye";
    const byeB = String(slotB.type ?? "") === "bye";
    if (byeA === byeB) return [];
    const participantSlot = byeA ? slotB : slotA;
    const matchupId = String(matchup.id ?? "").trim();
    if (!matchupId) return [];
    return [{
      matchupId,
      label: "Άμεση πρόκριση χωρίς αγώνα.",
      participantSlotType: String(participantSlot.type ?? "").trim(),
    }];
  });
}

function normalizePhase(row: PublicPhaseRow): PublicPhase {
  const format = String(row.format ?? "custom");
  const normalizedFormat = format === "standings" || format === "series" ? format : "custom";
  const settings = parseJsonRecord(row.rule_settings_json);
  const participantConfiguration = parseRecord(settings.participantConfiguration);
  const bracket = parseRecord(settings.bracketConfiguration);
  const configuredParticipantCount = Number(bracket.participantCount);
  const participantCount = normalizedFormat === "series"
    ? (Number.isInteger(configuredParticipantCount) && configuredParticipantCount > 0 ? configuredParticipantCount : null)
    : normalizedFormat === "standings" && String(participantConfiguration.participantSourceType ?? "") === "competition_participants"
      ? (row.participant_count === null ? null : Number(row.participant_count))
      : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    format: normalizedFormat,
    phaseType: row.phase_type,
    participantCount,
    roundCount: row.round_count === null ? null : Number(row.round_count),
    winsRequired: row.wins_required === null ? null : Number(row.wins_required),
    directAdvancements: parseDirectAdvancements(row.rule_settings_json),
    standingsPresentation: parseStandingsPresentation(row.standings_presentation_json),
  };
}

function normalizePublicGame(row: PublicGameRow, format: PublicPhase["format"], roundOverride?: number): PublicGame | null {
  const roundNumber = format === "series"
    ? roundOverride ?? row.series_round_number ?? row.round_number
    : row.round_number;
  if (typeof roundNumber !== "number" || !Number.isInteger(roundNumber) || roundNumber < 1) return null;
  return {
    id: row.id,
    roundNumber,
    gameOrder: row.game_order === null ? null : Number(row.game_order),
    roundLabel: row.round_label?.trim() || null,
    scheduledDate: row.scheduled_date?.trim() || null,
    scheduledTime: row.scheduled_time?.trim() || null,
    venue: row.venue?.trim() || null,
    homeScore: row.home_score === null ? null : Number(row.home_score),
    awayScore: row.away_score === null ? null : Number(row.away_score),
    videoUrl: row.video_url?.trim() || null,
    homeTeam: {
      id: row.home_team_id,
      name: row.home_team_name,
      logoUrl: row.home_team_logo_url?.trim() || null,
    },
    awayTeam: {
      id: row.away_team_id,
      name: row.away_team_name,
      logoUrl: row.away_team_logo_url?.trim() || null,
    },
  };
}

function tieBreakers(settingsJson: string | null): StandingsTieBreakerKey[] | undefined {
  const values = parseJsonRecord(settingsJson).tieBreakers;
  const allowed: StandingsTieBreakerKey[] = ["head_to_head", "head_to_head_point_diff", "overall_point_diff", "points_for", "alphabetical"];
  if (!Array.isArray(values)) return undefined;
  const result = values.filter((value): value is StandingsTieBreakerKey => allowed.includes(value as StandingsTieBreakerKey));
  return result.length ? result : undefined;
}

function toSeriesPhase(row: PublicPhaseRow, competitionId: string): SeriesCarryOverPhaseLike {
  return {
    id: row.id,
    competition_id: competitionId,
    name: row.name,
    format: row.format,
    phase_kind: row.phase_kind,
    lifecycle_status: row.lifecycle_status,
    previous_phase_id: row.previous_phase_id,
    wins_required: row.wins_required,
    carry_over_enabled: row.carry_over_enabled,
    carry_over_source_phase_id: row.carry_over_source_phase_id,
    settings_json: row.settings_json,
    rule_settings_json: row.rule_settings_json,
  };
}

type BracketSlot = { type: string; position: string | null; teamId: string | null; matchupId: string | null };
type BracketDefinition = { id: string; slotA: BracketSlot; slotB: BracketSlot };

function bracketDefinitions(settingsJson: string | null): BracketDefinition[] {
  const settings = parseJsonRecord(settingsJson);
  const bracket = parseRecord(settings.bracketConfiguration);
  const matchups = Array.isArray(bracket.matchups) ? bracket.matchups : [];
  const slot = (value: unknown): BracketSlot => {
    const record = parseRecord(value);
    return {
      type: String(record.type ?? "").trim(),
      position: String(record.position ?? "").trim() || null,
      teamId: String(record.teamId ?? "").trim() || null,
      matchupId: String(record.matchupId ?? "").trim() || null,
    };
  };
  return matchups.flatMap((value) => {
    const matchup = parseRecord(value);
    const id = String(matchup.id ?? "").trim();
    return id ? [{ id, slotA: slot(matchup.slotA), slotB: slot(matchup.slotB) }] : [];
  });
}

function slotOriginLabel(slot: BracketSlot): string | null {
  if (slot.type === "standing_position" && slot.position) return `#${slot.position}`;
  if (slot.type === "matchup_winner") return "Νικητής διασταύρωσης";
  if (slot.type === "matchup_loser") return "Ηττημένος διασταύρωσης";
  if (slot.type === "fixed_team") return "Επιλεγμένη ομάδα";
  return null;
}

function canonicalSeriesState(matchup: ReturnType<typeof resolveSeriesCarryOver>["matchups"][number], phase: PublicPhaseRow, games: PublicGameRow[]) {
  const transferred: SeriesProgressionTransferredGame[] = matchup.meetingResolutions.flatMap((meeting, index) => {
    const game = games.find((item) => item.id === meeting.gameId);
    return meeting.state === "resolved" && game && game.home_score !== null && game.away_score !== null
      ? [{ sourceGameId: game.id, seriesRoundNumber: index + 1, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: Number(game.home_score), awayScore: Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.venue }]
      : [];
  });
  const materialized: SeriesProgressionMaterializedGame[] = games
    .filter((game) => game.phase_id === phase.id && game.series_matchup_id === matchup.matchupId && game.series_round_number !== null)
    .map((game) => ({ matchupId: matchup.matchupId, gameId: game.id, seriesRoundNumber: Number(game.series_round_number), homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: game.home_score === null ? null : Number(game.home_score), awayScore: game.away_score === null ? null : Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.venue }));
  if (!matchup.teamAId || !matchup.teamBId) return { transferred, materialized, progression: null };
  return {
    transferred,
    materialized,
    progression: calculateSeriesProgression({
      matchupId: matchup.matchupId,
      teamA: { id: matchup.teamAId, name: matchup.teamAName ?? matchup.teamAId },
      teamB: { id: matchup.teamBId, name: matchup.teamBName ?? matchup.teamBId },
      winsRequired: Math.max(1, Number(phase.wins_required ?? 2)),
      transferredGames: transferred,
      materializedGames: materialized,
      planningSlots: [],
    }),
  };
}

function buildCompetitionBracketProjection(phaseRows: PublicPhaseRow[], phases: PublicPhase[], competitionId: string, games: PublicGameRow[], teams: PublicTeamRow[]): CompetitionBracketProjection | null {
  const phaseById = new Map(phaseRows.map((phase) => [phase.id, phase]));
  const publicPhaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const teamById = new Map(teams.map((team) => [team.id, { id: team.id, name: team.name, logoUrl: team.logo_url?.trim() || null }]));
  const seriesRows = phaseRows.filter((phase) => phase.format === "series");
  if (!seriesRows.length) return null;
  const carries = new Map(seriesRows.map((phase) => [phase.id, resolveSeriesCarryOver(phaseRows.map((row) => toSeriesPhase(row, competitionId)), games as SeriesCarryOverGameLike[], teams, toSeriesPhase(phase, competitionId))]));
  const stages: PublicBracketStage[] = [];
  const edges: PublicBracketEdge[] = [];
  const originEntries = new Map<string, { phaseId: string; position: string; team: PublicGameTeam | null }>();

  for (const phase of seriesRows) {
    const carry = carries.get(phase.id);
    const definitions = new Map(bracketDefinitions(phase.rule_settings_json).map((definition) => [definition.id, definition]));
    const participantSourcePhaseId = String(parseRecord(parseJsonRecord(phase.rule_settings_json).participantConfiguration).participantSourcePhaseId ?? "").trim() || null;
    const matchups: PublicBracketMatchup[] = (carry?.matchups ?? []).flatMap((resolution) => {
      const definition = definitions.get(resolution.matchupId);
      if (!definition) return [];
      const direct = resolution.entryKind === "direct_qualifier";
      const playable = resolution.entryKind === undefined && resolution.playable !== false;
      if (!direct && !playable) return [];
      const sides: Array<["A" | "B", BracketSlot, string | null]> = [["A", definition.slotA, resolution.teamAId], ["B", definition.slotB, resolution.teamBId]];
      const participants = sides.flatMap(([slot, source, teamId]) => source.type === "bye" ? [] : [{ slot, team: teamId ? teamById.get(teamId) ?? null : null, originLabel: slotOriginLabel(source) }]);
      for (const [slot, source, teamId] of sides) {
        if (source.type === "standing_position" && source.position && participantSourcePhaseId) {
          originEntries.set(`${participantSourcePhaseId}:${source.position}`, { phaseId: participantSourcePhaseId, position: source.position, team: teamId ? teamById.get(teamId) ?? null : null });
          edges.push({ id: `${participantSourcePhaseId}:seed-${source.position}->${phase.id}:${resolution.matchupId}:${slot}`, from: { phaseId: participantSourcePhaseId, matchupId: `seed-${source.position}`, outcome: "standing_position" }, to: { phaseId: phase.id, matchupId: resolution.matchupId, slot } });
        }
        if ((source.type === "matchup_winner" || source.type === "matchup_loser") && source.matchupId && participantSourcePhaseId) {
          edges.push({ id: `${participantSourcePhaseId}:${source.matchupId}:${source.type}->${phase.id}:${resolution.matchupId}:${slot}`, from: { phaseId: participantSourcePhaseId, matchupId: source.matchupId, outcome: source.type === "matchup_winner" ? "winner" : "loser" }, to: { phaseId: phase.id, matchupId: resolution.matchupId, slot } });
        }
      }
      const state = direct ? null : canonicalSeriesState(resolution, phase, games).progression;
      return [{ matchupId: resolution.matchupId, kind: direct ? "direct_qualifier" as const : "series" as const, participants, winnerTeamId: direct ? resolution.qualifiedTeamId ?? null : state?.qualifiedTeamId ?? null, seriesScore: state ? { winsA: state.currentWinsA, winsB: state.currentWinsB, winsRequired: state.winsRequired } : null, directAdvancement: direct }];
    });
    if (!matchups.length) continue;
    const publicPhase = publicPhaseById.get(phase.id);
    stages.push({ phaseId: phase.id, phaseSlug: publicPhase?.slug ?? phase.id, label: phase.name, order: Number(phase.phase_order ?? 0), kind: "series", matchups });
  }

  for (const entry of originEntries.values()) {
    const source = phaseById.get(entry.phaseId);
    const publicPhase = publicPhaseById.get(entry.phaseId);
    if (!source || source.format !== "standings") continue;
    const stage = stages.find((candidate) => candidate.phaseId === entry.phaseId);
    const matchup: PublicBracketMatchup = { matchupId: `seed-${entry.position}`, kind: "standings_origin", participants: [{ slot: "A", team: entry.team, originLabel: `#${entry.position}` }], winnerTeamId: entry.team?.id ?? null, seriesScore: null, directAdvancement: false };
    if (stage) stage.matchups.push(matchup);
    else stages.push({ phaseId: entry.phaseId, phaseSlug: publicPhase?.slug ?? entry.phaseId, label: `Προέλευση · ${source.name}`, order: Number(source.phase_order ?? 0), kind: "standings_origin", matchups: [matchup] });
  }

  stages.sort((left, right) => left.order - right.order || left.phaseId.localeCompare(right.phaseId));
  const stageIds = new Set(stages.map((stage) => stage.phaseId));
  const canonicalEdges = edges.filter((edge) => stageIds.has(edge.from.phaseId) && stageIds.has(edge.to.phaseId));
  return { meaningful: canonicalEdges.length > 0 && stages.some((stage) => stage.kind === "series"), stages, edges: canonicalEdges };
}

export async function getPublicCompetitionContext(input: {
  seasonSlug?: string | null;
  competitionSlug?: string | null;
  phaseSlug?: string | null;
} = {}): Promise<PublicCompetitionContext> {
  const db = await getDb();
  const visible = await db.prepare(`
    SELECT s.id AS season_id, s.name AS season_name, s.slug AS season_slug,
           c.id AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
           c.type AS competition_type,
           COALESCE(cp.lifecycle_status,
             CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
           ) AS lifecycle_status
      FROM league_competitions c
      JOIN league_seasons s ON s.id=c.season_id
      LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
     WHERE c.organization_id=?
       AND s.starts_on >= ?
       AND s.status IN ('active','completed')
       AND COALESCE(cp.lifecycle_status,
             CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
           ) IN ('online','complete')
     ORDER BY s.starts_on DESC, s.name DESC, c.name COLLATE NOCASE ASC, c.id ASC
  `).bind(PUBLIC_KOMOBASKET_ORGANIZATION_ID, CANONICAL_PUBLIC_SEASON_START).all<PublicCompetitionRow>();
  const rows = visible.results ?? [];
  const seasons = Array.from(new Map(rows.map((row) => [row.season_id, {
    id: row.season_id,
    slug: row.season_slug,
    name: row.season_name,
  }])).values());
  const selectedSeason = seasons.find((season) => season.slug === input.seasonSlug) ?? seasons[0] ?? null;
  const competitions = selectedSeason
    ? rows.filter((row) => row.season_id === selectedSeason.id).map((row) => ({
      id: row.competition_id,
      slug: row.competition_slug,
      name: row.competition_name,
      type: row.competition_type,
      lifecycleStatus: row.lifecycle_status,
    }))
    : [];
  const selectedCompetition = competitions.find((competition) => competition.slug === input.competitionSlug) ?? competitions[0] ?? null;
  if (!selectedCompetition) return { seasons, competitions, phases: [], games: [], standings: [], seriesHistory: [], bracket: null, selectedSeason, selectedCompetition: null, selectedPhase: null };

  const phaseResult = await db.prepare(`
    SELECT p.id, p.slug, p.name, p.format, p.phase_type, p.lifecycle_status, p.previous_phase_id, p.settings_json,
           COALESCE(p.phase_order, p.order_index) AS phase_order,
           pr.phase_kind, pr.wins_required, pr.carry_over_enabled, pr.carry_over_source_phase_id,
           pr.settings_json AS rule_settings_json,
           (SELECT COUNT(*) FROM league_competition_teams ct WHERE ct.competition_id=p.competition_id AND ct.status='active') AS participant_count,
           (SELECT COUNT(DISTINCT g.round_number) FROM league_games g WHERE g.phase_id=p.id AND g.round_number IS NOT NULL) AS round_count,
           COALESCE((SELECT json_group_array(json_object('category', spp.category, 'position', spp.position))
             FROM league_phase_standings_presentation spp WHERE spp.phase_id=p.id), '[]') AS standings_presentation_json
      FROM league_phases p
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
     WHERE p.competition_id=?
     ORDER BY COALESCE(p.phase_order, p.order_index), p.id
  `).bind(selectedCompetition.id).all<PublicPhaseRow>();
  const phaseRows = phaseResult.results ?? [];
  const phases = phaseRows.map(normalizePhase);
  const selectedPhase = phases.find((phase) => phase.slug === input.phaseSlug) ?? phases[0] ?? null;
  const selectedPhaseRow = phaseRows.find((row) => row.id === selectedPhase?.id) ?? null;
  if (!selectedPhase || !selectedPhaseRow) return { seasons, competitions, phases, games: [], standings: [], seriesHistory: [], bracket: null, selectedSeason, selectedCompetition, selectedPhase: null };

  const [teamResult, gameResult] = await Promise.all([
    db.prepare(`SELECT t.id, t.name, COALESCE(st.logo_url, t.logo_url) AS logo_url
      FROM league_competition_teams ct JOIN league_season_teams st ON st.id=ct.season_team_id JOIN league_teams t ON t.id=st.team_id
      WHERE ct.competition_id=? AND ct.status='active' AND t.organization_id=? ORDER BY t.name COLLATE NOCASE, t.id`)
      .bind(selectedCompetition.id, PUBLIC_KOMOBASKET_ORGANIZATION_ID).all<PublicTeamRow>(),
    db.prepare(`
    SELECT g.id, g.competition_id, g.phase_id, g.schedule_id, g.cycle_number, g.round_number, g.series_round_number, g.game_order, g.round_label,
           g.scheduled_date, g.scheduled_time, g.venue, g.home_score, g.away_score, g.status, g.result_source, g.series_matchup_id, g.video_url,
           home.id AS home_team_id, home.name AS home_team_name, home.logo_url AS home_team_logo_url,
           away.id AS away_team_id, away.name AS away_team_name, away.logo_url AS away_team_logo_url
      FROM league_games g
      JOIN league_teams home ON home.id=g.home_team_id
      JOIN league_teams away ON away.id=g.away_team_id
     WHERE g.competition_id=? AND home.organization_id=? AND away.organization_id=?
     ORDER BY CASE WHEN ?='series' THEN COALESCE(g.series_round_number, g.round_number) ELSE g.round_number END,
              g.game_order, g.id
  `).bind(
    selectedCompetition.id,
    PUBLIC_KOMOBASKET_ORGANIZATION_ID,
    PUBLIC_KOMOBASKET_ORGANIZATION_ID,
    selectedPhase.format,
  ).all<PublicGameRow>(),
  ]);
  const teams = teamResult.results ?? [];
  const canonicalGames = gameResult.results ?? [];
  const bracket = buildCompetitionBracketProjection(phaseRows, phases, selectedCompetition.id, canonicalGames, teams);
  const games = canonicalGames.filter((game) => game.phase_id === selectedPhase.id)
    .map((row) => normalizePublicGame(row, selectedPhase.format))
    .filter((game): game is PublicGame => game !== null);

  let standings: PublicStandingRow[] = [];
  if (selectedPhase.format === "standings" && selectedPhase.participantCount !== null) {
    const settings = parseJsonRecord(selectedPhaseRow.rule_settings_json);
    const result = calculateStandings({ phaseId: selectedPhase.id, teams: teams.map((team) => ({ id: team.id, name: team.name })), games: canonicalGames.map((game) => ({ id: game.id, phaseId: game.phase_id, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: game.home_score, awayScore: game.away_score, status: game.status, resultSource: game.result_source })), rules: { pointsForWin: Number(settings.pointsForWin ?? settings.winPoints ?? 2), pointsForLoss: Number(settings.pointsForLoss ?? settings.lossPoints ?? 1) }, tieBreakers: tieBreakers(selectedPhaseRow.rule_settings_json) });
    const stats = new Map(result.rows.map((row) => [row.teamId, row]));
    const byTeam = new Map(teams.map((team) => [team.id, team]));
    standings = result.orderedRows.flatMap((ordered) => { const row = stats.get(ordered.teamId); const team = byTeam.get(ordered.teamId); return row && team ? [{ rank: ordered.rank, team: { id: team.id, name: team.name, logoUrl: team.logo_url?.trim() || null }, gamesPlayed: row.gamesPlayed, wins: row.wins, losses: row.losses, standingsPoints: row.standingsPoints, pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst, pointDifference: row.pointDifference }] : []; });
  }

  const seriesHistory: PublicSeriesMatchupHistory[] = [];
  let directAdvancements = selectedPhase.directAdvancements;
  if (selectedPhase.format === "series") {
    const carry = resolveSeriesCarryOver(phaseRows.map((row) => toSeriesPhase(row, selectedCompetition.id)), canonicalGames as SeriesCarryOverGameLike[], teams, toSeriesPhase(selectedPhaseRow, selectedCompetition.id));
    const direct = carry.matchups.filter((matchup) => matchup.entryKind === "direct_qualifier" && matchup.state === "resolved" && matchup.qualifiedTeamName).map((matchup) => ({ matchupId: matchup.matchupId, label: `${matchup.qualifiedTeamName} — Πρόκριση χωρίς αγώνα.`, participantSlotType: "canonical_direct_qualifier" }));
    if (direct.length) directAdvancements = direct;
    for (const matchup of carry.matchups) {
      if (matchup.entryKind !== undefined || matchup.playable === false || matchup.state !== "resolved" || !matchup.teamAId || !matchup.teamBId) continue;
      const transferred: SeriesProgressionTransferredGame[] = matchup.meetingResolutions.flatMap((meeting, index) => { const game = canonicalGames.find((item) => item.id === meeting.gameId); return meeting.state === "resolved" && game && game.home_score !== null && game.away_score !== null ? [{ sourceGameId: game.id, seriesRoundNumber: index + 1, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: Number(game.home_score), awayScore: Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.venue }] : []; });
      const materialized: SeriesProgressionMaterializedGame[] = canonicalGames.filter((game) => game.phase_id === selectedPhase.id && game.series_matchup_id === matchup.matchupId && game.series_round_number !== null).map((game) => ({ matchupId: matchup.matchupId, gameId: game.id, seriesRoundNumber: Number(game.series_round_number), homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: game.home_score === null ? null : Number(game.home_score), awayScore: game.away_score === null ? null : Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.venue }));
      const progression = calculateSeriesProgression({ matchupId: matchup.matchupId, teamA: { id: matchup.teamAId, name: matchup.teamAName ?? matchup.teamAId }, teamB: { id: matchup.teamBId, name: matchup.teamBName ?? matchup.teamBId }, winsRequired: Math.max(1, Number(selectedPhase.winsRequired ?? 2)), transferredGames: transferred, materializedGames: materialized, planningSlots: [] });
      const rounds = progression.rounds.flatMap<PublicSeriesRound>((round): PublicSeriesRound[] => { if (round.rowState === "transferred" && round.sourceGameId) { const game = canonicalGames.find((item) => item.id === round.sourceGameId); const projected = game ? normalizePublicGame(game, "series", round.seriesRoundNumber) : null; return projected ? [{ roundNumber: round.seriesRoundNumber, kind: "transferred" as const, sourcePhaseName: matchup.sourcePhaseName, game: projected }] : []; } if (round.rowState === "real_game" && round.realGameId) { const game = canonicalGames.find((item) => item.id === round.realGameId); const projected = game ? normalizePublicGame(game, "series", round.seriesRoundNumber) : null; return projected ? [{ roundNumber: round.seriesRoundNumber, kind: "game" as const, sourcePhaseName: null, game: projected }] : []; } return round.rowState === "qualified" ? [{ roundNumber: round.seriesRoundNumber, kind: "not_needed" as const, sourcePhaseName: null, game: null }] : []; });
      seriesHistory.push({ matchupId: matchup.matchupId, label: matchup.label, maximumSeriesRounds: progression.maximumSeriesRounds, rounds });
    }
  }
  return { seasons, competitions, phases, games, standings, seriesHistory, bracket, selectedSeason, selectedCompetition, selectedPhase: { ...selectedPhase, directAdvancements } };
}
