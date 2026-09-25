import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { PublicCompetitionStatisticsSourceGame, PublicTopPerformance } from "@/lib/public-competition-statistics";
import { readAuthoritativeCompetitionStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type MatchdayGameRow = { game_id: string; round_number: number; round_label: string | null };
type StoredMatchdayMvpRow = {
  id: string; organization_id: string; competition_id: string; phase_id: string;
  round_number: number; game_id: string; player_id: string; created_at: string; updated_at: string;
};

export type MatchdayMvpPerformance = PublicTopPerformance & { gameId: string; playerId: string };
export type MatchdayMvpSelection = MatchdayMvpPerformance & { selectedAt: string };
export type MatchdayMvpState = {
  competitionId: string; phaseId: string; roundNumber: number; roundLabel: string; eligible: boolean;
  candidates: MatchdayMvpPerformance[]; otherPerformances: MatchdayMvpPerformance[]; selection: MatchdayMvpSelection | null;
};

export class MatchdayMvpError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "MATCHDAY_NOT_FOUND" | "MATCHDAY_INCOMPLETE" | "PLAYER_NOT_ELIGIBLE",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MatchdayMvpError";
  }
}

export function matchdayMvpErrorResponse(error: unknown) {
  return error instanceof MatchdayMvpError
    ? Response.json({ error: error.message, code: error.code }, { status: error.status })
    : null;
}

function requiredId(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new MatchdayMvpError("INVALID_INPUT", `Λείπει το πεδίο ${field}.`, 400);
  return normalized;
}

function requiredRoundNumber(value: unknown) {
  const roundNumber = Number(value);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) throw new MatchdayMvpError("INVALID_INPUT", "Η αγωνιστική δεν είναι έγκυρη.", 400);
  return roundNumber;
}

export function rankMatchdayMvpPerformances(games: PublicCompetitionStatisticsSourceGame[]): MatchdayMvpPerformance[] {
  const performances = games.flatMap((game) => ([
    ...game.homePlayers.map((player) => ({
      gameId: game.gameId, playerId: player.canonicalPlayerId,
      player: { shirtNumber: player.shirtNumber, displayName: player.displayName },
      teamName: game.homeTeamName, opponentName: game.awayTeamName,
      finalScore: { team: game.homeScore, opponent: game.awayScore },
      scheduledDate: game.scheduledDate, statistics: { ...player.statistics },
    })),
    ...game.awayPlayers.map((player) => ({
      gameId: game.gameId, playerId: player.canonicalPlayerId,
      player: { shirtNumber: player.shirtNumber, displayName: player.displayName },
      teamName: game.awayTeamName, opponentName: game.homeTeamName,
      finalScore: { team: game.awayScore, opponent: game.homeScore },
      scheduledDate: game.scheduledDate, statistics: { ...player.statistics },
    })),
  ]));
  performances.sort((left, right) => right.statistics.efficiency - left.statistics.efficiency
    || right.statistics.points - left.statistics.points
    || right.statistics.rebounds - left.statistics.rebounds
    || right.statistics.assists - left.statistics.assists
    || left.player.displayName.localeCompare(right.player.displayName, "el")
    || left.playerId.localeCompare(right.playerId));
  return performances;
}

function publicPerformance(performance: MatchdayMvpPerformance): PublicTopPerformance {
  return {
    player: { ...performance.player }, teamName: performance.teamName, opponentName: performance.opponentName,
    finalScore: { ...performance.finalScore }, scheduledDate: performance.scheduledDate, statistics: { ...performance.statistics },
  };
}

async function readMatchdayGames(database: D1DatabaseBinding, organizationId: string, competitionId: string, phaseId: string, roundNumber: number) {
  const result = await database.prepare(`SELECT game.id AS game_id, game.round_number, game.round_label
    FROM league_games game
    JOIN league_competitions competition ON competition.id=game.competition_id
    JOIN league_phases phase ON phase.id=game.phase_id AND phase.competition_id=competition.id
    WHERE competition.organization_id=? AND game.competition_id=? AND phase.id=?
      AND phase.format='standings' AND game.round_number=?
      AND game.status IN ('scheduled','completed')
    ORDER BY game.game_order, game.id`)
    .bind(organizationId, competitionId, phaseId, roundNumber).all<MatchdayGameRow>();
  const rows = result.results ?? [];
  if (!rows.length) throw new MatchdayMvpError("MATCHDAY_NOT_FOUND", "Η αγωνιστική δεν βρέθηκε.", 404);
  const authoritativeGames = await readAuthoritativeCompetitionStatisticalGamesWithDb(database, competitionId, organizationId);
  const authoritativeById = new Map(authoritativeGames.map((game) => [game.gameId, game]));
  const eligibleGames: PublicCompetitionStatisticsSourceGame[] = rows.flatMap((row) => {
    const game = authoritativeById.get(row.game_id);
    return game ? [{ ...game, roundNumber: Number(row.round_number) }] : [];
  });
  return {
    eligibleGames,
    complete: eligibleGames.length === rows.length,
    label: rows.find((row) => row.round_label?.trim())?.round_label?.trim() || `${roundNumber}η Αγωνιστική`,
  };
}

