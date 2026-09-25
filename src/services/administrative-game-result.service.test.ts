import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
const environment = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: async () => environment.current }));

import { getPublicCompetitionContextForOrganizationWithDb } from "./public-competition.service";
import { platformLeagueResources } from "./platform-league-resources";

type LocalDatabase = { exec(sql: string): void; prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): { changes: number | bigint } }; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => LocalDatabase };
const schema = readFileSync(new URL("../../cloudflare/league-schema.sql", import.meta.url), "utf8");
const platformFoundation = readFileSync(new URL("../../cloudflare/migrations/0001_platform_foundation.sql", import.meta.url), "utf8");
const phaseSchedules = readFileSync(new URL("../../cloudflare/migrations/0007_c5_phase_schedules_foundation.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../cloudflare/migrations/0036_administrative_game_results.sql", import.meta.url), "utf8");

let local: LocalDatabase;
let db: D1DatabaseBinding;
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...args) => statement(sql, args),
    first: async <T,>() => (local.prepare(sql).get(...values) ?? null) as T | null,
    all: async <T,>() => ({ success: true, results: local.prepare(sql).all(...values) as T[] }),
    run: async () => { const result = local.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
  };
}

const actor = { userId: "super-admin", email: "admin@example.test", displayName: null, isSuperAdmin: true, isLocal: false } as const;
async function patch(body: Record<string, unknown>) {
  return platformLeagueResources(actor).PATCH(new Request("https://example.test/api/admin/league/games", {
    method: "PATCH", headers: { origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ resource: "games" }) });
}

beforeEach(() => {
  local = new DatabaseSync(":memory:");
  local.exec(schema);
  for (const definition of platformFoundation.matchAll(/CREATE TABLE IF NOT EXISTS[\s\S]*?;\s*(?:\r?\n|$)/g)) {
    local.exec(definition[0]);
  }
  local.exec(phaseSchedules);
  local.exec(`
    INSERT INTO league_app_users(id,email,normalized_email,status,is_super_admin) VALUES ('super-admin','admin@example.test','admin@example.test','active',1);
    INSERT INTO league_organizations(id,slug,name,publication_status) VALUES ('org-a','org-a','Organization A','published');
    INSERT INTO league_seasons(id,name,slug,starts_on,status) VALUES ('season-a','2026-27','2026-27','2026-09-01','active');
    INSERT INTO league_competitions(id,organization_id,season_id,name,slug,status) VALUES ('competition-a','org-a','season-a','Competition A','competition-a','active');
    INSERT INTO league_teams(id,organization_id,name,slug) VALUES ('home','org-a','Home','home'),('away','org-a','Away','away');
    INSERT INTO league_season_teams(id,season_id,team_id,display_name) VALUES ('st-home','season-a','home','Home'),('st-away','season-a','away','Away');
    INSERT INTO league_competition_teams(id,competition_id,season_team_id,status) VALUES ('ct-home','competition-a','st-home','active'),('ct-away','competition-a','st-away','active');
    INSERT INTO league_phases(id,competition_id,name,slug,format,phase_type,phase_order,lifecycle_status) VALUES
      ('phase-a','competition-a','Regular','regular','standings','regular',1,'active'),
      ('phase-manual','competition-a','Manual','manual','standings','regular',2,'active');
    INSERT INTO league_phase_rules(phase_id,phase_kind,settings_json) VALUES
      ('phase-a','regular_season','{"participantConfiguration":{"participantSourceType":"competition_participants"},"pointsForWin":2,"pointsForLoss":1}'),
      ('phase-manual','regular_season','{"participantConfiguration":{"participantSourceType":"competition_participants"},"pointsForWin":2,"pointsForLoss":1}');
    INSERT INTO league_games(id,competition_id,phase_id,round_number,game_order,round_label,home_team_id,away_team_id,home_score,away_score,status,result_source)
      VALUES ('game-completed','competition-a','phase-a',1,1,'1η','home','away',80,70,'completed','match_report'),
             ('game-interrupted','competition-a','phase-a',2,1,'2η','home','away',NULL,NULL,'scheduled',NULL),
             ('game-manual','competition-a','phase-manual',1,1,'1η','home','away',72,68,'completed','manual');
  `);
  db = {
    prepare: (sql) => statement(sql),
    batch: async (items) => {
      local.exec("BEGIN");
      try { const results = []; for (const item of items) results.push(await item.run()); local.exec("COMMIT"); return results; }
      catch (error) { local.exec("ROLLBACK"); throw error; }
    },
  };
  environment.current = { NEWS_DB: db };
});
afterEach(() => local.close());

