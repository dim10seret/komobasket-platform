# KomoBasket Production Site Baseline - Sync Diagnostics

This checkpoint records the live KomoBasket production site after the successful deployment of the server-side KomoControl sync conflict diagnostics.

## Production identity

- Deployment: `80808b65-5efd-4af2-ba98-9b119abf8237`
- Version: `1f24ec95-384d-4edf-b240-07a3e92acb32`
- Traffic: `100%`
- Source commit: `be559dbc1531af90f43aad99c57e85f6eb1d690f`
- Tag: `production-site-20260920-sync-diagnostics`
- Previous production baseline: `production-site-20260919-game-sheet-v1`
- D1: `34 applied / 0 pending`
- D1 integrity: `quick_check = ok`, `FK violations = 0`

## Approved release delta

- `src/services/komocontrol-gameplay-sync-core.ts`
- `src/services/komocontrol-gameplay-sync-core.test.ts`
- `src/services/komocontrol-gameplay-sync.service.ts`
- `src/services/komocontrol-gameplay-sync.service.test.ts`

The public sync error remains `SYNC_RUN_CONFLICT`. The release adds only internal, non-secret diagnostic subreasons and does not relax any sync acceptance rule. Valid pinned superseded packages remain accepted.

## Validation

- Focused sync tests: `14/14 PASS`
- Full site regressions: `814/814 PASS` (`770` Vitest + `44` Node)
- TypeScript: `PASS`
- Next production build: `PASS`
- OpenNext build: `PASS`
- Read-only post-deploy smoke: `PASS`

No migration, D1 write, route, binding, Access, DNS, R2, Images, or KomoControl desktop change was made.

## Manifest scope

`site-source-sha256.txt` contains deterministic SHA-256 hashes for the same 413 deployable website/Worker source, public asset, runtime configuration, and canonical migration/schema paths as the previous certified production baseline. Tests, KomoControl desktop-only source, generated output, backups, local databases, installers, caches, logs, and secrets are excluded.
