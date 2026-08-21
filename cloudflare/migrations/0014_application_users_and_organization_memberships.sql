PRAGMA foreign_keys = ON;

CREATE TABLE league_app_users (
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

CREATE TABLE league_organization_memberships (
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

CREATE INDEX idx_organization_memberships_user
  ON league_organization_memberships(user_id, status);

CREATE INDEX idx_organization_memberships_organization
  ON league_organization_memberships(organization_id, status, role);
