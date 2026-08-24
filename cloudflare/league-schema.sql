PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS league_organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','archived')),
  logo_url TEXT,
  publication_status TEXT NOT NULL DEFAULT 'unpublished'
    CHECK (publication_status IN ('unpublished','published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  is_super_admin INTEGER NOT NULL DEFAULT 0
    CHECK (is_super_admin IN (0,1)),
  access_subject TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES league_app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','invited','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user
  ON league_organization_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_organization_memberships_organization
  ON league_organization_memberships(organization_id, status, role);

CREATE TABLE IF NOT EXISTS league_supporters (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT NOT NULL,
  description TEXT,
  website_url TEXT,
  display_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_league_supporters_organization_status_order
  ON league_supporters(organization_id, status, display_order, name, id);

CREATE TABLE IF NOT EXISTS league_competition_komocontrol_defaults (
  competition_id TEXT PRIMARY KEY REFERENCES league_competitions(id) ON DELETE CASCADE,
  game_mode TEXT NOT NULL DEFAULT 'SIMPLE'
    CHECK (game_mode IN ('SIMPLE', 'FULL')),
  min_players INTEGER NOT NULL CHECK (min_players >= 1),
  max_players INTEGER NOT NULL CHECK (max_players >= 1),
  starting_players INTEGER NOT NULL CHECK (starting_players >= 1),
  regulation_periods INTEGER NOT NULL CHECK (regulation_periods >= 1),
  regulation_period_seconds INTEGER NOT NULL CHECK (regulation_period_seconds > 0),
  overtime_seconds INTEGER NOT NULL CHECK (overtime_seconds > 0),
  tie_allowed INTEGER NOT NULL DEFAULT 0 CHECK (tie_allowed IN (0, 1)),
  winner_required INTEGER NOT NULL DEFAULT 1 CHECK (winner_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_game_komocontrol_overrides (
  game_id TEXT PRIMARY KEY REFERENCES league_games(id) ON DELETE CASCADE,
  game_mode TEXT CHECK (game_mode IS NULL OR game_mode IN ('SIMPLE', 'FULL')),
  min_players INTEGER CHECK (min_players IS NULL OR min_players >= 1),
  max_players INTEGER CHECK (max_players IS NULL OR max_players >= 1),
  starting_players INTEGER CHECK (starting_players IS NULL OR starting_players >= 1),
  regulation_periods INTEGER CHECK (regulation_periods IS NULL OR regulation_periods >= 1),
  regulation_period_seconds INTEGER CHECK (
    regulation_period_seconds IS NULL OR regulation_period_seconds > 0
  ),
  overtime_seconds INTEGER CHECK (overtime_seconds IS NULL OR overtime_seconds > 0),
  tie_allowed INTEGER CHECK (tie_allowed IS NULL OR tie_allowed IN (0, 1)),
  winner_required INTEGER CHECK (winner_required IS NULL OR winner_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_komocontrol_scorers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE RESTRICT,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_komocontrol_scorers_organization_status
  ON league_komocontrol_scorers(organization_id, status);

CREATE TABLE IF NOT EXISTS league_referees (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  organization TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referees_organization_active_name
  ON league_referees(organization_id, active, last_name, first_name);

CREATE TABLE IF NOT EXISTS league_table_officials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  organization TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_table_officials_organization_active_name
  ON league_table_officials(organization_id, active, last_name, first_name);

CREATE TABLE IF NOT EXISTS league_komocontrol_game_packages (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE RESTRICT,
  package_version INTEGER NOT NULL CHECK (package_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('published', 'superseded', 'revoked')),
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  superseded_at TEXT,
  published_by_user_id TEXT REFERENCES league_app_users(id) ON DELETE SET NULL,
  UNIQUE(game_id, package_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_komocontrol_game_packages_current_published
  ON league_komocontrol_game_packages(game_id)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_komocontrol_game_packages_organization_status_published_at
  ON league_komocontrol_game_packages(organization_id, status, published_at);

CREATE TABLE IF NOT EXISTS league_komocontrol_game_runs (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE RESTRICT,
  package_id TEXT NOT NULL REFERENCES league_komocontrol_game_packages(id) ON DELETE RESTRICT,
  scorer_id TEXT NOT NULL REFERENCES league_komocontrol_scorers(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finalized', 'abandoned')),
  started_at TEXT,
  last_sync_at TEXT,
  last_accepted_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_accepted_sequence >= 0),
  recovery_state_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_komocontrol_game_runs_game_status
  ON league_komocontrol_game_runs(game_id, status);
CREATE INDEX IF NOT EXISTS idx_komocontrol_game_runs_scorer_status_last_sync
  ON league_komocontrol_game_runs(scorer_id, status, last_sync_at);
CREATE INDEX IF NOT EXISTS idx_komocontrol_game_runs_package
  ON league_komocontrol_game_runs(package_id);

CREATE TABLE IF NOT EXISTS league_komocontrol_recovery_events (
  run_id TEXT NOT NULL REFERENCES league_komocontrol_game_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS league_match_reports (
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
CREATE INDEX IF NOT EXISTS idx_match_reports_organization_finalized_at ON league_match_reports(organization_id, finalized_at);
CREATE INDEX IF NOT EXISTS idx_match_reports_package ON league_match_reports(package_id);

CREATE TABLE IF NOT EXISTS league_match_report_lineup_players (
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

CREATE TABLE IF NOT EXISTS league_match_report_bench_staff (
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
CREATE INDEX IF NOT EXISTS idx_match_report_bench_staff_report_side ON league_match_report_bench_staff(report_id, side);

CREATE TABLE IF NOT EXISTS league_match_report_referee_assignments (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  referee_id TEXT REFERENCES league_referees(id) ON DELETE SET NULL,
  assignment_order INTEGER NOT NULL CHECK (assignment_order >= 0),
  display_name_snapshot TEXT NOT NULL,
  organization_snapshot TEXT,
  UNIQUE(report_id, assignment_order)
);

CREATE TABLE IF NOT EXISTS league_match_report_table_official_assignments (
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

CREATE TABLE IF NOT EXISTS league_match_report_periods (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL CHECK (period_number >= 1),
  period_kind TEXT NOT NULL CHECK (period_kind IN ('REGULATION', 'OVERTIME')),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  home_score INTEGER NOT NULL CHECK (home_score >= 0),
  away_score INTEGER NOT NULL CHECK (away_score >= 0),
  UNIQUE(report_id, period_number)
);

CREATE TABLE IF NOT EXISTS league_match_report_events (
  event_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES league_komocontrol_game_runs(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  event_type TEXT NOT NULL,
  period_number INTEGER NOT NULL CHECK (period_number >= 1),
  period_kind TEXT NOT NULL CHECK (period_kind IN ('REGULATION', 'OVERTIME')),
  game_clock_seconds_remaining INTEGER NOT NULL CHECK (game_clock_seconds_remaining >= 0),
  occurred_at TEXT NOT NULL,
  play_id TEXT,
  parent_event_id TEXT REFERENCES league_match_report_events(event_id) ON DELETE SET NULL,
  related_event_id TEXT REFERENCES league_match_report_events(event_id) ON DELETE SET NULL,
  supersedes_event_id TEXT REFERENCES league_match_report_events(event_id) ON DELETE SET NULL,
  voids_event_id TEXT REFERENCES league_match_report_events(event_id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_match_report_events_report_play_sequence ON league_match_report_events(report_id, play_id, sequence);
CREATE INDEX IF NOT EXISTS idx_match_report_events_report_type_sequence ON league_match_report_events(report_id, event_type, sequence);
CREATE INDEX IF NOT EXISTS idx_match_report_events_run_sequence ON league_match_report_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS league_match_report_fouls (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL UNIQUE REFERENCES league_match_report_events(event_id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('PERSONAL','TECHNICAL','TECHNICAL_CATEGORY_2','COACH_TECHNICAL','BENCH_TECHNICAL','UNSPORTSMANLIKE','UNSPORTSMANLIKE_CATEGORY_2','DISQUALIFYING')),
  offender_target_type TEXT NOT NULL CHECK (offender_target_type IN ('PLAYER','COACH','TEAM_BENCH')),
  offender_lineup_player_id TEXT REFERENCES league_match_report_lineup_players(id) ON DELETE SET NULL,
  offender_bench_staff_id TEXT REFERENCES league_match_report_bench_staff(id) ON DELETE SET NULL,
  offender_name_snapshot TEXT NOT NULL,
  affected_lineup_player_id TEXT REFERENCES league_match_report_lineup_players(id) ON DELETE SET NULL,
  free_throw_count INTEGER NOT NULL CHECK (free_throw_count BETWEEN 0 AND 3),
  free_throw_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (free_throw_cancelled IN (0,1)),
  final_continuation TEXT CHECK (final_continuation IS NULL OR final_continuation IN ('LIVE_BALL','DEAD_BALL')),
  counts_player_personal INTEGER NOT NULL DEFAULT 0 CHECK (counts_player_personal IN (0,1)),
  counts_team_foul INTEGER NOT NULL DEFAULT 0 CHECK (counts_team_foul IN (0,1)),
  counts_technical_combo INTEGER NOT NULL DEFAULT 0 CHECK (counts_technical_combo IN (0,1)),
  counts_unsportsmanlike_combo INTEGER NOT NULL DEFAULT 0 CHECK (counts_unsportsmanlike_combo IN (0,1)),
  game_disqualification TEXT NOT NULL DEFAULT 'none' CHECK (game_disqualification IN ('none','derived','immediate')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_match_report_free_throw_series (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  source_foul_event_id TEXT NOT NULL REFERENCES league_match_report_events(event_id) ON DELETE RESTRICT,
  shooter_lineup_player_id TEXT REFERENCES league_match_report_lineup_players(id) ON DELETE SET NULL,
  expected_attempts INTEGER NOT NULL CHECK (expected_attempts >= 1),
  completed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (completed_attempts >= 0 AND completed_attempts <= expected_attempts),
  final_continuation TEXT NOT NULL CHECK (final_continuation IN ('LIVE_BALL','DEAD_BALL')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','COMPLETED','CANCELLED')),
  cancel_event_id TEXT REFERENCES league_match_report_events(event_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, source_foul_event_id),
  CHECK (status <> 'CANCELLED' OR (completed_attempts = 0 AND cancel_event_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS league_match_report_player_stats (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  lineup_player_id TEXT NOT NULL REFERENCES league_match_report_lineup_players(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES league_players(id) ON DELETE SET NULL,
  side TEXT NOT NULL CHECK (side IN ('HOME', 'AWAY')),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('SIMPLE', 'FULL')),
  availability_json TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  personal_fouls INTEGER NOT NULL CHECK (personal_fouls >= 0),
  played_seconds INTEGER NOT NULL CHECK (played_seconds >= 0),
  one_point_made INTEGER NOT NULL CHECK (one_point_made >= 0),
  two_point_made INTEGER NOT NULL CHECK (two_point_made >= 0),
  three_point_made INTEGER NOT NULL CHECK (three_point_made >= 0),
  ft_made INTEGER CHECK (ft_made IS NULL OR ft_made >= 0),
  ft_attempted INTEGER CHECK (ft_attempted IS NULL OR ft_attempted >= 0),
  two_pt_made INTEGER CHECK (two_pt_made IS NULL OR two_pt_made >= 0),
  two_pt_attempted INTEGER CHECK (two_pt_attempted IS NULL OR two_pt_attempted >= 0),
  three_pt_made INTEGER CHECK (three_pt_made IS NULL OR three_pt_made >= 0),
  three_pt_attempted INTEGER CHECK (three_pt_attempted IS NULL OR three_pt_attempted >= 0),
  offensive_rebounds INTEGER CHECK (offensive_rebounds IS NULL OR offensive_rebounds >= 0),
  defensive_rebounds INTEGER CHECK (defensive_rebounds IS NULL OR defensive_rebounds >= 0),
  assists INTEGER CHECK (assists IS NULL OR assists >= 0),
  steals INTEGER CHECK (steals IS NULL OR steals >= 0),
  turnovers INTEGER CHECK (turnovers IS NULL OR turnovers >= 0),
  blocks_made INTEGER CHECK (blocks_made IS NULL OR blocks_made >= 0),
  blocks_received INTEGER CHECK (blocks_received IS NULL OR blocks_received >= 0),
  plus_minus INTEGER,
  efficiency INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, lineup_player_id),
  CHECK (ft_made IS NULL OR ft_attempted IS NULL OR ft_made <= ft_attempted),
  CHECK (two_pt_made IS NULL OR two_pt_attempted IS NULL OR two_pt_made <= two_pt_attempted),
  CHECK (three_pt_made IS NULL OR three_pt_attempted IS NULL OR three_pt_made <= three_pt_attempted)
);
CREATE INDEX IF NOT EXISTS idx_match_report_player_stats_report_side
  ON league_match_report_player_stats(report_id, side);
CREATE INDEX IF NOT EXISTS idx_match_report_player_stats_player_report
  ON league_match_report_player_stats(player_id, report_id);

CREATE TABLE IF NOT EXISTS league_match_report_imports (
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
CREATE INDEX IF NOT EXISTS idx_match_report_imports_game
  ON league_match_report_imports(game_id);
CREATE INDEX IF NOT EXISTS idx_match_report_imports_status_accepted_at
  ON league_match_report_imports(status, accepted_at);



CREATE TABLE IF NOT EXISTS league_seasons (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE,
  starts_on TEXT, ends_on TEXT, status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_competitions (
  id TEXT PRIMARY KEY, organization_id TEXT REFERENCES league_organizations(id),
  season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'league'
    CHECK (type IN ('league','cup','tournament')),
  custom_type_label TEXT, logo_url TEXT, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(season_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_league_competitions_organization
  ON league_competitions(organization_id);

CREATE TABLE IF NOT EXISTS league_teams (
  id TEXT PRIMARY KEY, organization_id TEXT REFERENCES league_organizations(id),
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, city TEXT NOT NULL DEFAULT 'Κομοτηνή',
  logo_url TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_league_teams_organization
  ON league_teams(organization_id);

CREATE TABLE IF NOT EXISTS league_season_teams (
  id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES league_teams(id), display_name TEXT NOT NULL, logo_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(season_id, team_id)
);

CREATE TABLE IF NOT EXISTS league_competition_teams (
  id TEXT PRIMARY KEY, competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  season_team_id TEXT NOT NULL REFERENCES league_season_teams(id) ON DELETE CASCADE,
  seed INTEGER, status TEXT NOT NULL DEFAULT 'active', UNIQUE(competition_id, season_team_id)
);

CREATE TABLE IF NOT EXISTS league_players (
  id TEXT PRIMARY KEY, organization_id TEXT REFERENCES league_organizations(id),
  slug TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
  birth_date TEXT, photo_url TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_league_players_normalized ON league_players(normalized_name);
CREATE INDEX IF NOT EXISTS idx_league_players_organization
  ON league_players(organization_id);

CREATE TABLE IF NOT EXISTS league_player_aliases (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES league_players(id) ON DELETE CASCADE,
  alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual',
  confidence REAL NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(player_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_player_aliases_normalized ON league_player_aliases(normalized_alias);

CREATE TABLE IF NOT EXISTS league_legacy_player_refs (
  legacy_slug TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES league_players(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'historical-import', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_legacy_player_refs_player ON league_legacy_player_refs(player_id);

CREATE TABLE IF NOT EXISTS league_roster_memberships (
  id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  competition_id TEXT REFERENCES league_competitions(id) ON DELETE SET NULL,
  player_id TEXT NOT NULL REFERENCES league_players(id), team_id TEXT NOT NULL REFERENCES league_teams(id),
  shirt_number INTEGER, joined_on TEXT, left_on TEXT, status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','departed','transferred')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rosters_player ON league_roster_memberships(player_id, season_id);
CREATE INDEX IF NOT EXISTS idx_rosters_team ON league_roster_memberships(team_id, season_id);

CREATE TABLE IF NOT EXISTS league_player_movements (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES league_players(id), season_id TEXT NOT NULL REFERENCES league_seasons(id),
  from_team_id TEXT REFERENCES league_teams(id), to_team_id TEXT REFERENCES league_teams(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('registration','transfer','departure','return')),
  effective_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_staff (
  id TEXT PRIMARY KEY, organization_id TEXT REFERENCES league_organizations(id),
  first_name TEXT, last_name TEXT,
  display_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
  birth_date TEXT, photo_url TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_staff_normalized ON league_staff(normalized_name);
CREATE INDEX IF NOT EXISTS idx_league_staff_organization
  ON league_staff(organization_id);

CREATE TABLE IF NOT EXISTS league_staff_memberships (
  id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES league_staff(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'other'
    CHECK (role IN ('head_coach','assistant_coach','trainer','physiotherapist','doctor','team_manager','team_official','other')),
  custom_role_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(staff_id, season_id, competition_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_memberships_staff
  ON league_staff_memberships(staff_id, season_id, competition_id);
CREATE INDEX IF NOT EXISTS idx_staff_memberships_team
  ON league_staff_memberships(team_id, season_id, competition_id);

CREATE TABLE IF NOT EXISTS league_phases (
  id TEXT PRIMARY KEY, competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, phase_type TEXT NOT NULL DEFAULT 'regular', format TEXT NOT NULL DEFAULT 'standings' CHECK (format IN ('standings','series','knockout','custom')), order_index INTEGER NOT NULL DEFAULT 0, phase_order INTEGER,
  previous_phase_id TEXT REFERENCES league_phases(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','finalized')),
  finalized_at TEXT,

  settings_json TEXT NOT NULL DEFAULT '{}', UNIQUE(competition_id, slug)
);

CREATE TABLE IF NOT EXISTS league_phase_standings_presentation (
  phase_id TEXT NOT NULL REFERENCES league_phases(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('direct_qualification','play_out','eliminated')),
  position INTEGER NOT NULL CHECK (position >= 1),
  PRIMARY KEY (phase_id, category, position),
  UNIQUE (phase_id, position)
);
CREATE INDEX IF NOT EXISTS idx_phase_standings_presentation_phase
  ON league_phase_standings_presentation(phase_id, category, position);

CREATE TABLE IF NOT EXISTS league_games (
  id TEXT PRIMARY KEY, competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES league_phases(id) ON DELETE SET NULL,
  schedule_id TEXT REFERENCES league_phase_schedules(id) ON DELETE RESTRICT,
  cycle_number INTEGER,
  round_number INTEGER,
  game_order INTEGER,
  round_label TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT, scheduled_date TEXT, scheduled_time TEXT CHECK (scheduled_time IS NULL OR scheduled_date IS NOT NULL), venue TEXT NOT NULL DEFAULT '', home_team_id TEXT NOT NULL REFERENCES league_teams(id),
  away_team_id TEXT NOT NULL REFERENCES league_teams(id), home_score INTEGER, away_score INTEGER,
  series_matchup_id TEXT,
  series_round_number INTEGER CHECK (series_round_number IS NULL OR series_round_number >= 1),
  result_source TEXT CHECK (result_source IS NULL OR result_source IN ('manual','match_report','award')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','postponed','cancelled')),
  external_id TEXT, video_url TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_games_schedule ON league_games(scheduled_at, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_schedule_slot
  ON league_games(schedule_id, round_number, game_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_series_identity
  ON league_games(phase_id, series_matchup_id, series_round_number)
  WHERE series_matchup_id IS NOT NULL AND series_round_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS league_series_planning_slots (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  phase_id TEXT NOT NULL REFERENCES league_phases(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES league_phase_schedules(id) ON DELETE CASCADE,
  matchup_id TEXT NOT NULL,
  series_round_number INTEGER NOT NULL CHECK (series_round_number >= 1),
  scheduled_date TEXT,
  scheduled_time TEXT CHECK (scheduled_time IS NULL OR scheduled_date IS NOT NULL),
  venue TEXT NOT NULL DEFAULT '',
  real_game_id TEXT REFERENCES league_games(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(schedule_id, matchup_id, series_round_number)
);
CREATE INDEX IF NOT EXISTS idx_series_planning_slots_schedule
  ON league_series_planning_slots(schedule_id, matchup_id, series_round_number);
CREATE INDEX IF NOT EXISTS idx_series_planning_slots_phase
  ON league_series_planning_slots(phase_id, schedule_id);

CREATE TABLE IF NOT EXISTS league_competition_venues (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  map_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(competition_id, name)
);

CREATE TABLE IF NOT EXISTS league_player_game_stats (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES league_players(id), team_id TEXT NOT NULL REFERENCES league_teams(id),
  points INTEGER NOT NULL DEFAULT 0, rebounds INTEGER NOT NULL DEFAULT 0, assists INTEGER NOT NULL DEFAULT 0,
  steals INTEGER NOT NULL DEFAULT 0, blocks INTEGER NOT NULL DEFAULT 0, threes INTEGER NOT NULL DEFAULT 0,
  fouls INTEGER NOT NULL DEFAULT 0, minutes INTEGER NOT NULL DEFAULT 0, is_mvp INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, player_id)
);

CREATE TABLE IF NOT EXISTS league_player_merge_log (
  id TEXT PRIMARY KEY, kept_player_id TEXT NOT NULL REFERENCES league_players(id), merged_player_id TEXT NOT NULL,
  merged_name TEXT NOT NULL, reason TEXT NOT NULL, confidence REAL NOT NULL, snapshot_json TEXT NOT NULL,
  undone_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS league_audit_log (
  id TEXT PRIMARY KEY, actor_email TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
