PRAGMA foreign_keys = ON;

ALTER TABLE league_organizations ADD COLUMN logo_url TEXT;
ALTER TABLE league_organizations ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'unpublished'
  CHECK (publication_status IN ('unpublished', 'published'));
ALTER TABLE league_organizations ADD COLUMN published_at TEXT;
