PRAGMA foreign_keys = ON;

CREATE TABLE league_match_reports (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE RESTRICT,
  package_id TEXT NOT NULL REFERENCES league_komocontrol_game_packages(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES league_komocontrol_game_runs(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  report_version INTEGER NOT NULL DEFAULT 1 CHECK (report_version >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('SIMPLE', 'FULL')),
  finalized_at TEXT NOT NULL,
  finalized_by_scorer_id TEXT REFERENCES league_komocontrol_scorers(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  stat_availability_json TEXT NOT NULL,
  timeout_summary_json TEXT NOT NULL,
  team_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id),
  UNIQUE(run_id)
);
CREATE INDEX idx_match_reports_organization_finalized_at ON league_match_reports(organization_id, finalized_at);
CREATE INDEX idx_match_reports_package ON league_match_reports(package_id);

CREATE TABLE league_match_report_lineup_players (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('HOME', 'AWAY')),
  team_id TEXT REFERENCES league_teams(id) ON DELETE SET NULL,
  player_id TEXT REFERENCES league_players(id) ON DELETE SET NULL,
  display_name_snapshot TEXT NOT NULL,
  default_shirt_number_snapshot INTEGER,
  game_shirt_number INTEGER,
  is_captain INTEGER NOT NULL DEFAULT 0 CHECK (is_captain IN (0, 1)),
  is_starter INTEGER NOT NULL DEFAULT 0 CHECK (is_starter IN (0, 1)),
  is_declared INTEGER NOT NULL DEFAULT 1 CHECK (is_declared IN (0, 1)),
  played_seconds INTEGER NOT NULL DEFAULT 0 CHECK (played_seconds >= 0),
  game_disqualification_status TEXT NOT NULL DEFAULT 'none'
    CHECK (game_disqualification_status IN ('none', 'derived', 'immediate')),
  snapshot_json TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_match_report_lineup_report_side_player
  ON league_match_report_lineup_players(report_id, side, player_id);
CREATE UNIQUE INDEX idx_match_report_lineup_report_side_shirt
  ON league_match_report_lineup_players(report_id, side, game_shirt_number)
  WHERE game_shirt_number IS NOT NULL;

CREATE TABLE league_match_report_bench_staff (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('HOME', 'AWAY')),
  source_type TEXT NOT NULL CHECK (source_type IN ('canonical_staff', 'ad_hoc')),
  staff_id TEXT REFERENCES league_staff(id) ON DELETE SET NULL,
  staff_membership_id TEXT REFERENCES league_staff_memberships(id) ON DELETE SET NULL,
  display_name_snapshot TEXT NOT NULL,
  role_code TEXT,
  role_label_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((source_type = 'canonical_staff' AND staff_id IS NOT NULL) OR (source_type = 'ad_hoc' AND staff_id IS NULL))
);
CREATE INDEX idx_match_report_bench_staff_report_side ON league_match_report_bench_staff(report_id, side);

CREATE TABLE league_match_report_referee_assignments (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  referee_id TEXT REFERENCES league_referees(id) ON DELETE SET NULL,
  assignment_order INTEGER NOT NULL CHECK (assignment_order >= 0),
  display_name_snapshot TEXT NOT NULL,
  organization_snapshot TEXT,
  UNIQUE(report_id, assignment_order)
);

CREATE TABLE league_match_report_table_official_assignments (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  table_official_id TEXT REFERENCES league_table_officials(id) ON DELETE SET NULL,
  role_code TEXT NOT NULL,
  role_label_snapshot TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  organization_snapshot TEXT,
  assignment_order INTEGER NOT NULL CHECK (assignment_order >= 0),
  UNIQUE(report_id, role_code, assignment_order)
);

CREATE TABLE league_match_report_periods (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL CHECK (period_number >= 1),
  period_kind TEXT NOT NULL CHECK (period_kind IN ('REGULATION', 'OVERTIME')),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  home_score INTEGER NOT NULL CHECK (home_score >= 0),
  away_score INTEGER NOT NULL CHECK (away_score >= 0),
  UNIQUE(report_id, period_number)
);