describe("Administrative Game Result v1", () => {
  it("keeps migration 0036 additive, unique per game and foreign-key clean", () => {
    local.exec(migration);
    expect(local.prepare("PRAGMA index_list('league_game_administrative_results')").all().length).toBeGreaterThanOrEqual(2);
    expect(local.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("round-trips admin API to effective public result and standings without rewriting gameplay score", async () => {
    const response = await patch({ id: "game-completed", competitionId: "competition-a", action: "administrative-result", decisionType: "correction", homeScore: 60, awayScore: 75, homeStandingsPointsOverride: 0, awayStandingsPointsOverride: 3, reason: "Διοικητική διόρθωση" });
    expect(response.status).toBe(200);
    expect(local.prepare("SELECT home_score,away_score,status,result_source FROM league_games WHERE id='game-completed'").get()).toEqual({ home_score: 80, away_score: 70, status: "completed", result_source: "match_report" });
    const context = await getPublicCompetitionContextForOrganizationWithDb(db, "org-a", { competitionSlug: "competition-a", phaseSlug: "regular" });
    expect(context.games.find((game) => game.id === "game-completed")).toMatchObject({ homeScore: 60, awayScore: 75, publicStatus: "completed", finalizedStatisticsAvailable: false });
    expect(context.standings.find((row) => row.team.id === "home")).toMatchObject({ wins: 0, losses: 1, standingsPoints: 0, pointsFor: 60, pointsAgainst: 75 });
    expect(context.standings.find((row) => row.team.id === "away")).toMatchObject({ wins: 1, losses: 0, standingsPoints: 3, pointsFor: 75, pointsAgainst: 60 });
  });

  it("corrects a completed manual game while preserving its recorded result and auditing before/after", async () => {
    const response = await patch({ id: "game-manual", competitionId: "competition-a", action: "administrative-result", decisionType: "correction", homeScore: 69, awayScore: 74, reason: "Διόρθωση φύλλου" });
    expect(response.status).toBe(200);
    expect(local.prepare("SELECT home_score,away_score,status,result_source FROM league_games WHERE id='game-manual'").get()).toEqual({ home_score: 72, away_score: 68, status: "completed", result_source: "manual" });
    const audit = local.prepare("SELECT details_json FROM league_audit_log WHERE action='administrative_official_result' AND entity_id='game-manual'").get() as { details_json: string };
    expect(JSON.parse(audit.details_json)).toMatchObject({
      before: null,
      after: { decisionType: "correction", homeScore: 69, awayScore: 74 },
      recordedResult: { homeScore: 72, awayScore: 68, status: "completed", resultSource: "manual" },
    });
  });

  it("closes an interrupted game without finalization and permits a later administrative correction", async () => {
    const response = await patch({ id: "game-interrupted", competitionId: "competition-a", action: "administrative-result", decisionType: "interruption", homeScore: 41, awayScore: 39, reason: "Μόνιμη διακοπή" });
    expect(response.status).toBe(200);
    expect(local.prepare("SELECT status,home_score,away_score FROM league_games WHERE id='game-interrupted'").get()).toEqual({ status: "scheduled", home_score: null, away_score: null });
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_komocontrol_match_finalizations_v1").get()).toEqual({ count: 0 });
    const context = await getPublicCompetitionContextForOrganizationWithDb(db, "org-a", { competitionSlug: "competition-a", phaseSlug: "regular" });
    expect(context.games.find((game) => game.id === "game-interrupted")).toMatchObject({ homeScore: 41, awayScore: 39, publicStatus: "completed" });
    const first = local.prepare("SELECT updated_at FROM league_game_administrative_results WHERE game_id='game-interrupted'").get() as { updated_at: string };
    expect((await patch({ id: "game-interrupted", competitionId: "competition-a", action: "administrative-result", decisionType: "correction", homeScore: 40, awayScore: 42, reason: "Τελική διοικητική διόρθωση", expectedAdministrativeUpdatedAt: first.updated_at })).status).toBe(200);
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_game_administrative_results WHERE game_id='game-interrupted'").get()).toEqual({ count: 1 });
    expect(local.prepare("SELECT decision_type,official_home_score,official_away_score FROM league_game_administrative_results WHERE game_id='game-interrupted'").get()).toEqual({ decision_type: "correction", official_home_score: 40, official_away_score: 42 });
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_komocontrol_match_finalizations_v1").get()).toEqual({ count: 0 });
  });

  it("allows correction in a finalized phase and updates the one existing decision", async () => {
    local.exec("UPDATE league_phases SET lifecycle_status='finalized',finalized_at='2026-09-24T10:00:00Z' WHERE id='phase-a'");
    expect((await patch({ id: "game-completed", competitionId: "competition-a", action: "administrative-result", decisionType: "correction", homeScore: 81, awayScore: 79, reason: "Πρώτη απόφαση" })).status).toBe(200);
    const first = local.prepare("SELECT updated_at FROM league_game_administrative_results WHERE game_id='game-completed'").get() as { updated_at: string };
    expect((await patch({ id: "game-completed", competitionId: "competition-a", action: "administrative-result", decisionType: "correction", homeScore: 82, awayScore: 79, reason: "Νεότερη απόφαση", expectedAdministrativeUpdatedAt: first.updated_at })).status).toBe(200);
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_game_administrative_results WHERE game_id='game-completed'").get()).toEqual({ count: 1 });
    expect(local.prepare("SELECT official_home_score,reason FROM league_game_administrative_results WHERE game_id='game-completed'").get()).toEqual({ official_home_score: 82, reason: "Νεότερη απόφαση" });
  });

  it("preserves administrative precedence after a later canonical sync result update", async () => {
    expect((await patch({ id: "game-completed", competitionId: "competition-a", action: "administrative-result", decisionType: "correction", homeScore: 55, awayScore: 50, reason: "Διοικητική απόφαση" })).status).toBe(200);
    local.exec("UPDATE league_games SET home_score=90,away_score=91,status='completed',result_source='match_report' WHERE id='game-completed'");
    const context = await getPublicCompetitionContextForOrganizationWithDb(db, "org-a", { competitionSlug: "competition-a", phaseSlug: "regular" });
    expect(context.games.find((game) => game.id === "game-completed")).toMatchObject({ homeScore: 55, awayScore: 50 });
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_game_administrative_results WHERE game_id='game-completed'").get()).toEqual({ count: 1 });
  });
});

describe("administrative result repeat-edit source contract", () => {
  it("keeps one-row updates and advances the optimistic concurrency version", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./administrative-game-result.service.ts", import.meta.url), "utf8");

    expect(source).toContain("const id = String(existing?.id ?? entityId(\"administrative_result\"))");
    expect(source).toContain("nextAdministrativeResultUpdatedAt(existing?.updated_at)");
    expect(source).toContain("Math.max(now, existing + 1)");
    expect(source).toContain("UPDATE league_game_administrative_results");
    expect(source).toMatch(
      /WHERE\s+game_id\s*=\s*\?\s+AND\s+organization_id\s*=\s*\?\s+AND\s+updated_at\s*=\s*\?/,
    );
    expect(source).toContain("administrative_official_result");
  });
});
