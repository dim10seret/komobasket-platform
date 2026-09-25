# KomoBasket production baseline: Platform MVP and administrative results

## Live release

- Source commit / tag target: `6d6007e4bc86e3481f52d8fd4b76544bf76b1050`
- Annotated tag: `production-site-20260925-platform-mvp-admin-results-v1`
- Deployment: `c8790ca5-b148-420f-9514-ea85644b1bdb`
- Version: `d3227395-be57-49a0-b9ae-fc79e1d7f0bd`
- Traffic: 100%
- Previous baseline: `production-site-20260921-meta-legal-pages`

The user explicitly accepted the production fixture gaps below. They are coverage gaps, not observed runtime failures. The release remains live; no rollback or further production mutation is requested.

## D1

Only 0035_matchday_mvp_selections.sql then 0036_administrative_game_results.sql were applied.
36 applied / 0 pending. quick_check: ok. FK violations: 0.
Both feature tables exist with 0 rows. All 61 pre-existing business-table row counts remained unchanged.
Counts were captured in read-only batches, not one atomic database snapshot.
The JSON records exact counts and the prior deployment/version.

## Verified production smoke

Central homepage, /schedule, /stats, legal pages, Cloudflare Access protection, authorized Platform, organization switching, Program/Games, selected-game Administrative Result UI, MVP modal and Top 5 read, central public competition, sampled responsive/mobile behavior and admin table scrolling: VERIFIED PASS.

## Fixture gaps

Each following scope is **NOT VERIFIED IN PRODUCTION — NO SAFE FIXTURE**.

- Hosted public homepage/statistics/standings/navigation: all 5 production organizations are unpublished; /friendlymatches returned 404. No publication setting was changed.
- Public finalized-game/date display: no suitable currently public production fixture was used. No game/result was manufactured.
- MVP incomplete-matchday case: no suitable production matchday was used solely for smoke. No competition data was changed.

Local functional tests, site regressions and local browser/visual validation for the exact deployed source: PASS, reused from the certified release. These do not imply that missing production checks were performed.

Production MVP selection: NOT PERFORMED BY DESIGN.
Production administrative-result edit: NOT PERFORMED BY DESIGN.

## Manifest policy

site-source-sha256.txt contains 423 SHA-256 entries: the previous 416 paths plus 7 tracked runtime/migration additions.
Hashes represent file bytes. Every file is checked against the source commit using Git object identity and repository clean filters where applicable.
Tests, desktop-only source, generated output, backups, temporary files, local databases, caches, logs and secrets are excluded.
Website KomoControl API routes stay included; the standalone desktop application is excluded.
This is a source-integrity checkpoint, not proof of cryptographic identity with the deployed Worker bundle.
The tag points to the source commit, never the later metadata-only commit.

## Safety

Top Performance, EFF, MVP ranking/tie-break, statistics calculations, KomoControl, MatchEngine, canonical gameplay events, finalization contract, public sync protocol and Meta/Facebook integration remain as certified.
No runtime source or migration content is changed during baseline finalization.
Only the three baseline files belong to the metadata commit.
Existing excluded artifacts stay uncommitted and untouched.
Push is limited to normal fast-forward main and this one production tag.
