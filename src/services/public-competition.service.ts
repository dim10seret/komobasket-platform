import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
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
  participant_count: number | null;
  round_count: number | null;
  wins_required: number | null;
  rule_settings_json: string | null;
  standings_presentation_json: string;
};

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
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    format: format === "standings" || format === "series" ? format : "custom",
    phaseType: row.phase_type,
    participantCount: row.participant_count === null ? null : Number(row.participant_count),
    roundCount: row.round_count === null ? null : Number(row.round_count),
    winsRequired: row.wins_required === null ? null : Number(row.wins_required),
    directAdvancements: parseDirectAdvancements(row.rule_settings_json),
    standingsPresentation: parseStandingsPresentation(row.standings_presentation_json),
  };
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
  if (!selectedCompetition) return { seasons, competitions, phases: [], selectedSeason, selectedCompetition: null, selectedPhase: null };

  const phaseResult = await db.prepare(`
    SELECT p.id, p.slug, p.name, p.format, p.phase_type,
           COALESCE(p.phase_order, p.order_index) AS phase_order,
           pr.wins_required, pr.settings_json AS rule_settings_json,
           (SELECT COUNT(*) FROM league_competition_teams ct WHERE ct.competition_id=p.competition_id AND ct.status='active') AS participant_count,
           (SELECT COUNT(DISTINCT g.round_number) FROM league_games g WHERE g.phase_id=p.id AND g.round_number IS NOT NULL) AS round_count,
           COALESCE((SELECT json_group_array(json_object('category', spp.category, 'position', spp.position))
             FROM league_phase_standings_presentation spp WHERE spp.phase_id=p.id), '[]') AS standings_presentation_json
      FROM league_phases p
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
     WHERE p.competition_id=?
     ORDER BY COALESCE(p.phase_order, p.order_index), p.id
  `).bind(selectedCompetition.id).all<PublicPhaseRow>();
  const phases = (phaseResult.results ?? []).map(normalizePhase);
  const selectedPhase = phases.find((phase) => phase.slug === input.phaseSlug) ?? phases[0] ?? null;
  return { seasons, competitions, phases, selectedSeason, selectedCompetition, selectedPhase };
}
