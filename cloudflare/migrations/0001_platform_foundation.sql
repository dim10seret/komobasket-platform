-- KomoBasket Platform foundation
-- Additive and idempotent: it does not rebuild or delete any existing table.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS league_schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Permanent public number and editable structured identity for each player.
-- The existing league_players.id remains the internal immutable key used by
-- historical rosters, games and statistics.
CREATE TABLE IF NOT EXISTS league_player_profiles (
  player_id TEXT PRIMARY KEY REFERENCES league_players(id) ON DELETE CASCADE,
  public_id INTEGER NOT NULL UNIQUE CHECK (public_id > 0),
  last_name TEXT,
  first_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_player_profiles_public_id
  ON league_player_profiles(public_id);

-- Player 1 is reserved for ΣΕΡΕΤΙΔΗΣ ΔΗΜΗΤΡΗΣ, including the common
-- ΔΗΜΗΤΡΙΟΣ variant found in imported historical files.
INSERT OR IGNORE INTO league_player_profiles (
  player_id, public_id, last_name, first_name
)
SELECT
  id,
  1,
  'ΣΕΡΕΤΙΔΗΣ',
  'ΔΗΜΗΤΡΗΣ'
FROM league_players
WHERE
  (display_name LIKE '%ΣΕΡΕΤΙΔ%' OR normalized_name LIKE '%ΣΕΡΕΤΙΔ%')
  AND
  (display_name LIKE '%ΔΗΜΗΤΡ%' OR normalized_name LIKE '%ΔΗΜΗΤΡ%')
ORDER BY
  CASE
    WHEN display_name = 'ΣΕΡΕΤΙΔΗΣ ΔΗΜΗΤΡΗΣ' THEN 0
    WHEN display_name = 'ΔΗΜΗΤΡΗΣ ΣΕΡΕΤΙΔΗΣ' THEN 1
    WHEN display_name = 'ΣΕΡΕΤΙΔΗΣ ΔΗΜΗΤΡΙΟΣ' THEN 2
    WHEN display_name = 'ΔΗΜΗΤΡΙΟΣ ΣΕΡΕΤΙΔΗΣ' THEN 3
    ELSE 4
  END,
  created_at,
  id
LIMIT 1;

-- Existing players receive stable numbers. Number 1 remains reserved even if
-- the matching historical record is not present when this migration runs.
INSERT OR IGNORE INTO league_player_profiles (
  player_id, public_id, last_name, first_name
)
SELECT
  unnumbered.id,
  unnumbered.start_number + unnumbered.position,
  NULL,
  NULL
FROM (
  SELECT
    p.id,
    COALESCE((SELECT MAX(public_id) FROM league_player_profiles), 1) AS start_number,
    ROW_NUMBER() OVER (ORDER BY p.created_at, p.display_name, p.id) AS position
  FROM league_players p
  LEFT JOIN league_player_profiles profile ON profile.player_id = p.id
  WHERE profile.player_id IS NULL
) AS unnumbered;

-- Future players automatically receive the next permanent number. If the
-- reserved player was not present during the migration, he still receives 1.
CREATE TRIGGER IF NOT EXISTS trg_league_players_assign_public_id
AFTER INSERT ON league_players
WHEN NOT EXISTS (
  SELECT 1 FROM league_player_profiles WHERE player_id = NEW.id
)
BEGIN
  INSERT INTO league_player_profiles (
    player_id, public_id, last_name, first_name
  )
  VALUES (
    NEW.id,
    CASE
      WHEN
        (NEW.display_name LIKE '%ΣΕΡΕΤΙΔ%' OR NEW.normalized_name LIKE '%ΣΕΡΕΤΙΔ%')
        AND (NEW.display_name LIKE '%ΔΗΜΗΤΡ%' OR NEW.normalized_name LIKE '%ΔΗΜΗΤΡ%')
        AND NOT EXISTS (
          SELECT 1 FROM league_player_profiles WHERE public_id = 1
        )
      THEN 1
      ELSE COALESCE(
        (SELECT MAX(public_id) + 1 FROM league_player_profiles),
        2
      )
    END,
    CASE
      WHEN
        (NEW.display_name LIKE '%ΣΕΡΕΤΙΔ%' OR NEW.normalized_name LIKE '%ΣΕΡΕΤΙΔ%')
        AND (NEW.display_name LIKE '%ΔΗΜΗΤΡ%' OR NEW.normalized_name LIKE '%ΔΗΜΗΤΡ%')
      THEN 'ΣΕΡΕΤΙΔΗΣ'
      ELSE NULL
    END,
    CASE
      WHEN
        (NEW.display_name LIKE '%ΣΕΡΕΤΙΔ%' OR NEW.normalized_name LIKE '%ΣΕΡΕΤΙΔ%')
        AND (NEW.display_name LIKE '%ΔΗΜΗΤΡ%' OR NEW.normalized_name LIKE '%ΔΗΜΗΤΡ%')
      THEN 'ΔΗΜΗΤΡΗΣ'
      ELSE NULL
    END
  );
END;

-- Public lifecycle is kept separately from the legacy draft/active/completed
-- field so the existing CMS and historical data continue to work unchanged.
CREATE TABLE IF NOT EXISTS league_competition_publication (
  competition_id TEXT PRIMARY KEY REFERENCES league_competitions(id) ON DELETE CASCADE,
  lifecycle_status TEXT NOT NULL DEFAULT 'under_construction'
    CHECK (lifecycle_status IN ('under_construction', 'online', 'complete')),
  published_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_competition_publication_status
  ON league_competition_publication(lifecycle_status);

INSERT OR IGNORE INTO league_competition_publication (
  competition_id, lifecycle_status, published_at, completed_at
)
SELECT
  id,
  CASE status
    WHEN 'active' THEN 'online'
    WHEN 'completed' THEN 'complete'
    ELSE 'under_construction'
  END,
  CASE WHEN status IN ('active', 'completed') THEN updated_at ELSE NULL END,
  CASE WHEN status = 'completed' THEN updated_at ELSE NULL END
FROM league_competitions;

CREATE TRIGGER IF NOT EXISTS trg_league_competitions_create_publication
AFTER INSERT ON league_competitions
WHEN NOT EXISTS (
  SELECT 1
  FROM league_competition_publication
  WHERE competition_id = NEW.id
)
BEGIN
  INSERT INTO league_competition_publication (
    competition_id, lifecycle_status, published_at, completed_at
  )
  VALUES (
    NEW.id,
    CASE NEW.status
      WHEN 'active' THEN 'online'
      WHEN 'completed' THEN 'complete'
      ELSE 'under_construction'
    END,
    CASE WHEN NEW.status IN ('active', 'completed') THEN CURRENT_TIMESTAMP ELSE NULL END,
    CASE WHEN NEW.status = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END
  );
END;

-- One editable format record per competition. Detailed or future rules can be
-- stored in settings_json without another schema change.
CREATE TABLE IF NOT EXISTS league_competition_formats (
  competition_id TEXT PRIMARY KEY REFERENCES league_competitions(id) ON DELETE CASCADE,
  expected_team_count INTEGER CHECK (expected_team_count IS NULL OR expected_team_count > 1),
  regular_season_meetings INTEGER NOT NULL DEFAULT 1
    CHECK (regular_season_meetings >= 0),
  win_points INTEGER NOT NULL DEFAULT 2,
  loss_points INTEGER NOT NULL DEFAULT 1,
  forfeit_points INTEGER NOT NULL DEFAULT 0,
  tiebreakers_json TEXT NOT NULL DEFAULT '[]',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO league_competition_formats (competition_id)
SELECT id FROM league_competitions;

CREATE TRIGGER IF NOT EXISTS trg_league_competitions_create_format
AFTER INSERT ON league_competitions
WHEN NOT EXISTS (
  SELECT 1
  FROM league_competition_formats
  WHERE competition_id = NEW.id
)
BEGIN
  INSERT INTO league_competition_formats (competition_id)
  VALUES (NEW.id);
END;

-- Existing phases remain intact. This table adds structured rules for the
-- phases that a competition actually uses.
CREATE TABLE IF NOT EXISTS league_phase_rules (
  phase_id TEXT PRIMARY KEY REFERENCES league_phases(id) ON DELETE CASCADE,
  phase_kind TEXT NOT NULL DEFAULT 'custom'
    CHECK (phase_kind IN (
      'regular_season', 'play_in', 'play_out', 'playoffs',
      'final_four', 'finals', 'custom'
    )),
  bracket_size INTEGER CHECK (bracket_size IS NULL OR bracket_size > 1),
  best_of INTEGER CHECK (best_of IS NULL OR (best_of > 0 AND best_of % 2 = 1)),
  wins_required INTEGER CHECK (wins_required IS NULL OR wins_required > 0),
  carry_over_enabled INTEGER NOT NULL DEFAULT 0 CHECK (carry_over_enabled IN (0, 1)),
  carry_over_source_phase_id TEXT REFERENCES league_phases(id) ON DELETE SET NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO league_phase_rules (phase_id, phase_kind)
SELECT
  id,
  CASE
    WHEN lower(phase_type) IN ('regular', 'regular_season') THEN 'regular_season'
    WHEN lower(phase_type) = 'play_in' THEN 'play_in'
    WHEN lower(phase_type) = 'play_out' THEN 'play_out'
    WHEN lower(phase_type) IN ('playoff', 'playoffs') THEN 'playoffs'
    WHEN lower(phase_type) = 'final_four' THEN 'final_four'
    WHEN lower(phase_type) IN ('final', 'finals') THEN 'finals'
    ELSE 'custom'
  END
FROM league_phases;

CREATE TRIGGER IF NOT EXISTS trg_league_phases_create_rules
AFTER INSERT ON league_phases
WHEN NOT EXISTS (
  SELECT 1 FROM league_phase_rules WHERE phase_id = NEW.id
)
BEGIN
  INSERT INTO league_phase_rules (phase_id, phase_kind)
  VALUES (
    NEW.id,
    CASE
      WHEN lower(NEW.phase_type) IN ('regular', 'regular_season') THEN 'regular_season'
      WHEN lower(NEW.phase_type) = 'play_in' THEN 'play_in'
      WHEN lower(NEW.phase_type) = 'play_out' THEN 'play_out'
      WHEN lower(NEW.phase_type) IN ('playoff', 'playoffs') THEN 'playoffs'
      WHEN lower(NEW.phase_type) = 'final_four' THEN 'final_four'
      WHEN lower(NEW.phase_type) IN ('final', 'finals') THEN 'finals'
      ELSE 'custom'
    END
  );
END;

-- Read-only CMS projection: numeric public ID plus the existing immutable key
-- and birth date, without duplicating the date in another table.
CREATE VIEW IF NOT EXISTS league_players_cms AS
SELECT
  profile.public_id AS player_id,
  player.id AS internal_id,
  profile.last_name,
  profile.first_name,
  player.display_name,
  player.normalized_name,
  player.slug,
  player.birth_date,
  player.active,
  player.created_at,
  player.updated_at
FROM league_players player
JOIN league_player_profiles profile ON profile.player_id = player.id;

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0001', 'platform_foundation');
