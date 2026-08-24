import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

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
  const normalized = username.normalize("NFKC").trim().toLowerCase();
  if (!normalized) throw new KomoControlAdminError("Το Username είναι υποχρεωτικό.");
  return { username, normalized };
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

export async function hashScorerPassword(value: unknown) {
  const password = requiredText(value, "Password");
  if (password.length < 8) throw new KomoControlAdminError("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 600000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2-sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
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
  if (result.tie_allowed && result.winner_required) throw new KomoControlAdminError("Δεν μπορεί να επιτρέπεται ισοπαλία όταν απαιτείται νικητής.");
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
  let settings: Record<string, unknown> | null = null;
  if (competitionId) {
    await requireCompetition(organizationId, competitionId);
    settings = await database.prepare("SELECT * FROM league_competition_komocontrol_defaults WHERE competition_id=?").bind(competitionId).first<Record<string, unknown>>() ?? null;
  }
  return { competitions: competitions.results, settings, defaults: DEFAULTS };
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
