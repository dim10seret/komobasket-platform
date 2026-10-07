CREATE TABLE league_roster_memberships_textual_0040 (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  competition_id TEXT REFERENCES league_competitions(id) ON DELETE SET NULL,
  player_id TEXT NOT NULL REFERENCES league_players(id),
  team_id TEXT NOT NULL REFERENCES league_teams(id),
  shirt_number TEXT,
  joined_on TEXT,
  left_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','departed','transferred')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO league_roster_memberships_textual_0040 (
  id, season_id, competition_id, player_id, team_id, shirt_number,
  joined_on, left_on, status, created_at, updated_at
)
SELECT
  id, season_id, competition_id, player_id, team_id,
  CASE WHEN shirt_number IS NULL THEN NULL ELSE CAST(shirt_number AS TEXT) END,
  joined_on, left_on, status, created_at, updated_at
FROM league_roster_memberships;

DROP TABLE league_roster_memberships;
ALTER TABLE league_roster_memberships_textual_0040 RENAME TO league_roster_memberships;

CREATE INDEX idx_rosters_player ON league_roster_memberships(player_id, season_id);
CREATE INDEX idx_rosters_team ON league_roster_memberships(team_id, season_id);
