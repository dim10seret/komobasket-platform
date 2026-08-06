-- =====================================================
-- MATCH SUMMARY VIEW
-- =====================================================

CREATE OR REPLACE VIEW v_match_summary AS

SELECT

    m.id,

    m.match_number,

    m.match_date,

    m.match_time,

    m.status,

    s.name                     AS season,

    c.name                     AS competition,

    v.name                     AS venue,

    ht.name                    AS home_team,

    at.name                    AS away_team,

    m.home_score,

    m.away_score,

    gp.period_number,

    gp.period_type,

    gp.remaining_seconds,

    gp.clock_running,

    m.updated_at

FROM matches m

LEFT JOIN competitions c
       ON c.id = m.competition_id

LEFT JOIN seasons s
       ON s.id = m.season_id

LEFT JOIN venues v
       ON v.id = m.venue_id

LEFT JOIN team_registrations htr
       ON htr.id = m.home_team_registration_id

LEFT JOIN team_registrations atr
       ON atr.id = m.away_team_registration_id

LEFT JOIN teams ht
       ON ht.id = htr.team_id

LEFT JOIN teams at
       ON at.id = atr.team_id

LEFT JOIN game_periods gp
       ON gp.id = m.current_period_id;


       -- =====================================================
-- MATCH ROSTER VIEW
-- =====================================================

CREATE OR REPLACE VIEW v_match_roster AS

SELECT

    mp.id                         AS match_player_id,

    mp.match_id,

    mp.team_registration_id,

    tr.team_id,

    t.name                        AS team_name,

    pr.player_id,

    p.first_name,

    p.last_name,

    CONCAT(p.last_name, ', ', p.first_name)
                                   AS player_name,

    mp.jersey_number,

    mp.is_starting_five,

    mp.is_captain,

    mp.is_available,

    mp.fouls,

    mp.is_disqualified,

    mp.created_at,

    mp.updated_at

FROM match_players mp

INNER JOIN player_registrations pr
        ON pr.id = mp.player_registration_id

INNER JOIN players p
        ON p.id = pr.player_id

INNER JOIN team_registrations tr
        ON tr.id = mp.team_registration_id

INNER JOIN teams t
        ON t.id = tr.team_id;

    -- =====================================================
-- ACTIVE LINEUPS VIEW
-- =====================================================

CREATE OR REPLACE VIEW v_active_lineups AS

SELECT

    l.id                         AS lineup_id,

    l.match_id,

    l.team_registration_id,

    tr.team_id,

    t.name                       AS team_name,

    l.period_id,

    gp.period_number,

    gp.period_type,

    l.started_event_sequence,

    l.started_clock_seconds,

    l.created_at,

    mp.id                        AS match_player_id,

    pr.player_id,

    p.first_name,

    p.last_name,

    CONCAT(p.last_name, ', ', p.first_name)
                                 AS player_name,

    mp.jersey_number,

    mp.is_captain

FROM lineups l

INNER JOIN lineup_players lp
        ON lp.lineup_id = l.id

INNER JOIN match_players mp
        ON mp.id = lp.match_player_id

INNER JOIN player_registrations pr
        ON pr.id = mp.player_registration_id

INNER JOIN players p
        ON p.id = pr.player_id

INNER JOIN team_registrations tr
        ON tr.id = l.team_registration_id

INNER JOIN teams t
        ON t.id = tr.team_id

LEFT JOIN game_periods gp
       ON gp.id = l.period_id

WHERE l.is_active = TRUE

ORDER BY

    l.match_id,
    t.name,
    mp.jersey_number;

        -- =====================================================
-- SCOREBOARD VIEW
-- =====================================================

CREATE OR REPLACE VIEW v_scoreboard AS

SELECT

    m.id                                   AS match_id,

    m.match_number,

    m.status,

    c.name                                 AS competition,

    s.name                                 AS season,

    ht.name                                AS home_team,

    at.name                                AS away_team,

    m.home_score,

    m.away_score,

    gp.id                                  AS period_id,

    gp.period_number,

    gp.period_type,

    gp.remaining_seconds,

    gp.clock_running,

    CASE
        WHEN gp.remaining_seconds IS NULL THEN NULL
        ELSE
            LPAD((gp.remaining_seconds / 60)::TEXT, 2, '0')
            || ':'
            ||
            LPAD((gp.remaining_seconds % 60)::TEXT, 2, '0')
    END                                     AS game_clock,

    m.updated_at

FROM matches m

LEFT JOIN competitions c
       ON c.id = m.competition_id

LEFT JOIN seasons s
       ON s.id = m.season_id

LEFT JOIN game_periods gp
       ON gp.id = m.current_period_id

LEFT JOIN team_registrations htr
       ON htr.id = m.home_team_registration_id

LEFT JOIN team_registrations atr
       ON atr.id = m.away_team_registration_id

LEFT JOIN teams ht
       ON ht.id = htr.team_id

