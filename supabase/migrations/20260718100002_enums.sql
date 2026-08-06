-- ============================================================
-- KomoBasket Platform
-- Migration 002 - Enums
-- ============================================================

---------------------------------------------------------------
-- COMPETITIONS
---------------------------------------------------------------

create type competition_type as enum (
    'league',
    'cup',
    'tournament',
    'friendly'
);

create type competition_gender as enum (
    'men',
    'women',
    'mixed'
);

---------------------------------------------------------------
-- MATCHES
---------------------------------------------------------------

create type match_status as enum (
    'scheduled',
    'live',
    'finished',
    'postponed',
    'cancelled'
);

---------------------------------------------------------------
-- USERS
---------------------------------------------------------------

create type user_role as enum (
    'super_admin',
    'organization_admin',
    'competition_admin',
    'statistician'
);

---------------------------------------------------------------
-- OFFICIALS
---------------------------------------------------------------

create type official_role as enum (
    'referee',
    'commissioner',
    'scorekeeper',
    'timekeeper'
);

---------------------------------------------------------------
-- ASSETS
---------------------------------------------------------------

create type entity_type as enum (
    'organization',
    'competition',
    'season',
    'team',
    'player',
    'venue',
    'official',
    'match'
);

create type asset_type as enum (
    'logo',
    'image',
    'banner',
    'cover',

    'video',
    'youtube',
    'pdf',

    'website',
    'facebook',
    'instagram',
    'tiktok',
    'x',
    'linkedin',

    'email',
    'phone'
);