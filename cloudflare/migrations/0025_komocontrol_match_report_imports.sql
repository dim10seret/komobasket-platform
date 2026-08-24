PRAGMA foreign_keys = ON;

CREATE TABLE league_match_report_imports (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE REFERENCES league_match_reports(id) ON DELETE RESTRICT,
  game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  accepted_at TEXT,
  rejected_at TEXT,
  rejection_code TEXT,
  official_result_applied INTEGER NOT NULL DEFAULT 0 CHECK (official_result_applied IN (0, 1)),
  official_result_applied_at TEXT,
  progression_applied INTEGER NOT NULL DEFAULT 0 CHECK (progression_applied IN (0, 1)),
  progression_applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL AND rejected_at IS NULL)
    OR (status = 'rejected' AND rejected_at IS NOT NULL AND accepted_at IS NULL)
  ),
  CHECK (
    (official_result_applied = 0 AND official_result_applied_at IS NULL)
    OR (official_result_applied = 1 AND status = 'accepted' AND official_result_applied_at IS NOT NULL)
  ),
  CHECK (
    (progression_applied = 0 AND progression_applied_at IS NULL)
    OR (progression_applied = 1 AND status = 'accepted' AND official_result_applied = 1 AND progression_applied_at IS NOT NULL)
  )
);
CREATE INDEX idx_match_report_imports_game
  ON league_match_report_imports(game_id);
CREATE INDEX idx_match_report_imports_status_accepted_at
  ON league_match_report_imports(status, accepted_at);
