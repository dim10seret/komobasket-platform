-- C2 phase foundation columns

PRAGMA foreign_keys = ON;

ALTER TABLE league_phases
  ADD COLUMN phase_order INTEGER;

ALTER TABLE league_phases
  ADD COLUMN format TEXT NOT NULL DEFAULT 'standings'
    CHECK (format IN ('standings','series','knockout','custom'));

UPDATE league_phases
  SET phase_order = COALESCE(order_index, 1)
  WHERE phase_order IS NULL;

UPDATE league_phases
  SET format = CASE
    WHEN phase_type = 'regular' THEN 'standings'
    WHEN phase_type = 'play_in' THEN 'series'
    WHEN phase_type = 'playoffs' THEN 'knockout'
    WHEN phase_type = 'final_four' THEN 'knockout'
    WHEN phase_type = 'finals' THEN 'knockout'
    ELSE 'custom'
  END
  WHERE format IS NULL OR format = '';

CREATE INDEX IF NOT EXISTS idx_league_phases_competition_order
  ON league_phases(competition_id, phase_order, order_index);

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0004', 'c2_phases_foundation');
