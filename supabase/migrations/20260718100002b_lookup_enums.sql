-- =====================================================
-- SHOT ZONE
-- =====================================================

CREATE TYPE shot_zone AS ENUM (

    'paint',

    'restricted_area',

    'mid_range',

    'left_corner_3',

    'right_corner_3',

    'left_wing_3',

    'right_wing_3',

    'top_of_key_3',

    'backcourt'
);

-- =====================================================
-- PLAYER POSITION
-- =====================================================

CREATE TYPE player_position AS ENUM (

    'PG',

    'SG',

    'SF',

    'PF',

    'C'
);

-- =====================================================
-- PERIOD TYPE
-- =====================================================

CREATE TYPE period_type AS ENUM (

    'Q',

    'OT'

);

-- =====================================================
-- PERIOD STATUS
-- =====================================================

CREATE TYPE period_status AS ENUM (

    'scheduled',

    'live',

    'in_progress',

    'finished'
);
