-- =====================================================
-- LOOKUP DATA
-- =====================================================

-- -----------------------------------------------------
-- Competition Categories
-- -----------------------------------------------------

INSERT INTO lookup_competition_categories
(code, name, sort_order)

VALUES

('LEAGUE',      'League',      1),
('CUP',         'Cup',         2),
('FRIENDLY',    'Friendly',    3),
('TOURNAMENT',  'Tournament',  4)

ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------
-- Match Status
-- -----------------------------------------------------

INSERT INTO lookup_match_statuses
(code, name, sort_order)

VALUES

('SCHEDULED',    'Scheduled',    1),
('READY',        'Ready',        2),
('IN_PROGRESS',  'In Progress',  3),
('HALFTIME',     'Halftime',     4),
('FINISHED',     'Finished',     5),
('CANCELLED',    'Cancelled',    6)

ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------
-- Period Types
-- -----------------------------------------------------

INSERT INTO lookup_period_types
(code, name, sort_order)

VALUES

('Q1', 'Quarter 1', 1),
('Q2', 'Quarter 2', 2),
('Q3', 'Quarter 3', 3),
('Q4', 'Quarter 4', 4),
('OT', 'Overtime',  5)

ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------
-- Season Status
-- -----------------------------------------------------

INSERT INTO lookup_season_statuses
(code, name, sort_order)

VALUES

('PLANNED',   'Planned',   1),
('ACTIVE',    'Active',    2),
('COMPLETED', 'Completed', 3)

ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- DEFAULT COMPETITION
-- =====================================================

INSERT INTO competitions (
    id,
    name,
    short_name,
    category_code,
    is_active,
    created_at,
    updated_at
)
VALUES (
    gen_random_uuid(),
    'Demo League',
    'DEMO',
    'LEAGUE',
    TRUE,
    NOW(),
    NOW()
)
ON CONFLICT DO NOTHING;

-- =====================================================
-- DEFAULT SEASON
-- =====================================================

INSERT INTO seasons (
    id,
    competition_id,
    name,
    status_code,
    start_date,
    end_date,
    is_active,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    c.id,
    '2026-2027',
    'ACTIVE',
    DATE '2026-09-01',
    DATE '2027-06-30',
    TRUE,
    NOW(),
    NOW()
FROM competitions c
WHERE c.short_name = 'DEMO'
ON CONFLICT DO NOTHING;

-- =====================================================
-- DEMO VENUE
-- =====================================================

INSERT INTO venues (
    id,
    name,
    city,
    is_active,
    created_at,
    updated_at
)
VALUES (
    gen_random_uuid(),
    'Demo Arena',
    'Demo City',
    TRUE,
    NOW(),
    NOW()
)
ON CONFLICT DO NOTHING;

-- =====================================================
-- DEMO TEAMS
-- =====================================================

INSERT INTO teams (
    id,
    name,
    short_name,
    is_active,
    created_at,
    updated_at
)
VALUES
(
    gen_random_uuid(),
    'Home Team',
    'HOME',
    TRUE,
    NOW(),
    NOW()
),
(
    gen_random_uuid(),
    'Away Team',
    'AWAY',
    TRUE,
    NOW(),
    NOW()
)
ON CONFLICT DO NOTHING;

-- =====================================================
-- DEFAULT SYSTEM SETTINGS
-- =====================================================

INSERT INTO system_settings (
    setting_key,
    setting_value,
    description
)
VALUES

('game.periods.regular', '4',
 'Number of regular periods'),

('game.period.duration', '600',
 'Regular period duration in seconds (10 minutes)'),

('game.overtime.duration', '300',
 'Overtime duration in seconds (5 minutes)'),

('game.shot_clock', '24',
 'Shot clock duration'),

('game.team_fouls_limit', '5',
 'Team foul limit per period'),

('game.personal_fouls_limit', '5',
 'Player disqualification after personal fouls'),

('game.timeouts.first_half', '2',
 'Timeouts allowed during first half'),

('game.timeouts.second_half', '3',
 'Timeouts allowed during second half'),

('game.timeouts.overtime', '1',
 'Timeouts allowed during each overtime'),

('game.players_on_court', '5',
 'Players simultaneously on the court'),

('game.max_roster', '12',
 'Maximum players on official roster')

ON CONFLICT (setting_key) DO NOTHING;

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Lookup Tables

SELECT COUNT(*) AS competition_categories
FROM lookup_competition_categories;

SELECT COUNT(*) AS match_statuses
FROM lookup_match_statuses;

SELECT COUNT(*) AS period_types
FROM lookup_period_types;

SELECT COUNT(*) AS season_statuses
FROM lookup_season_statuses;

-- Core Tables

SELECT COUNT(*) AS competitions
FROM competitions;

SELECT COUNT(*) AS seasons
FROM seasons;

SELECT COUNT(*) AS venues
FROM venues;

SELECT COUNT(*) AS teams
FROM teams;

SELECT COUNT(*) AS matches
FROM matches;

SELECT COUNT(*) AS match_players
FROM match_players;

SELECT COUNT(*) AS game_periods
FROM game_periods;

SELECT COUNT(*) AS lineups
FROM lineups;

SELECT COUNT(*) AS substitutions
FROM substitutions;

-- Views

SELECT * FROM v_match_summary LIMIT 5;

SELECT * FROM v_scoreboard LIMIT 5;

SELECT * FROM v_matches_today LIMIT 5;

SELECT * FROM v_match_status LIMIT 5;