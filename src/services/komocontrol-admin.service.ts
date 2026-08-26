import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { createScorerPasswordHash, normalizeScorerUsername } from "@/services/komocontrol-scorer-credentials";
import { isCoherentKomoControlResultPolicy } from "@/services/komocontrol-result-policy";

type GameMode = "SIMPLE" | "FULL";
type ScorerStatus = "active" | "disabled";

export class KomoControlAdminError extends Error {
  constructor(readonly message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "KomoControlAdminError";
  }
}

const DEFAULTS = {
  game_mode: "SIMPLE" as GameMode,
  min_players: 5,
  max_players: 12,
  starting_players: 5,
  regulation_periods: 4,
  regulation_period_seconds: 600,
  overtime_seconds: 300,
  tie_allowed: 0,
  winner_required: 1,
};

async function db() {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_DB) throw new KomoControlAdminError("Η βάση KomoControl δεν είναι διαθέσιμη.", 404);
  return env.NEWS_DB;
}

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new KomoControlAdminError(`Το πεδίο ${label} είναι υποχρεωτικό.`);
  return text;
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function positiveInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new KomoControlAdminError(`Το πεδίο ${label} πρέπει να είναι θετικός ακέραιος.`);
  return number;
}

function flag(value: unknown, label: string) {
  if (value === true || value === 1 || value === "1" || value === "true") return 1;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  throw new KomoControlAdminError(`Το πεδίο ${label} δεν είναι έγκυρο.`);
}

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

function normalizedUsername(value: unknown) {
  const username = requiredText(value, "Username");
  const normalized = normalizeScorerUsername(username);
  if (!normalized) throw new KomoControlAdminError("Το Username είναι υποχρεωτικό.");
  return { username, normalized };
}

export async function hashScorerPassword(value: unknown) {
  const password = requiredText(value, "Password");
  if (password.length < 8) throw new KomoControlAdminError("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.");
  return createScorerPasswordHash(password);
}

function settingsInput(input: Record<string, unknown>) {
  const game_mode = String(input.game_mode ?? "").trim();
  if (game_mode !== "SIMPLE" && game_mode !== "FULL") throw new KomoControlAdminError("Ο τύπος καταγραφής δεν είναι έγκυρος.");
  const result = {
    game_mode: game_mode as GameMode,
    min_players: positiveInteger(input.min_players, "Ελάχιστοι παίκτες"),
    max_players: positiveInteger(input.max_players, "Μέγιστοι παίκτες"),
    starting_players: positiveInteger(input.starting_players, "Παίκτες στο γήπεδο"),
    regulation_periods: positiveInteger(input.regulation_periods, "Αριθμός περιόδων"),
    regulation_period_seconds: positiveInteger(input.regulation_period_seconds, "Διάρκεια περιόδου"),
    overtime_seconds: positiveInteger(input.overtime_seconds, "Διάρκεια παράτασης"),
    tie_allowed: flag(input.tie_allowed, "Επιτρέπεται ισοπαλία"),
    winner_required: flag(input.winner_required, "Απαιτείται νικητής"),
  };
  if (result.min_players > result.starting_players || result.starting_players > result.max_players) throw new KomoControlAdminError("Ισχύει: ελάχιστοι παίκτες ≤ παίκτες στο γήπεδο ≤ μέγιστοι παίκτες.");
  if (!isCoherentKomoControlResultPolicy(Boolean(result.tie_allowed), Boolean(result.winner_required))) throw new KomoControlAdminError("Επιλέξτε ακριβώς μία πολιτική αποτελέσματος: επιτρέπεται ισοπαλία ή απαιτείται νικητής.");
  return result;
}

async function requireCompetition(organizationId: string, competitionId: string) {
  const database = await db();
  const competition = await database.prepare("SELECT id FROM league_competitions WHERE id=? AND organization_id=?").bind(competitionId, organizationId).first<{ id: string }>();
  if (!competition) throw new KomoControlAdminError("Η Διοργάνωση δεν είναι διαθέσιμη για αυτόν τον Οργανισμό.", 404);
  return database;
}

