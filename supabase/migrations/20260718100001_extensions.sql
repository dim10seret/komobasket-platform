-- ============================================================
-- KomoBasket Platform
-- Migration 001 - Extensions
-- ============================================================

create extension if not exists pgcrypto;

create extension if not exists pg_trgm;

create extension if not exists unaccent;