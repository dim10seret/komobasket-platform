-- ============================================================
-- KomoBasket Platform
-- Migration 003 - Core Tables
-- ============================================================

---------------------------------------------------------------
-- ORGANIZATIONS
---------------------------------------------------------------

create table organizations (

    id uuid primary key default gen_random_uuid(),

    name text not null,

    slug text not null unique,

    description text,

    logo text,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

---------------------------------------------------------------
-- COMPETITIONS
---------------------------------------------------------------

create table competitions (

    id uuid primary key default gen_random_uuid(),

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    name text not null,

    slug text not null unique,

    description text,

    type competition_type not null,

    gender competition_gender not null default 'men',

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()

);

---------------------------------------------------------------
-- SEASONS
---------------------------------------------------------------

create table seasons (

    id uuid primary key default gen_random_uuid(),

    competition_id uuid not null
        references competitions(id)
        on delete cascade,

    name text not null,

    slug text not null unique,

    start_date date,

    end_date date,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    unique (competition_id, name)

);