ALTER TABLE league_phases
  ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'finalized'));

ALTER TABLE league_phases
  ADD COLUMN finalized_at TEXT;
