-- =====================================================
-- MATCH EVENTS
-- =====================================================

CREATE TABLE match_events (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    match_id UUID NOT NULL
        REFERENCES matches(id)
        ON DELETE CASCADE,

    period_id UUID NOT NULL
        REFERENCES game_periods(id)
        ON DELETE CASCADE,

    sequence_no INTEGER NOT NULL,

    event_time_seconds INTEGER NOT NULL,

    team_id UUID
        REFERENCES teams(id),

    player_id UUID
        REFERENCES players(id),

    secondary_player_id UUID
        REFERENCES players(id),

    lineup_id UUID,

    event_type_code TEXT NOT NULL,

    points INTEGER NOT NULL
        DEFAULT 0,

    is_success BOOLEAN,

    pos_x NUMERIC(6,2),

    pos_y NUMERIC(6,2),

    notes TEXT,

    created_by UUID,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    CONSTRAINT uq_match_event_sequence
        UNIQUE (match_id, sequence_no)
);

-- =====================================================
-- LOOKUP EVENT TYPES
-- =====================================================

CREATE TABLE lookup_event_types (

    code TEXT PRIMARY KEY,

    name TEXT NOT NULL,

    category TEXT NOT NULL,

    points INTEGER NOT NULL DEFAULT 0,

    affects_score BOOLEAN NOT NULL DEFAULT FALSE,

    affects_player_stats BOOLEAN NOT NULL DEFAULT TRUE,

    affects_team_stats BOOLEAN NOT NULL DEFAULT TRUE,

    requires_player BOOLEAN NOT NULL DEFAULT TRUE,

    requires_secondary_player BOOLEAN NOT NULL DEFAULT FALSE,

    requires_coordinates BOOLEAN NOT NULL DEFAULT FALSE,

    sort_order INTEGER NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE lookup_event_types
IS 'Master list of all supported basketball event types.';

INSERT INTO lookup_event_types
(
    code,
    name,
    category,
    points,
    affects_score,
    affects_player_stats,
    affects_team_stats,
    requires_player,
    requires_secondary_player,
    requires_coordinates,
    sort_order
)
VALUES

('GAME_START','Game Start','SYSTEM',0,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,1),
('GAME_END','Game End','SYSTEM',0,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,2),

('PERIOD_START','Period Start','SYSTEM',0,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,10),
('PERIOD_END','Period End','SYSTEM',0,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,11),

('JUMP_BALL','Jump Ball','GAME',0,FALSE,FALSE,TRUE,FALSE,FALSE,FALSE,20),
('POSSESSION','Possession','GAME',0,FALSE,FALSE,TRUE,FALSE,FALSE,FALSE,21),

('TIMEOUT','Timeout','GAME',0,FALSE,TRUE,TRUE,FALSE,FALSE,FALSE,30),

('SUBSTITUTION','Substitution','GAME',0,FALSE,FALSE,FALSE,TRUE,TRUE,FALSE,40),

('FREE_THROW_MADE','Free Throw Made','SHOT',1,TRUE,TRUE,TRUE,TRUE,FALSE,TRUE,50),
('FREE_THROW_MISSED','Free Throw Missed','SHOT',0,FALSE,TRUE,TRUE,TRUE,FALSE,TRUE,51),

('FIELD_GOAL_2_MADE','2PT Made','SHOT',2,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,60),
('FIELD_GOAL_2_MISSED','2PT Missed','SHOT',0,FALSE,TRUE,TRUE,TRUE,FALSE,TRUE,61),

('FIELD_GOAL_3_MADE','3PT Made','SHOT',3,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,70),
('FIELD_GOAL_3_MISSED','3PT Missed','SHOT',0,FALSE,TRUE,TRUE,TRUE,FALSE,TRUE,71),

('OFFENSIVE_REBOUND','Offensive Rebound','REBOUND',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,80),
('DEFENSIVE_REBOUND','Defensive Rebound','REBOUND',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,81),

('ASSIST','Assist','PLAYER',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,90),

('STEAL','Steal','PLAYER',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,100),

('BLOCK','Block','PLAYER',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,110),

('TURNOVER','Turnover','PLAYER',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,120),

('PERSONAL_FOUL','Personal Foul','FOUL',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,130),

('TECHNICAL_FOUL','Technical Foul','FOUL',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,131),

('UNSPORTSMANLIKE_FOUL','Unsportsmanlike Foul','FOUL',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,132),

('DISQUALIFYING_FOUL','Disqualifying Foul','FOUL',0,FALSE,TRUE,TRUE,TRUE,FALSE,FALSE,133)

ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- MATCH EVENTS INDEXES
-- =====================================================

-- Match events (most common query)
CREATE INDEX idx_match_events_match
ON match_events(match_id);

-- Event sequence
CREATE INDEX idx_match_events_sequence
ON match_events(match_id, sequence_no);

-- Events by period
CREATE INDEX idx_match_events_period
ON match_events(period_id);

-- Events by team
CREATE INDEX idx_match_events_team
ON match_events(team_id);

-- Events by player
CREATE INDEX idx_match_events_player
ON match_events(player_id);

-- Secondary player (assists, substitutions, etc.)
CREATE INDEX idx_match_events_secondary_player
ON match_events(secondary_player_id);

-- Event type
CREATE INDEX idx_match_events_type
ON match_events(event_type_code);

-- Lineup
CREATE INDEX idx_match_events_lineup
ON match_events(lineup_id);

-- Clock within period
CREATE INDEX idx_match_events_clock
ON match_events(period_id, event_time_seconds DESC);

-- Play-by-play ordering
CREATE INDEX idx_match_events_playbyplay
ON match_events(match_id, period_id, sequence_no);

-- Shot chart
CREATE INDEX idx_match_events_coordinates
ON match_events(pos_x, pos_y)
WHERE pos_x IS NOT NULL
  AND pos_y IS NOT NULL;

-- Score events only
CREATE INDEX idx_match_events_scoring
ON match_events(match_id, points)
WHERE points > 0;

-- Fouls
CREATE INDEX idx_match_events_fouls
ON match_events(match_id, event_type_code)
WHERE event_type_code IN (
    'PERSONAL_FOUL',
    'TECHNICAL_FOUL',
    'UNSPORTSMANLIKE_FOUL',
    'DISQUALIFYING_FOUL'
);

-- Rebounds
CREATE INDEX idx_match_events_rebounds
ON match_events(match_id, event_type_code)
WHERE event_type_code IN (
    'OFFENSIVE_REBOUND',
    'DEFENSIVE_REBOUND'
);

-- Turnovers
CREATE INDEX idx_match_events_turnovers
ON match_events(match_id, event_type_code)
WHERE event_type_code = 'TURNOVER';

-- Made shots
CREATE INDEX idx_match_events_made_shots
ON match_events(match_id, event_type_code)
WHERE event_type_code IN (
    'FREE_THROW_MADE',
    'FIELD_GOAL_2_MADE',
    'FIELD_GOAL_3_MADE'
);

-- =====================================================
-- MATCH EVENTS CONSTRAINTS
-- =====================================================

-- Sequence must be positive
ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_sequence
CHECK (sequence_no > 0);

-- Clock cannot be negative
ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_clock
CHECK (event_time_seconds >= 0);

-- Points allowed
ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_points
CHECK (points IN (0,1,2,3));

-- Coordinates (normalized court)
ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_pos_x
CHECK (
    pos_x IS NULL
    OR
    (pos_x BETWEEN 0 AND 100)
);

ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_pos_y
CHECK (
    pos_y IS NULL
    OR
    (pos_y BETWEEN 0 AND 100)
);

-- Player cannot equal secondary player
ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_players
CHECK (
    player_id IS NULL
    OR secondary_player_id IS NULL
    OR player_id <> secondary_player_id
);

-- Success requires valid points
ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_success
CHECK (
    is_success IS NULL
    OR
    points >= 0
);

-- Notes length
ALTER TABLE match_events
ADD CONSTRAINT chk_match_events_notes
CHECK (
    notes IS NULL
    OR length(notes) <= 1000
);

-- Event type FK
ALTER TABLE match_events
ADD CONSTRAINT fk_match_events_event_type
FOREIGN KEY (event_type_code)
REFERENCES lookup_event_types(code);

CREATE OR REPLACE FUNCTION record_match_event(

    p_match_id UUID,
    p_period_id UUID,
    p_sequence_no INTEGER,
    p_event_time_seconds INTEGER,

    p_team_id UUID,
    p_player_id UUID,
    p_secondary_player_id UUID,

    p_lineup_id UUID,

    p_event_type_code TEXT,

    p_points INTEGER DEFAULT 0,

    p_is_success BOOLEAN DEFAULT NULL,

    p_pos_x NUMERIC DEFAULT NULL,
    p_pos_y NUMERIC DEFAULT NULL,

    p_notes TEXT DEFAULT NULL,

    p_created_by UUID DEFAULT NULL

)
RETURNS UUID
LANGUAGE plpgsql
AS
$$

DECLARE

    v_event_id UUID;

BEGIN

    INSERT INTO match_events
    (
        match_id,
        period_id,
        sequence_no,
        event_time_seconds,

        team_id,
        player_id,
        secondary_player_id,

        lineup_id,

        event_type_code,

        points,

        is_success,

        pos_x,
        pos_y,

        notes,

        created_by
    )

    VALUES
    (
        p_match_id,
        p_period_id,
        p_sequence_no,
        p_event_time_seconds,

        p_team_id,
        p_player_id,
        p_secondary_player_id,

        p_lineup_id,

        p_event_type_code,

        p_points,

        p_is_success,

        p_pos_x,
        p_pos_y,

        p_notes,

        p_created_by
    )

    RETURNING id
    INTO v_event_id;

    RETURN v_event_id;

END;

$$;

CREATE OR REPLACE FUNCTION get_last_match_event(
    p_match_id UUID
)
RETURNS match_events
LANGUAGE sql
AS
$$

SELECT *

FROM match_events

WHERE match_id = p_match_id

ORDER BY sequence_no DESC

LIMIT 1;

$$;

CREATE OR REPLACE FUNCTION delete_last_match_event(
    p_match_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS
$$

BEGIN

    DELETE FROM match_events

    WHERE id =

    (
        SELECT id

        FROM match_events

        WHERE match_id = p_match_id

        ORDER BY sequence_no DESC

        LIMIT 1
    );

END;

$$;

CREATE OR REPLACE FUNCTION next_match_sequence(
    p_match_id UUID
)
RETURNS INTEGER
LANGUAGE sql
AS
$$

SELECT COALESCE(MAX(sequence_no),0)+1

FROM match_events

WHERE match_id = p_match_id;

$$;

-- =====================================================
-- PLAY BY PLAY
-- =====================================================

CREATE OR REPLACE VIEW vw_play_by_play AS

SELECT

    me.id,

    me.match_id,

    gp.period_number,

    me.event_time_seconds,

    me.sequence_no,

    me.team_id,
    t.name AS team_name,

    me.player_id,
    CONCAT(p.first_name,' ',p.last_name) AS player_name,

    me.secondary_player_id,
    CONCAT(sp.first_name,' ',sp.last_name) AS secondary_player_name,

    me.event_type_code,
    et.name AS event_name,

    me.points,

    me.is_success,

    me.pos_x,
    me.pos_y,

    me.notes,

    me.created_at

FROM match_events me

JOIN lookup_event_types et
ON et.code = me.event_type_code

LEFT JOIN teams t
ON t.id = me.team_id

LEFT JOIN players p
ON p.id = me.player_id

LEFT JOIN players sp
ON sp.id = me.secondary_player_id

JOIN game_periods gp
ON gp.id = me.period_id

ORDER BY
    me.match_id,
    me.sequence_no;

    CREATE OR REPLACE VIEW vw_player_stats AS

SELECT

    match_id,

    player_id,

    COUNT(*) AS events,

    SUM(points) AS points,

    COUNT(*) FILTER (
        WHERE event_type_code='ASSIST'
    ) AS assists,

    COUNT(*) FILTER (
        WHERE event_type_code='STEAL'
    ) AS steals,

    COUNT(*) FILTER (
        WHERE event_type_code='BLOCK'
    ) AS blocks,

    COUNT(*) FILTER (
        WHERE event_type_code='TURNOVER'
    ) AS turnovers,

    COUNT(*) FILTER (
        WHERE event_type_code='OFFENSIVE_REBOUND'
    ) AS offensive_rebounds,

    COUNT(*) FILTER (
        WHERE event_type_code='DEFENSIVE_REBOUND'
    ) AS defensive_rebounds,

    COUNT(*) FILTER (
        WHERE event_type_code LIKE '%FOUL'
    ) AS fouls

FROM match_events

GROUP BY

    match_id,
    player_id;

    CREATE OR REPLACE VIEW vw_team_stats AS

SELECT

    match_id,

    team_id,

    SUM(points) AS points,

    COUNT(*) FILTER (
        WHERE event_type_code='ASSIST'
    ) AS assists,

    COUNT(*) FILTER (
        WHERE event_type_code='STEAL'
    ) AS steals,

    COUNT(*) FILTER (
        WHERE event_type_code='BLOCK'
    ) AS blocks,

    COUNT(*) FILTER (
        WHERE event_type_code='TURNOVER'
    ) AS turnovers,

    COUNT(*) FILTER (
        WHERE event_type_code='OFFENSIVE_REBOUND'
    ) AS offensive_rebounds,

    COUNT(*) FILTER (
        WHERE event_type_code='DEFENSIVE_REBOUND'
    ) AS defensive_rebounds,

    COUNT(*) FILTER (
        WHERE event_type_code LIKE '%FOUL'
    ) AS fouls

FROM match_events

GROUP BY

    match_id,
    team_id;

    CREATE OR REPLACE VIEW vw_match_score AS

SELECT

    match_id,

    team_id,

    SUM(points) AS score

FROM match_events

GROUP BY

    match_id,
    team_id;

    CREATE OR REPLACE VIEW vw_match_score AS

SELECT

    match_id,

    team_id,

    SUM(points) AS score

FROM match_events

GROUP BY

    match_id,
    team_id;
    
-- =====================================================
-- UPDATE MATCH TIMESTAMP
-- =====================================================

CREATE OR REPLACE FUNCTION trg_touch_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
BEGIN

    UPDATE matches
    SET updated_at = NOW()
    WHERE id = COALESCE(NEW.match_id, OLD.match_id);

    RETURN COALESCE(NEW, OLD);

END;
$$;

CREATE TRIGGER trg_match_events_touch_match
AFTER INSERT OR UPDATE OR DELETE
ON match_events
FOR EACH ROW
EXECUTE FUNCTION trg_touch_match();

CREATE OR REPLACE FUNCTION trg_validate_match_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
BEGIN

    IF NEW.sequence_no <= 0 THEN
        RAISE EXCEPTION 'Invalid sequence number.';
    END IF;

    IF NEW.event_time_seconds < 0 THEN
        RAISE EXCEPTION 'Invalid game clock.';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER trg_match_events_validate
BEFORE INSERT OR UPDATE
ON match_events
FOR EACH ROW
EXECUTE FUNCTION trg_validate_match_event();

CREATE OR REPLACE FUNCTION trg_match_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
BEGIN

    NEW.updated_at := NOW();

    RETURN NEW;

END;
$$;

CREATE TRIGGER trg_match_events_updated_at
BEFORE UPDATE
ON match_events
FOR EACH ROW
EXECUTE FUNCTION trg_match_events_updated_at();

-- =====================================================
-- UNDO / REDO SUPPORT
-- =====================================================

ALTER TABLE match_events

ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

ADD COLUMN deleted_at TIMESTAMPTZ,

ADD COLUMN deleted_by UUID;

CREATE OR REPLACE FUNCTION undo_last_match_event(
    p_match_id UUID,
    p_deleted_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS
$$

DECLARE
    v_event_id UUID;

BEGIN

    SELECT id
    INTO v_event_id
    FROM match_events
    WHERE match_id = p_match_id
      AND is_deleted = FALSE
    ORDER BY sequence_no DESC
    LIMIT 1;

    IF v_event_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE match_events
    SET
        is_deleted = TRUE,
        deleted_at = NOW(),
        deleted_by = p_deleted_by
    WHERE id = v_event_id;

    RETURN v_event_id;

END;

$$;

CREATE OR REPLACE FUNCTION restore_match_event(
    p_event_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS
$$

BEGIN

    UPDATE match_events

    SET
        is_deleted = FALSE,
        deleted_at = NULL,
        deleted_by = NULL

    WHERE id = p_event_id;

END;

$$;

CREATE OR REPLACE VIEW vw_match_events AS

SELECT *

FROM match_events

WHERE is_deleted = FALSE;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE match_events
IS 'Stores every basketball game event in chronological order. This is the primary source for all statistics, play-by-play, box score and analytics.';

COMMENT ON COLUMN match_events.sequence_no
IS 'Sequential event number within a match.';

COMMENT ON COLUMN match_events.event_time_seconds
IS 'Remaining seconds on the period clock when the event occurred.';

COMMENT ON COLUMN match_events.event_type_code
IS 'Basketball event type. References lookup_event_types.';

COMMENT ON COLUMN match_events.player_id
IS 'Primary player involved in the event.';

COMMENT ON COLUMN match_events.secondary_player_id
IS 'Secondary player involved (assist, substitution, steal, etc.).';

COMMENT ON COLUMN match_events.points
IS 'Points awarded by the event (0-3).';

COMMENT ON COLUMN match_events.pos_x
IS 'Normalized X court coordinate (0-100).';

COMMENT ON COLUMN match_events.pos_y
IS 'Normalized Y court coordinate (0-100).';

COMMENT ON COLUMN match_events.is_deleted
IS 'Soft delete flag used by the Undo/Redo engine.';

-- =====================================================
-- PERMISSIONS
-- =====================================================

GRANT SELECT
ON match_events
TO authenticated;

GRANT SELECT
ON vw_match_events
TO authenticated;

GRANT SELECT
ON vw_play_by_play
TO authenticated;

GRANT SELECT
ON vw_player_stats
TO authenticated;

GRANT SELECT
ON vw_team_stats
TO authenticated;

GRANT SELECT
ON vw_match_score
TO authenticated;

GRANT EXECUTE
ON FUNCTION record_match_event
TO authenticated;

GRANT EXECUTE
ON FUNCTION get_last_match_event
TO authenticated;

GRANT EXECUTE
ON FUNCTION next_match_sequence
TO authenticated;

GRANT EXECUTE
ON FUNCTION undo_last_match_event
TO authenticated;

GRANT EXECUTE
ON FUNCTION restore_match_event
TO authenticated;

