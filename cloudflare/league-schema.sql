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
