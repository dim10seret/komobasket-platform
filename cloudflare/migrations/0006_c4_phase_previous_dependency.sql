-- C4 canonical phase dependency

PRAGMA foreign_keys = ON;

ALTER TABLE league_phases
  ADD COLUMN previous_phase_id TEXT REFERENCES league_phases(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_league_phases_competition_previous_phase
  ON league_phases(competition_id, previous_phase_id);

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0006', 'c4_phase_previous_dependency');