LEFT JOIN teams at
       ON at.id = atr.team_id;

       -- =====================================================
-- TODAY MATCHES
-- =====================================================

CREATE OR REPLACE VIEW v_matches_today AS

SELECT

    m.id,
    m.match_number,
    m.match_date,
    m.match_time,
    m.status,

    c.name AS competition,
    s.name AS season,

    ht.name AS home_team,
    at.name AS away_team,

    m.home_score,
    m.away_score,

    gp.period_number,
    gp.period_type,
    gp.remaining_seconds,
    gp.clock_running

FROM matches m

LEFT JOIN competitions c
       ON c.id = m.competition_id

LEFT JOIN seasons s
       ON s.id = m.season_id

LEFT JOIN team_registrations htr
       ON htr.id = m.home_team_registration_id

LEFT JOIN team_registrations atr
       ON atr.id = m.away_team_registration_id

LEFT JOIN teams ht
       ON ht.id = htr.team_id

LEFT JOIN teams at
       ON at.id = atr.team_id

LEFT JOIN game_periods gp
       ON gp.id = m.current_period_id

WHERE m.match_date = CURRENT_DATE

ORDER BY
    m.match_time,
    m.match_number;

COMMENT ON VIEW v_matches_today IS
'Returns all matches scheduled for today.';

-- =====================================================
-- CURRENT PERIOD
-- =====================================================

CREATE OR REPLACE VIEW v_current_period AS

SELECT

    m.id                 AS match_id,

    gp.id                AS period_id,

    gp.period_number,

    gp.period_type,

    gp.status,

    gp.remaining_seconds,

    gp.clock_running

FROM matches m

INNER JOIN game_periods gp
        ON gp.id = m.current_period_id;

COMMENT ON VIEW v_current_period IS
'Returns the current period for each active match.';

-- =====================================================
-- ACTIVE MATCH PLAYERS
-- =====================================================

CREATE OR REPLACE VIEW v_active_match_players AS

SELECT

    mp.*

FROM match_players mp

WHERE

    mp.is_available = TRUE
AND mp.is_disqualified = FALSE;

COMMENT ON VIEW v_active_match_players IS
'Returns all available players eligible to participate.';

-- =====================================================
-- ACTIVE LINEUP PLAYERS
-- =====================================================

CREATE OR REPLACE VIEW v_active_lineup_players AS

SELECT

    l.match_id,

    l.team_registration_id,

    lp.lineup_id,

    lp.match_player_id,

    mp.jersey_number,

    pr.player_id,

    p.first_name,

    p.last_name,

    CONCAT(
        p.last_name,
        ', ',
        p.first_name
    ) AS player_name

FROM lineups l

INNER JOIN lineup_players lp
        ON lp.lineup_id = l.id

INNER JOIN match_players mp
        ON mp.id = lp.match_player_id

INNER JOIN player_registrations pr
        ON pr.id = mp.player_registration_id

INNER JOIN players p
        ON p.id = pr.player_id

WHERE l.is_active = TRUE;

COMMENT ON VIEW v_active_lineup_players IS
'Returns every player currently on the court.';

-- =====================================================
-- MATCH PLAYER COUNT
-- =====================================================

CREATE OR REPLACE VIEW v_match_player_count AS

SELECT

    match_id,

    team_registration_id,

    COUNT(*) AS player_count

FROM match_players

GROUP BY

    match_id,

    team_registration_id;

COMMENT ON VIEW v_match_player_count IS
'Returns the number of registered players per team and match.';

-- =====================================================
-- ACTIVE LINEUP COUNT
-- =====================================================

CREATE OR REPLACE VIEW v_active_lineup_count AS

SELECT

    match_id,

    team_registration_id,

    COUNT(*) AS active_players

FROM v_active_lineup_players

GROUP BY

    match_id,

    team_registration_id;

COMMENT ON VIEW v_active_lineup_count IS
'Returns the number of players currently on the court.';

-- =====================================================
-- ACTIVE LINEUPS
-- =====================================================

CREATE OR REPLACE VIEW v_active_lineups_only AS

SELECT

    id,

    match_id,

    team_registration_id,

    started_event_sequence,

    started_clock_seconds,

    period_id,

    created_at

FROM lineups

WHERE is_active = TRUE;

COMMENT ON VIEW v_active_lineups_only IS
'Returns only active lineups.';

-- =====================================================
-- MATCH STATUS SUMMARY
-- =====================================================

CREATE OR REPLACE VIEW v_match_status_summary AS

SELECT

    m.id,

    m.status,

    m.home_score,

    m.away_score,

    gp.period_number,

    gp.remaining_seconds,

    gp.clock_running

FROM matches m

LEFT JOIN game_periods gp

ON gp.id = m.current_period_id;

COMMENT ON VIEW v_match_status_summary IS
'Lightweight match status view for fast application polling.';