async function readStoredSelection(database: D1DatabaseBinding, organizationId: string, competitionId: string, phaseId: string, roundNumber: number) {
  return database.prepare(`SELECT id, organization_id, competition_id, phase_id, round_number, game_id, player_id, created_at, updated_at
    FROM league_matchday_mvp_selections
    WHERE organization_id=? AND competition_id=? AND phase_id=? AND round_number=?`)
    .bind(organizationId, competitionId, phaseId, roundNumber).first<StoredMatchdayMvpRow>();
}

export async function readMatchdayMvpWithDb(
  database: D1DatabaseBinding,
  input: { organizationId: string; competitionId: string; phaseId: string; roundNumber: number },
): Promise<MatchdayMvpState> {
  const organizationId = requiredId(input.organizationId, "organizationId");
  const competitionId = requiredId(input.competitionId, "competitionId");
  const phaseId = requiredId(input.phaseId, "phaseId");
  const roundNumber = requiredRoundNumber(input.roundNumber);
  const matchday = await readMatchdayGames(database, organizationId, competitionId, phaseId, roundNumber);
  const ranked = matchday.complete ? rankMatchdayMvpPerformances(matchday.eligibleGames) : [];
  const stored = matchday.complete ? await readStoredSelection(database, organizationId, competitionId, phaseId, roundNumber) : null;
  const selected = stored ? ranked.find((entry) => entry.gameId === stored.game_id && entry.playerId === stored.player_id) ?? null : null;
  return {
    competitionId, phaseId, roundNumber, roundLabel: matchday.label, eligible: matchday.complete,
    candidates: ranked.slice(0, 5), otherPerformances: ranked.slice(5),
    selection: selected && stored ? { ...selected, selectedAt: stored.updated_at } : null,
  };
}

export async function saveMatchdayMvpWithDb(
  database: D1DatabaseBinding,
  input: { organizationId: string; competitionId: string; phaseId: string; roundNumber: number; gameId: string; playerId: string },
): Promise<MatchdayMvpState> {
  const gameId = requiredId(input.gameId, "gameId");
  const playerId = requiredId(input.playerId, "playerId");
  const current = await readMatchdayMvpWithDb(database, input);
  if (!current.eligible) throw new MatchdayMvpError("MATCHDAY_INCOMPLETE", "Η αγωνιστική πρέπει να ολοκληρωθεί πριν επιλεγεί MVP.", 409);
  const selected = [...current.candidates, ...current.otherPerformances].find((entry) => entry.gameId === gameId && entry.playerId === playerId);
  if (!selected) throw new MatchdayMvpError("PLAYER_NOT_ELIGIBLE", "Ο παίκτης δεν ανήκει στις επιλέξιμες εμφανίσεις της αγωνιστικής.", 400);
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO league_matchday_mvp_selections
      (id, organization_id, competition_id, phase_id, round_number, game_id, player_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(competition_id, phase_id, round_number) DO UPDATE SET
      organization_id=excluded.organization_id, game_id=excluded.game_id,
      player_id=excluded.player_id, updated_at=excluded.updated_at`)
    .bind(`matchday_mvp_${crypto.randomUUID()}`, input.organizationId, input.competitionId, input.phaseId, current.roundNumber, gameId, playerId, now, now).run();
  return { ...current, selection: { ...selected, selectedAt: now } };
}

export async function readPublicMatchdayMvpSelectionsWithDb(
  database: D1DatabaseBinding,
  organizationId: string,
  competitionId: string,
  games: PublicCompetitionStatisticsSourceGame[],
) {
  const result = await database.prepare(`SELECT selection.id, selection.organization_id, selection.competition_id,
      selection.phase_id, selection.round_number, selection.game_id, selection.player_id,
      selection.created_at, selection.updated_at
    FROM league_matchday_mvp_selections selection
    JOIN league_games game ON game.id=selection.game_id
    JOIN league_competitions competition ON competition.id=game.competition_id
    JOIN league_phases phase ON phase.id=selection.phase_id AND phase.id=game.phase_id
      AND phase.competition_id=competition.id
    WHERE selection.organization_id=? AND selection.competition_id=?
      AND competition.organization_id=? AND game.competition_id=?
    ORDER BY selection.updated_at DESC, selection.id`)
    .bind(organizationId, competitionId, organizationId, competitionId).all<StoredMatchdayMvpRow>();
  const ranked = rankMatchdayMvpPerformances(games);
  const selectedByRound = new Map<number, PublicTopPerformance>();
  for (const selection of result.results ?? []) {
    if (selectedByRound.has(Number(selection.round_number))) continue;
    const selected = ranked.find((entry) => entry.gameId === selection.game_id && entry.playerId === selection.player_id);
    const selectedGame = games.find((game) => game.gameId === selection.game_id);
    if (selected && selectedGame?.roundNumber === Number(selection.round_number)) selectedByRound.set(Number(selection.round_number), publicPerformance(selected));
  }
  return selectedByRound;
}

async function productionDatabase() {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("MATCHDAY_MVP_UNAVAILABLE");
  return environment.NEWS_DB;
}

export async function readMatchdayMvp(input: { organizationId: string; competitionId: string; phaseId: string; roundNumber: number }) {
  return readMatchdayMvpWithDb(await productionDatabase(), input);
}

export async function saveMatchdayMvp(input: { organizationId: string; competitionId: string; phaseId: string; roundNumber: number; gameId: string; playerId: string }) {
  return saveMatchdayMvpWithDb(await productionDatabase(), input);
}
