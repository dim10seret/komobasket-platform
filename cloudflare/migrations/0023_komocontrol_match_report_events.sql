PRAGMA foreign_keys = ON;

CREATE TABLE league_match_report_events (
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
CREATE INDEX idx_match_report_events_report_play_sequence ON league_match_report_events(report_id, play_id, sequence);
CREATE INDEX idx_match_report_events_report_type_sequence ON league_match_report_events(report_id, event_type, sequence);
CREATE INDEX idx_match_report_events_run_sequence ON league_match_report_events(run_id, sequence);

CREATE TABLE league_match_report_fouls (
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

CREATE TABLE league_match_report_free_throw_series (
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
