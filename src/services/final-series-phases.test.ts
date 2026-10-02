import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));

import {
  getCompetitiveSeriesSourceMatchupIds,
  isCanonicalFinalSeriesSibling,
} from "@/lib/final-series-phase";
import { createFinalSeriesPhasesWithDb } from "./league-admin.service";

type TestStatement = D1PreparedStatement & { run(): Promise<unknown> };

function createD1(sqlite: DatabaseSync, onBatch: () => void): D1DatabaseBinding {
  const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => {
    const prepared = {
      bind: (...bindings: unknown[]) => statement(sql, bindings),
      first: async <T,>() => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
      all: async <T,>() => ({ success: true, results: sqlite.prepare(sql).all(...values) as T[] }),
      run: async () => {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return prepared as unknown as D1PreparedStatement;
  };

  return {
    prepare: statement,
    batch: async (statements: D1PreparedStatement[]) => {
      onBatch();
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const pending of statements) results.push(await (pending as TestStatement).run());
        sqlite.exec("COMMIT");
        return results as never;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1DatabaseBinding;
}

const sourceSettings = (withBye = false) => JSON.stringify({
  bracketConfiguration: {
    method: "manual",
    participantCount: 4,
    matchups: [
      {
        id: "sf-1",
        slotA: { id: "sf-1-a", type: "manual", teamId: "team-a" },
        slotB: withBye
          ? { id: "sf-1-b", type: "bye" }
          : { id: "sf-1-b", type: "manual", teamId: "team-b" },
      },
      {
        id: "sf-2",
        slotA: { id: "sf-2-a", type: "manual", teamId: "team-c" },
        slotB: { id: "sf-2-b", type: "manual", teamId: "team-d" },
      },
    ],
  },
});

describe("atomic Final and optional Small Final creation", () => {
  let sqlite: DatabaseSync;
  let db: D1DatabaseBinding;
  let batchCalls: number;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys=ON");
    sqlite.exec(`
      CREATE TABLE league_competitions (id TEXT PRIMARY KEY);
      CREATE TABLE league_phases (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL REFERENCES league_competitions(id),
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        phase_type TEXT,
        format TEXT,
        order_index INTEGER,
        phase_order INTEGER,
        previous_phase_id TEXT REFERENCES league_phases(id),
        tournament_name TEXT,
        UNIQUE(competition_id, slug)
      );
      CREATE TABLE league_phase_rules (
        phase_id TEXT PRIMARY KEY REFERENCES league_phases(id) ON DELETE CASCADE,
        phase_kind TEXT NOT NULL,
        bracket_size INTEGER,
        best_of INTEGER,
        wins_required INTEGER,
        carry_over_enabled INTEGER NOT NULL DEFAULT 0,
        carry_over_source_phase_id TEXT,
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE league_audit_log (
        id TEXT PRIMARY KEY,
        actor_email TEXT,
        action TEXT,
        entity_type TEXT,
        entity_id TEXT,
        details_json TEXT,
        created_at TEXT
      );
      INSERT INTO league_competitions (id) VALUES ('competition');
      INSERT INTO league_phases
        (id,competition_id,name,slug,phase_type,format,order_index,phase_order)
        VALUES ('semifinals','competition','Ημιτελικά','semifinals','play_in','series',1,1);
    `);
    sqlite.prepare(`INSERT INTO league_phase_rules
      (phase_id,phase_kind,bracket_size,settings_json)
      VALUES ('semifinals','play_in',4,?)`).run(sourceSettings());
    batchCalls = 0;
    db = createD1(sqlite, () => { batchCalls += 1; });
  });

  it("creates only the canonical winner Final when the option is off", async () => {
    const result = await createFinalSeriesPhasesWithDb(db, {
      competitionId: "competition",
      previousPhaseId: "semifinals",
      format: "series",
      name: "ΤΕΛΙΚΟΣ",
      createSmallFinal: false,
    }, "admin@example.test");

    expect(result.smallFinalPhaseId).toBeNull();
    expect(batchCalls).toBe(1);
    const siblings = sqlite.prepare(`SELECT p.*, pr.settings_json AS rule_settings_json
      FROM league_phases p JOIN league_phase_rules pr ON pr.phase_id=p.id
      WHERE p.previous_phase_id='semifinals'`).all() as Record<string, unknown>[];
    expect(siblings).toHaveLength(1);
    expect(isCanonicalFinalSeriesSibling(siblings[0], "semifinals", ["sf-1", "sf-2"], "final")).toBe(true);
    expect(String(siblings[0].rule_settings_json)).not.toContain("team-a");
  });

  it("creates Final and Small Final as one atomic sibling batch", async () => {
    const result = await createFinalSeriesPhasesWithDb(db, {
      competitionId: "competition",
      previousPhaseId: "semifinals",
      format: "series",
      name: "ΤΕΛΙΚΟΣ",
      createSmallFinal: true,
    }, "admin@example.test");

    expect(result.createdPhaseIds).toHaveLength(2);
    expect(batchCalls).toBe(1);
    const siblings = sqlite.prepare(`SELECT p.*, pr.settings_json AS rule_settings_json
      FROM league_phases p JOIN league_phase_rules pr ON pr.phase_id=p.id
      WHERE p.previous_phase_id='semifinals' ORDER BY p.phase_order`).all() as Record<string, unknown>[];
    expect(siblings).toHaveLength(2);
    expect(isCanonicalFinalSeriesSibling(siblings[0], "semifinals", ["sf-1", "sf-2"], "final")).toBe(true);
    expect(isCanonicalFinalSeriesSibling(siblings[1], "semifinals", ["sf-1", "sf-2"], "small_final")).toBe(true);
    expect(String(siblings[1].rule_settings_json)).toContain("matchup_loser");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM league_audit_log").get()).toEqual({ count: 2 });
  });

  it("rejects canonical duplicates without creating another sibling", async () => {
    const input = {
      competitionId: "competition",
      previousPhaseId: "semifinals",
      format: "series",
      name: "ΤΕΛΙΚΟΣ",
      createSmallFinal: true,
    };
    await createFinalSeriesPhasesWithDb(db, input, "admin@example.test");
    await expect(createFinalSeriesPhasesWithDb(db, input, "admin@example.test"))
      .rejects.toThrow("Υπάρχει ήδη Τελικός");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM league_phases WHERE previous_phase_id='semifinals'").get())
      .toEqual({ count: 2 });
  });

  it("rejects a Small Final source containing a BYE and never invents a loser", async () => {
    sqlite.prepare("UPDATE league_phase_rules SET settings_json=? WHERE phase_id='semifinals'").run(sourceSettings(true));
    const source = sqlite.prepare(`SELECT p.*, pr.settings_json AS rule_settings_json
      FROM league_phases p JOIN league_phase_rules pr ON pr.phase_id=p.id WHERE p.id='semifinals'`).get() as Record<string, unknown>;
    expect(getCompetitiveSeriesSourceMatchupIds(source)).toBeNull();
    await expect(createFinalSeriesPhasesWithDb(db, {
      competitionId: "competition",
      previousPhaseId: "semifinals",
      format: "series",
      name: "ΤΕΛΙΚΟΣ",
      createSmallFinal: true,
    }, "admin@example.test")).rejects.toThrow("χωρίς BYE");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM league_phases WHERE previous_phase_id='semifinals'").get())
      .toEqual({ count: 0 });
  });
});
