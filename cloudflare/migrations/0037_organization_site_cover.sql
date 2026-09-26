-- Optional organization-owned hero override; NULL retains the existing default.
ALTER TABLE league_organizations ADD COLUMN site_cover_url TEXT;
