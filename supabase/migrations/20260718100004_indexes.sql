-- ============================================================
-- KomoBasket Platform
-- Migration 004 - Indexes
-- ============================================================

---------------------------------------------------------------
-- ORGANIZATIONS
---------------------------------------------------------------

create index idx_organizations_slug
on organizations(slug);

---------------------------------------------------------------
-- COMPETITIONS
---------------------------------------------------------------

create index idx_competitions_organization
on competitions(organization_id);

create index idx_competitions_slug
on competitions(slug);

create index idx_competitions_type
on competitions(type);

---------------------------------------------------------------
-- SEASONS
---------------------------------------------------------------

create index idx_seasons_competition
on seasons(competition_id);

create index idx_seasons_slug
on seasons(slug);

create index idx_seasons_active
on seasons(active);