export async function listKomoControlSettings(organizationId: string, competitionId?: string) {
  const database = await db();
  const competitions = await database.prepare(`SELECT c.id, c.name, c.status, s.name AS season_name
    FROM league_competitions c JOIN league_seasons s ON s.id=c.season_id
    WHERE c.organization_id=? AND s.status<>'completed' AND c.status<>'completed'
    ORDER BY s.starts_on DESC, s.name DESC, c.name COLLATE NOCASE`).bind(organizationId).all();
  let settings: GamePackageSettings | null = null;
  if (competitionId) {
    await requireCompetition(organizationId, competitionId);
    const stored = await database.prepare("SELECT * FROM league_competition_komocontrol_defaults WHERE competition_id=?").bind(competitionId).first<Record<string, unknown>>();
    settings = stored ? gamePackageSettingsFromDatabase(settingsFrom(stored)) : null;
  }
  return { competitions: competitions.results, settings, defaults: gamePackageSettingsFromDatabase(DEFAULTS) };
}

export async function saveKomoControlSettings(organizationId: string, input: Record<string, unknown>) {
  const competitionId = requiredText(input.competitionId, "Διοργάνωση");
  const values = settingsInput(input);
  const database = await requireCompetition(organizationId, competitionId);
  await database.prepare(`INSERT INTO league_competition_komocontrol_defaults
    (competition_id, game_mode, min_players, max_players, starting_players, regulation_periods, regulation_period_seconds, overtime_seconds, tie_allowed, winner_required)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(competition_id) DO UPDATE SET game_mode=excluded.game_mode, min_players=excluded.min_players, max_players=excluded.max_players, starting_players=excluded.starting_players, regulation_periods=excluded.regulation_periods, regulation_period_seconds=excluded.regulation_period_seconds, overtime_seconds=excluded.overtime_seconds, tie_allowed=excluded.tie_allowed, winner_required=excluded.winner_required, updated_at=CURRENT_TIMESTAMP`)
    .bind(competitionId, values.game_mode, values.min_players, values.max_players, values.starting_players, values.regulation_periods, values.regulation_period_seconds, values.overtime_seconds, values.tie_allowed, values.winner_required).run();
  return values;
}

export async function listScorers(organizationId: string) {
  return (await (await db()).prepare("SELECT id, username, status, credential_version, created_at, updated_at, disabled_at FROM league_komocontrol_scorers WHERE organization_id=? ORDER BY username COLLATE NOCASE, id").bind(organizationId).all()).results;
}

export async function createScorer(organizationId: string, input: Record<string, unknown>) {
  const { username, normalized } = normalizedUsername(input.username); const passwordHash = await hashScorerPassword(input.password); const status: ScorerStatus = input.status === "disabled" ? "disabled" : "active"; const database = await db();
  const duplicate = await database.prepare("SELECT id FROM league_komocontrol_scorers WHERE normalized_username=?").bind(normalized).first();
  if (duplicate) throw new KomoControlAdminError("Υπάρχει ήδη scorer με αυτό το Username.", 409);
  const scorerId = id("komocontrol_scorer");
  await database.prepare("INSERT INTO league_komocontrol_scorers (id, organization_id, username, normalized_username, password_hash, status, disabled_at) VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ?='disabled' THEN CURRENT_TIMESTAMP ELSE NULL END)").bind(scorerId, organizationId, username, normalized, passwordHash, status, status).run();
  return { id: scorerId };
}

