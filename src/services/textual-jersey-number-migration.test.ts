import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type LocalDatabase = {
  exec(sql: string): void;
  prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
  close(): void;
};

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => LocalDatabase };
const migration = readFileSync(new URL("../../cloudflare/migrations/0040_textual_jersey_numbers.sql", import.meta.url), "utf8");

describe("0040 textual jersey-number migration", () => {
  it("preserves legacy values and stores 00 as distinct TEXT", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE league_seasons(id TEXT PRIMARY KEY);
        CREATE TABLE league_competitions(id TEXT PRIMARY KEY);
        CREATE TABLE league_players(id TEXT PRIMARY KEY);
        CREATE TABLE league_teams(id TEXT PRIMARY KEY);
        INSERT INTO league_seasons VALUES ('s');
        INSERT INTO league_competitions VALUES ('c');
        INSERT INTO league_teams VALUES ('t');
        CREATE TABLE league_roster_memberships (
          id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
          competition_id TEXT REFERENCES league_competitions(id) ON DELETE SET NULL,
          player_id TEXT NOT NULL REFERENCES league_players(id), team_id TEXT NOT NULL REFERENCES league_teams(id),
          shirt_number INTEGER, joined_on TEXT, left_on TEXT, status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','departed','transferred')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_rosters_player ON league_roster_memberships(player_id, season_id);
        CREATE INDEX idx_rosters_team ON league_roster_memberships(team_id, season_id);
      `);
      for (const id of ["null", "zero", "seven", "twenty-three", "ninety-nine", "double-zero"]) {
        db.prepare("INSERT INTO league_players VALUES (?)").run(id);
      }
      db.prepare("INSERT INTO league_roster_memberships(id,season_id,competition_id,player_id,team_id,shirt_number) VALUES (?,?,?,?,?,?)").run("r-null", "s", "c", "null", "t", null);
      db.prepare("INSERT INTO league_roster_memberships(id,season_id,competition_id,player_id,team_id,shirt_number) VALUES (?,?,?,?,?,?)").run("r-0", "s", "c", "zero", "t", 0);
      db.prepare("INSERT INTO league_roster_memberships(id,season_id,competition_id,player_id,team_id,shirt_number) VALUES (?,?,?,?,?,?)").run("r-7", "s", "c", "seven", "t", 7);
      db.prepare("INSERT INTO league_roster_memberships(id,season_id,competition_id,player_id,team_id,shirt_number) VALUES (?,?,?,?,?,?)").run("r-23", "s", "c", "twenty-three", "t", 23);
      db.prepare("INSERT INTO league_roster_memberships(id,season_id,competition_id,player_id,team_id,shirt_number) VALUES (?,?,?,?,?,?)").run("r-99", "s", "c", "ninety-nine", "t", 99);

      db.exec(migration);

      const column = (db.prepare("PRAGMA table_info(league_roster_memberships)").all() as Array<{ name: string; type: string }>).find((item) => item.name === "shirt_number");
      expect(column?.type).toBe("TEXT");
      expect(db.prepare("SELECT shirt_number, typeof(shirt_number) AS storage_type FROM league_roster_memberships ORDER BY id").all()).toEqual([
        { shirt_number: "0", storage_type: "text" },
        { shirt_number: "23", storage_type: "text" },
        { shirt_number: "7", storage_type: "text" },
        { shirt_number: "99", storage_type: "text" },
        { shirt_number: null, storage_type: "null" },
      ]);
      db.prepare("INSERT INTO league_roster_memberships(id,season_id,competition_id,player_id,team_id,shirt_number) VALUES (?,?,?,?,?,?)").run("r-00", "s", "c", "double-zero", "t", "00");
      expect(db.prepare("SELECT shirt_number, typeof(shirt_number) AS storage_type FROM league_roster_memberships WHERE id='r-00'").get()).toEqual({ shirt_number: "00", storage_type: "text" });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
