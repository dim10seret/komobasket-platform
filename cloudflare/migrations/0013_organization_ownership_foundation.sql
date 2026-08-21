PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS league_organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO league_organizations (id, slug, name, status)
VALUES ('organization_komobasket', 'komobasket', 'KomoBasket', 'active');

ALTER TABLE league_players
  ADD COLUMN organization_id TEXT REFERENCES league_organizations(id);
ALTER TABLE league_teams
  ADD COLUMN organization_id TEXT REFERENCES league_organizations(id);
ALTER TABLE league_competitions
  ADD COLUMN organization_id TEXT REFERENCES league_organizations(id);
ALTER TABLE league_staff
  ADD COLUMN organization_id TEXT REFERENCES league_organizations(id);

UPDATE league_players
SET organization_id = 'organization_komobasket';
UPDATE league_teams
SET organization_id = 'organization_komobasket';
UPDATE league_competitions
SET organization_id = 'organization_komobasket';
UPDATE league_staff
SET organization_id = 'organization_komobasket';

CREATE INDEX IF NOT EXISTS idx_league_players_organization
  ON league_players(organization_id);
CREATE INDEX IF NOT EXISTS idx_league_teams_organization
  ON league_teams(organization_id);
CREATE INDEX IF NOT EXISTS idx_league_competitions_organization
  ON league_competitions(organization_id);
CREATE INDEX IF NOT EXISTS idx_league_staff_organization
  ON league_staff(organization_id);