export async function updateScorer(organizationId: string, input: Record<string, unknown>) {
  const scorerId = requiredText(input.id, "Scorer"); const database = await db(); const current = await database.prepare("SELECT id FROM league_komocontrol_scorers WHERE id=? AND organization_id=?").bind(scorerId, organizationId).first(); if (!current) throw new KomoControlAdminError("Ο scorer δεν βρέθηκε.", 404);
  const { username, normalized } = normalizedUsername(input.username); const status: ScorerStatus = input.status === "disabled" ? "disabled" : "active";
  const duplicate = await database.prepare("SELECT id FROM league_komocontrol_scorers WHERE normalized_username=? AND id<>?").bind(normalized, scorerId).first(); if (duplicate) throw new KomoControlAdminError("Υπάρχει ήδη scorer με αυτό το Username.", 409);
  const password = String(input.password ?? ""); const changePassword = password.trim().length > 0;
  if (changePassword) { const hash = await hashScorerPassword(password); await database.prepare("UPDATE league_komocontrol_scorers SET username=?, normalized_username=?, password_hash=?, credential_version=credential_version+1, status=?, disabled_at=CASE WHEN ?='disabled' THEN COALESCE(disabled_at, CURRENT_TIMESTAMP) ELSE NULL END, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(username, normalized, hash, status, status, scorerId).run(); }
  else { await database.prepare("UPDATE league_komocontrol_scorers SET username=?, normalized_username=?, status=?, disabled_at=CASE WHEN ?='disabled' THEN COALESCE(disabled_at, CURRENT_TIMESTAMP) ELSE NULL END, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(username, normalized, status, status, scorerId).run(); }
}

type Registry = "referees" | "table-officials";
const registryTable: Record<Registry, string> = { referees: "league_referees", "table-officials": "league_table_officials" };
function registryInput(input: Record<string, unknown>) { return { first_name: requiredText(input.first_name, "Όνομα"), last_name: requiredText(input.last_name, "Επώνυμο"), organization: optionalText(input.organization), active: flag(input.active, "Ενεργός") }; }
export async function listRegistry(organizationId: string, registry: Registry) { return (await (await db()).prepare(`SELECT id, first_name, last_name, organization, active, created_at, updated_at FROM ${registryTable[registry]} WHERE organization_id=? ORDER BY active DESC, last_name COLLATE NOCASE, first_name COLLATE NOCASE, id`).bind(organizationId).all()).results; }
export async function createRegistryEntry(organizationId: string, registry: Registry, input: Record<string, unknown>) { const value=registryInput(input);const database=await db();const entryId=id(registry === "referees" ? "referee" : "table_official");await database.prepare(`INSERT INTO ${registryTable[registry]} (id, organization_id, first_name, last_name, organization, active) VALUES (?, ?, ?, ?, ?, ?)`).bind(entryId,organizationId,value.first_name,value.last_name,value.organization,value.active).run();return {id:entryId}; }
export async function updateRegistryEntry(organizationId: string, registry: Registry, input: Record<string, unknown>) { const entryId=requiredText(input.id, registry === "referees" ? "Διαιτητής" : "Κριτής");const value=registryInput(input);const database=await db();const result=await database.prepare(`UPDATE ${registryTable[registry]} SET first_name=?, last_name=?, organization=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(value.first_name,value.last_name,value.organization,value.active,entryId,organizationId).run() as { meta?: { changes?: number } };if(!result.meta?.changes)throw new KomoControlAdminError("Η εγγραφή δεν βρέθηκε.",404); }

export function komoControlAdminErrorResponse(error: unknown) { return error instanceof KomoControlAdminError ? Response.json({ error: error.message }, { status: error.status }) : null; }

type DatabasePackageSettings = {
  game_mode: GameMode; min_players: number; max_players: number; starting_players: number;
  regulation_periods: number; regulation_period_seconds: number; overtime_seconds: number;
  tie_allowed: number; winner_required: number;
};

export type GamePackageSettings = {
  game_mode: GameMode; min_players: number; max_players: number; starting_players: number;
  regulation_periods: number; regulation_period_seconds: number; overtime_seconds: number;
  tie_allowed: boolean; winner_required: boolean;
};

type GameSettingsOverride = {
  game_mode: GameMode | null; min_players: number | null; max_players: number | null; starting_players: number | null;
  regulation_periods: number | null; regulation_period_seconds: number | null; overtime_seconds: number | null;
  tie_allowed: boolean | null; winner_required: boolean | null;
};

export type GamePackageV1 = {
  schemaVersion: 1;
  game: { id: string; organizationId: string; competitionId: string; competitionName: string; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; scheduledAt: string | null; venue: string | null };
  settings: GamePackageSettings;
  teams: Array<{ side: "HOME" | "AWAY"; id: string; name: string; logoUrl: string | null; players: Array<{ id: string; displayName: string; shirtNumber: number | null; photoUrl: string | null }>; staff: Array<{ id: string; displayName: string; role: string; roleLabel: string | null }> }>;
};

type GameRow = { id: string; competition_id: string; organization_id: string; competition_name: string; season_name: string; phase_name: string | null; round_label: string | null; scheduled_date: string | null; scheduled_time: string | null; scheduled_at: string | null; venue: string | null; status: string; home_team_id: string; away_team_id: string; home_team_name: string; away_team_name: string; home_team_logo_url: string | null; away_team_logo_url: string | null };
const settingKeys = ["game_mode", "min_players", "max_players", "starting_players", "regulation_periods", "regulation_period_seconds", "overtime_seconds", "tie_allowed", "winner_required"] as const;

function deterministicJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(deterministicJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${deterministicJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function snapshotHash(snapshot: GamePackageV1) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deterministicJson(snapshot))));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function settingsFrom(input: Record<string, unknown>): DatabasePackageSettings {
  return {
    game_mode: input.game_mode === "FULL" ? "FULL" : "SIMPLE",
    min_players: Number(input.min_players), max_players: Number(input.max_players), starting_players: Number(input.starting_players),
    regulation_periods: Number(input.regulation_periods), regulation_period_seconds: Number(input.regulation_period_seconds), overtime_seconds: Number(input.overtime_seconds),
    tie_allowed: Number(input.tie_allowed), winner_required: Number(input.winner_required),
  };
}

function validateEffectiveSettings(values: DatabasePackageSettings) {
  const valid = settingsInput(values as unknown as Record<string, unknown>);
  return { ...valid, tie_allowed: valid.tie_allowed ? 1 : 0, winner_required: valid.winner_required ? 1 : 0 } as DatabasePackageSettings;
}

function databaseBoolean(value: unknown, label: string) {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new KomoControlAdminError(`Η ρύθμιση ${label} δεν είναι έγκυρη.`);
}

function gamePackageSettingsFromDatabase(values: DatabasePackageSettings): GamePackageSettings {
  return { ...values, tie_allowed: databaseBoolean(values.tie_allowed, "Επιτρέπεται ισοπαλία"), winner_required: databaseBoolean(values.winner_required, "Απαιτείται νικητής") };
}

function gameSettingsOverrideFromDatabase(values: Record<string, unknown>): GameSettingsOverride {
  const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
  const nullableMode = (value: unknown) => value === null || value === undefined ? null : value === "SIMPLE" || value === "FULL" ? value : (() => { throw new KomoControlAdminError("Ο τύπος καταγραφής δεν είναι έγκυρος."); })();
  const nullableBoolean = (value: unknown, label: string) => value === null || value === undefined ? null : databaseBoolean(value, label);
  return {
    game_mode: nullableMode(values.game_mode), min_players: nullableNumber(values.min_players), max_players: nullableNumber(values.max_players), starting_players: nullableNumber(values.starting_players),
    regulation_periods: nullableNumber(values.regulation_periods), regulation_period_seconds: nullableNumber(values.regulation_period_seconds), overtime_seconds: nullableNumber(values.overtime_seconds),
    tie_allowed: nullableBoolean(values.tie_allowed, "Επιτρέπεται ισοπαλία"), winner_required: nullableBoolean(values.winner_required, "Απαιτείται νικητής"),
  };
}

async function gameForOrganization(organizationId: string, gameId: string) {
  const row = await (await db()).prepare(`SELECT g.id, g.competition_id, c.organization_id, c.name AS competition_name, s.name AS season_name,
      p.name AS phase_name, g.round_label, g.scheduled_date, g.scheduled_time, g.scheduled_at, g.venue, g.status, g.home_team_id, g.away_team_id,
      COALESCE(NULLIF(TRIM(home_st.display_name), ''), home.name) AS home_team_name, COALESCE(home_st.logo_url, home.logo_url) AS home_team_logo_url,
      COALESCE(NULLIF(TRIM(away_st.display_name), ''), away.name) AS away_team_name, COALESCE(away_st.logo_url, away.logo_url) AS away_team_logo_url
    FROM league_games g JOIN league_competitions c ON c.id=g.competition_id JOIN league_seasons s ON s.id=c.season_id
    LEFT JOIN league_phases p ON p.id=g.phase_id
    JOIN league_competition_teams home_ct ON home_ct.competition_id=g.competition_id AND home_ct.status='active'
    JOIN league_season_teams home_st ON home_st.id=home_ct.season_team_id AND home_st.team_id=g.home_team_id
    JOIN league_teams home ON home.id=g.home_team_id
    JOIN league_competition_teams away_ct ON away_ct.competition_id=g.competition_id AND away_ct.status='active'
    JOIN league_season_teams away_st ON away_st.id=away_ct.season_team_id AND away_st.team_id=g.away_team_id
    JOIN league_teams away ON away.id=g.away_team_id
    WHERE g.id=? AND c.organization_id=? AND c.status<>'completed' AND s.status<>'completed'`).bind(gameId, organizationId).first<GameRow>();
  if (!row) throw new KomoControlAdminError("Ο αγώνας δεν είναι διαθέσιμος για KomoControl.", 404);
  if (row.status !== "scheduled" && row.status !== "postponed") throw new KomoControlAdminError("Ο αγώνας δεν είναι διαθέσιμος για προετοιμασία KomoControl.", 409);
  if (!row.scheduled_date || !row.scheduled_time?.trim()) throw new KomoControlAdminError("Ο αγώνας δεν έχει έγκυρο προγραμματισμό.", 409);
  return row;
}

async function effectiveGameSettings(organizationId: string, gameId: string) {
  const game = await gameForOrganization(organizationId, gameId); const database = await db();
  const defaults = await database.prepare("SELECT * FROM league_competition_komocontrol_defaults WHERE competition_id=?").bind(game.competition_id).first<Record<string, unknown>>();
  if (!defaults) throw new KomoControlAdminError("Δεν έχουν οριστεί ρυθμίσεις KomoControl για τη διοργάνωση.", 409);
  const override = await database.prepare("SELECT * FROM league_game_komocontrol_overrides WHERE game_id=?").bind(gameId).first<Record<string, unknown>>() ?? null;
  const merged: Record<string, unknown> = { ...defaults };
  if (override) for (const key of settingKeys) if (override[key] !== null && override[key] !== undefined) merged[key] = override[key];
  return {
    game,
    defaults: gamePackageSettingsFromDatabase(settingsFrom(defaults)),
    override: override ? gameSettingsOverrideFromDatabase(override) : null,
    effective: gamePackageSettingsFromDatabase(validateEffectiveSettings(settingsFrom(merged))),
  };
}

async function teamSnapshot(database: Awaited<ReturnType<typeof db>>, game: GameRow, side: "HOME" | "AWAY") {
  const teamId = side === "HOME" ? game.home_team_id : game.away_team_id;
  const players = (await database.prepare(`SELECT r.player_id AS id, COALESCE(NULLIF(TRIM(p.display_name), ''), TRIM(p.first_name || ' ' || p.last_name)) AS display_name, r.shirt_number, p.photo_url
    FROM league_roster_memberships r JOIN league_players p ON p.id=r.player_id
    WHERE r.competition_id=? AND r.team_id=? AND r.status='active' ORDER BY p.display_name COLLATE NOCASE, p.id`).bind(game.competition_id, teamId).all<{ id: string; display_name: string; shirt_number: number | null; photo_url: string | null }>()).results ?? [];
  const staff = (await database.prepare(`SELECT m.staff_id AS id, COALESCE(NULLIF(TRIM(s.display_name), ''), TRIM(s.first_name || ' ' || s.last_name)) AS display_name, m.role, m.custom_role_label
    FROM league_staff_memberships m JOIN league_staff s ON s.id=m.staff_id
    WHERE m.competition_id=? AND m.team_id=? AND s.active=1 ORDER BY m.role, s.display_name COLLATE NOCASE, m.staff_id`).bind(game.competition_id, teamId).all<{ id: string; display_name: string; role: string; custom_role_label: string | null }>()).results ?? [];
  const isHome = side === "HOME";
  return { side, id: teamId, name: isHome ? game.home_team_name : game.away_team_name, logoUrl: isHome ? game.home_team_logo_url : game.away_team_logo_url,
    players: players.map((player) => ({ id: player.id, displayName: player.display_name, shirtNumber: player.shirt_number, photoUrl: player.photo_url })),
    staff: staff.map((member) => ({ id: member.id, displayName: member.display_name, role: member.role, roleLabel: member.custom_role_label })) };
}

export async function buildGamePackagePreview(organizationId: string, gameId: string) {
  const { game, defaults, override, effective } = await effectiveGameSettings(organizationId, gameId); const database = await db();
  const teams = [await teamSnapshot(database, game, "HOME"), await teamSnapshot(database, game, "AWAY")];
  for (const team of teams) if (team.players.length < Math.max(effective.min_players, effective.starting_players)) throw new KomoControlAdminError(`${team.name}: δεν υπάρχουν αρκετοί διαθέσιμοι παίκτες για τις ρυθμίσεις KomoControl.`, 409);
  const snapshot: GamePackageV1 = { schemaVersion: 1, game: { id: game.id, organizationId, competitionId: game.competition_id, competitionName: game.competition_name, seasonName: game.season_name, phaseName: game.phase_name, roundLabel: game.round_label, scheduledDate: game.scheduled_date, scheduledTime: game.scheduled_time, scheduledAt: game.scheduled_at, venue: game.venue }, settings: effective, teams };
  const hash = await snapshotHash(snapshot);
  const packages = (await database.prepare("SELECT id, package_version, status, snapshot_hash, published_at, generated_at, superseded_at FROM league_komocontrol_game_packages WHERE game_id=? ORDER BY package_version DESC").bind(gameId).all<Record<string, unknown>>()).results ?? [];
  return { snapshot, hash, defaults, override, effective, current: packages.find((row) => row.status === "published") ?? null, history: packages, changed: hash !== packages.find((row) => row.status === "published")?.snapshot_hash };
}

export async function listKomoControlGames(organizationId: string, fromDate: string, toDate: string, competitionId?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) throw new KomoControlAdminError("Συμπληρώστε έγκυρες ημερομηνίες.");
  if (fromDate > toDate) throw new KomoControlAdminError("Η ημερομηνία «Από» πρέπει να είναι πριν ή ίδια με την ημερομηνία «Έως».");
  const database = await db();
  if (competitionId) {
    const competition = await database.prepare(`SELECT c.id FROM league_competitions c JOIN league_seasons s ON s.id=c.season_id
      WHERE c.id=? AND c.organization_id=? AND s.status<>'completed' AND c.status<>'completed'`).bind(competitionId, organizationId).first();
    if (!competition) throw new KomoControlAdminError("Η Διοργάνωση δεν είναι διαθέσιμη για KomoControl.", 404);
  }
  const competitionClause = competitionId ? " AND c.id=?" : "";
  const bindings = competitionId ? [organizationId, fromDate, toDate, competitionId] : [organizationId, fromDate, toDate];
  return (await database.prepare(`SELECT g.id, g.scheduled_date, g.scheduled_time, g.status, g.round_label, c.name AS competition_name, p.name AS phase_name,
    COALESCE(NULLIF(TRIM((SELECT st.display_name FROM league_competition_teams ct JOIN league_season_teams st ON st.id=ct.season_team_id WHERE ct.competition_id=g.competition_id AND ct.status='active' AND st.team_id=g.home_team_id ORDER BY ct.id LIMIT 1)), ''), home.name) AS home_team_name,
    COALESCE(NULLIF(TRIM((SELECT st.display_name FROM league_competition_teams ct JOIN league_season_teams st ON st.id=ct.season_team_id WHERE ct.competition_id=g.competition_id AND ct.status='active' AND st.team_id=g.away_team_id ORDER BY ct.id LIMIT 1)), ''), away.name) AS away_team_name,
    pkg.package_version, pkg.published_at
    FROM league_games g JOIN league_competitions c ON c.id=g.competition_id JOIN league_seasons s ON s.id=c.season_id
    LEFT JOIN league_phases p ON p.id=g.phase_id JOIN league_teams home ON home.id=g.home_team_id JOIN league_teams away ON away.id=g.away_team_id
    LEFT JOIN league_komocontrol_game_packages pkg ON pkg.game_id=g.id AND pkg.status='published'
    WHERE c.organization_id=? AND s.status<>'completed' AND c.status<>'completed' AND g.status IN ('scheduled','postponed') AND g.scheduled_date>=? AND g.scheduled_date<=? AND g.scheduled_time IS NOT NULL AND TRIM(g.scheduled_time)<>''${competitionClause}
    ORDER BY g.scheduled_date ASC, g.scheduled_time ASC, g.id ASC`).bind(...bindings).all()).results;
}

export async function saveGameOverride(organizationId: string, input: Record<string, unknown>) {
  const gameId = requiredText(input.gameId, "Αγώνας"); const { effective } = await effectiveGameSettings(organizationId, gameId); const database = await db();
  if (input.clear === true) { await database.prepare("DELETE FROM league_game_komocontrol_overrides WHERE game_id=?").bind(gameId).run(); return { cleared: true }; }
  const values = settingsInput({ ...effective, ...input });
  await database.prepare(`INSERT INTO league_game_komocontrol_overrides (game_id, game_mode, min_players, max_players, starting_players, regulation_periods, regulation_period_seconds, overtime_seconds, tie_allowed, winner_required)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET game_mode=excluded.game_mode,min_players=excluded.min_players,max_players=excluded.max_players,starting_players=excluded.starting_players,regulation_periods=excluded.regulation_periods,regulation_period_seconds=excluded.regulation_period_seconds,overtime_seconds=excluded.overtime_seconds,tie_allowed=excluded.tie_allowed,winner_required=excluded.winner_required,updated_at=CURRENT_TIMESTAMP`).bind(gameId, values.game_mode, values.min_players, values.max_players, values.starting_players, values.regulation_periods, values.regulation_period_seconds, values.overtime_seconds, values.tie_allowed, values.winner_required).run();
  return { cleared: false };
}

export async function publishGamePackage(organizationId: string, gameId: string, publisherId: string) {
  await gameForOrganization(organizationId, gameId);
  const database = await db(); const activeRun = await database.prepare("SELECT id FROM league_komocontrol_game_runs WHERE game_id=? AND status='active' LIMIT 1").bind(gameId).first();
  if (activeRun) throw new KomoControlAdminError("Υπάρχει ενεργό Game Run για αυτόν τον αγώνα.", 409);
  const preview = await buildGamePackagePreview(organizationId, gameId); const current = preview.current;
  if (current && current.snapshot_hash === preview.hash) return { published: false, message: "Δεν υπάρχουν αλλαγές προς κοινοποίηση.", current };
  const nextVersion = Number((await database.prepare("SELECT COALESCE(MAX(package_version),0)+1 AS version FROM league_komocontrol_game_packages WHERE game_id=?").bind(gameId).first<{ version: number }>())?.version ?? 1);
  const packageId = id("komocontrol_package"); const statements = [];
  if (current) statements.push(database.prepare("UPDATE league_komocontrol_game_packages SET status='superseded', superseded_at=CURRENT_TIMESTAMP WHERE id=? AND status='published'").bind(current.id));
  statements.push(database.prepare("INSERT INTO league_komocontrol_game_packages (id,game_id,organization_id,package_version,status,snapshot_json,snapshot_hash,published_by_user_id) VALUES (?,?,?,?,'published',?,?,?)").bind(packageId, gameId, organizationId, nextVersion, deterministicJson(preview.snapshot), preview.hash, publisherId));
  await database.batch(statements);
  return { published: true, packageId, packageVersion: nextVersion };
}

export async function publishGamePackages(organizationId: string, gameIds: unknown[], publisherId: string) {
  const uniqueGameIds = [...new Set(gameIds.map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (uniqueGameIds.length === 0) throw new KomoControlAdminError("Επιλέξτε τουλάχιστον έναν αγώνα.");
  const results = await Promise.all(uniqueGameIds.map(async (gameId) => {
    let label = "Αγώνας";
    try {
      const game = await gameForOrganization(organizationId, gameId);
      label = `${game.home_team_name} — ${game.away_team_name}`;
      const result = await publishGamePackage(organizationId, gameId, publisherId);
      return {
        gameId,
        label,
        outcome: result.published ? "published" as const : "unchanged" as const,
        packageVersion: result.published ? result.packageVersion : Number(result.current?.package_version ?? 0),
        reason: result.published ? null : result.message,
      };
    } catch (error) {
      return {
        gameId,
        label,
        outcome: "failed" as const,
        packageVersion: null,
        reason: error instanceof KomoControlAdminError ? error.message : "Η κοινοποίηση του αγώνα απέτυχε.",
      };
    }
  }));
  return {
    results,
    published: results.filter((result) => result.outcome === "published").length,
    unchanged: results.filter((result) => result.outcome === "unchanged").length,
    failed: results.filter((result) => result.outcome === "failed").length,
  };
}
