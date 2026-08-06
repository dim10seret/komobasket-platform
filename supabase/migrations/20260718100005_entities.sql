-- ============================================================
-- KomoBasket Platform
-- Migration 005 - Entities
-- ============================================================

---------------------------------------------------------------
-- TEAMS
---------------------------------------------------------------

create table teams (

    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    name text not null,

    short_name text,

    slug text not null unique,

    description text,

    logo text,

    primary_color text,

    secondary_color text,

    city text,

    founded_year integer,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

---------------------------------------------------------------
-- PLAYERS
---------------------------------------------------------------

create table players (

    id uuid primary key default gen_random_uuid(),

    first_name text not null,

    last_name text not null,

    slug text not null unique,

    birth_date date,

    nationality text,

    height_cm integer,

    weight_kg integer,

    image text,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

---------------------------------------------------------------
-- TEAM REGISTRATIONS
---------------------------------------------------------------

create table team_registrations (

    id uuid primary key default gen_random_uuid(),

    season_id uuid not null
        references seasons(id)
        on delete cascade,

    team_id uuid not null
        references teams(id)
        on delete cascade,

    registration_date date default current_date,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    unique (
        season_id,
        team_id
    )

);

---------------------------------------------------------------
-- PLAYER REGISTRATIONS
---------------------------------------------------------------

create table player_registrations (

    id uuid primary key default gen_random_uuid(),

    team_registration_id uuid not null
        references team_registrations(id)
        on delete cascade,

    player_id uuid not null
        references players(id)
        on delete cascade,

    jersey_number integer not null,

    captain boolean not null default false,

    vice_captain boolean not null default false,

    from_date date,

    until_date date,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    unique (
        team_registration_id,
        player_id
    ),

    unique (
        id,
        team_registration_id
    )

);

---------------------------------------------------------------
-- VENUES
---------------------------------------------------------------

create table venues (

    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    name text not null,

    slug text not null unique,

    city text,

    address text,

    latitude numeric(10,7),

    longitude numeric(10,7),

    capacity integer,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

---------------------------------------------------------------
-- OFFICIALS
---------------------------------------------------------------

create table officials (

    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    first_name text not null,

    last_name text not null,

    role official_role not null,

    phone text,

    email text,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

---------------------------------------------------------------
-- ASSETS
---------------------------------------------------------------

create table assets (

    id uuid primary key default gen_random_uuid(),

    entity_type entity_type not null,

    entity_id uuid not null,

    asset_type asset_type not null,

    title text,

    value text not null,

    thumbnail text,

    sort_order integer not null default 0,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

---------------------------------------------------------------
-- INDEXES
---------------------------------------------------------------

create index idx_teams_organization
on teams(organization_id);

create index idx_teams_slug
on teams(slug);

create index idx_players_slug
on players(slug);

create index idx_team_registrations_season
on team_registrations(season_id);

create index idx_team_registrations_team
on team_registrations(team_id);

create index idx_player_registrations_team
on player_registrations(team_registration_id);

create index idx_player_registrations_player
on player_registrations(player_id);

create index idx_venues_organization
on venues(organization_id);

create index idx_officials_organization
on officials(organization_id);

create index idx_assets_entity
on assets(entity_type, entity_id);

create index idx_assets_type
on assets(asset_type);