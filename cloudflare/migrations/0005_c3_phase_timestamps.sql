-- C3 phase timestamp alignment

PRAGMA foreign_keys = ON;

ALTER TABLE league_phases
  ADD COLUMN created_at TEXT;

ALTER TABLE league_phases
  ADD COLUMN updated_at TEXT;

UPDATE league_phases
  SET created_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE created_at IS NULL
     OR updated_at IS NULL;

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0005', 'c3_phase_timestamps');
