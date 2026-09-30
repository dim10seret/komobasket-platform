import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertCompetitionCompletionAllowed,
  assertPhaseLineageMutationAllowed,
} from "./league-admin.service";

const schema = readFileSync(new URL("../../cloudflare/league-schema.sql", import.meta.url), "utf8");
const phaseSchedules = readFileSync(new URL("../../cloudflare/migrations/0007_c5_phase_schedules_foundation.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../cloudflare/migrations/0038_phase_tournament_name.sql", import.meta.url), "utf8");

function d1Database(sqlite: DatabaseSync) {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all(...bindings) as T[] };
        },
        async run() {
          const result = sqlite.prepare(query).run(...bindings);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
}

function insertPhase(sqlite: DatabaseSync, id: string, previousPhaseId: string | null, lifecycle: "active" | "finalized", order: number) {
  sqlite.prepare(`INSERT INTO league_phases
    (id,competition_id,name,slug,format,phase_order,order_index,previous_phase_id,lifecycle_status,finalized_at)
    VALUES (?, 'competition', ?, ?, 'standings', ?, ?, ?, ?, ?)`)
    .run(id, id, id, order, order, previousPhaseId, lifecycle, lifecycle === "finalized" ? "2026-09-29T00:00:00.000Z" : null);
}

describe("root Tournament identity server guards", () => {
  let sqlite: DatabaseSync;
  let db: ReturnType<typeof d1Database>;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys=ON");
    sqlite.exec(schema);
    sqlite.exec(phaseSchedules);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS league_phase_rules (
        phase_id TEXT PRIMARY KEY REFERENCES league_phases(id) ON DELETE CASCADE,
        phase_kind TEXT NOT NULL DEFAULT 'custom',
        bracket_size INTEGER,
        best_of INTEGER,
        wins_required INTEGER,
        carry_over_enabled INTEGER NOT NULL DEFAULT 0,
        carry_over_source_phase_id TEXT REFERENCES league_phases(id) ON DELETE SET NULL,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    sqlite.exec(`
      INSERT INTO league_organizations (id,slug,name,status,publication_status)
      VALUES ('organization','organization','Organization','active','published');
      INSERT INTO league_seasons (id,name,slug,status) VALUES ('season','2026-27','2026-27','active');
      INSERT INTO league_competitions (id,organization_id,season_id,name,slug,type,status)
      VALUES ('competition','organization','season','Competition','competition','league','active');
    `);
    db = d1Database(sqlite);
  });

  it("adds only the nullable tournament_name column in migration 0038", () => {
    const legacy = new DatabaseSync(":memory:");
    legacy.exec("CREATE TABLE league_phases (id TEXT PRIMARY KEY, previous_phase_id TEXT)");
    legacy.exec(migration);
    expect(legacy.prepare("PRAGMA table_info(league_phases)").all().map((row) => row.name)).toContain("tournament_name");
    legacy.close();
  });

  it.each([
    ["one root fully finalized", [["root", null, "finalized", 1]], true],
    ["one root with active descendant", [["root", null, "finalized", 1], ["child", "root", "active", 2]], false],
    ["two finalized roots", [["league", null, "finalized", 1], ["cup", null, "finalized", 2]], true],
    ["finished League and active Cup", [["league", null, "finalized", 1], ["cup", null, "active", 2]], false],
    ["finalized root but active descendant", [["root", null, "finalized", 1], ["final", "root", "active", 2]], false],
  ] as const)("enforces completion for %s", async (_label, phases, allowed) => {
    for (const [id, previous, lifecycle, order] of phases) insertPhase(sqlite, id, previous, lifecycle, order);
    const attempt = assertCompetitionCompletionAllowed(db as never, "competition", "complete");
    if (allowed) await expect(attempt).resolves.toBeUndefined();
    else await expect(attempt).rejects.toThrow("μη οριστικοποιημένες φάσεις");
    expect(sqlite.prepare("SELECT id,lifecycle_status FROM league_phases ORDER BY id").all())
      .toEqual(phases.map(([id, , lifecycle]) => ({ id, lifecycle_status: lifecycle })).sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("preserves the zero-phase completion contract", async () => {
    await expect(assertCompetitionCompletionAllowed(db as never, "competition", "complete")).resolves.toBeUndefined();
  });

  it("allows an unused leaf move and locks every canonical lineage usage", async () => {
    insertPhase(sqlite, "unused", null, "active", 1);
    await expect(assertPhaseLineageMutationAllowed(db as never, {
      phaseId: "unused",
      currentCompetitionId: "competition",
      nextCompetitionId: "competition",
      currentPreviousPhaseId: null,
      nextPreviousPhaseId: "other",
    })).resolves.toBeUndefined();

    insertPhase(sqlite, "downstream-source", null, "active", 2);
    insertPhase(sqlite, "downstream-child", "downstream-source", "active", 3);
    insertPhase(sqlite, "schedule-source", null, "active", 4);
    insertPhase(sqlite, "game-source", null, "active", 5);
    insertPhase(sqlite, "finalized-source", null, "finalized", 6);
    insertPhase(sqlite, "carry-source", null, "active", 7);
    insertPhase(sqlite, "participant-source", null, "active", 8);
    insertPhase(sqlite, "mvp-source", null, "active", 9);
    insertPhase(sqlite, "dependency-target", null, "active", 10);
    insertPhase(sqlite, "game-holder", null, "active", 11);
    sqlite.exec(`
      INSERT INTO league_teams (id,organization_id,name,slug) VALUES
        ('home','organization','Home','home'),
        ('away','organization','Away','away');
      INSERT INTO league_players (id,organization_id,slug,display_name,normalized_name)
        VALUES ('player','organization','player','Player','player');
      INSERT INTO league_phase_schedules (id,competition_id,phase_id,lifecycle_status)
        VALUES ('schedule','competition','schedule-source','draft');
      INSERT INTO league_games (id,competition_id,phase_id,home_team_id,away_team_id,status)
        VALUES
          ('game-in-source','competition','game-source','home','away','scheduled'),
          ('game-for-mvp','competition','game-holder','home','away','completed');
      INSERT INTO league_matchday_mvp_selections
        (id,organization_id,competition_id,phase_id,round_number,game_id,player_id)
        VALUES ('mvp','organization','competition','mvp-source',1,'game-for-mvp','player');
    `);
    sqlite.prepare(`INSERT INTO league_phase_rules
      (phase_id,phase_kind,carry_over_enabled,carry_over_source_phase_id,settings_json)
      VALUES ('dependency-target','regular_season',1,'carry-source',?)`)
      .run(JSON.stringify({ participantConfiguration: { participantSourcePhaseId: "participant-source" } }));

    for (const phaseId of [
      "downstream-source",
      "schedule-source",
      "game-source",
      "finalized-source",
      "carry-source",
      "participant-source",
      "mvp-source",
    ]) {
      await expect(assertPhaseLineageMutationAllowed(db as never, {
        phaseId,
        currentCompetitionId: "competition",
        nextCompetitionId: "competition",
        currentPreviousPhaseId: null,
        nextPreviousPhaseId: "unused",
      })).rejects.toThrow("έχει ήδη χρησιμοποιηθεί");
    }
  });
});
