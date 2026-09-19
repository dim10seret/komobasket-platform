# KomoBasket Production Site Baseline - Game Sheet v1

This checkpoint records the live KomoBasket production site after the successful deployment of the KomoBasket Game Sheet.

## Production identity

- Deployment: `0366509c-07b5-4d4d-8960-c3409de5b55a`
- Version: `2cf8a05d-5529-4db7-bde5-93cfbe766b31`
- Traffic: `100%`
- Previous production baseline: `production-site-20260918-root-phase`
- D1: `34 applied / 0 pending`
- D1 integrity: `quick_check = ok`, `FK violations = 0`

## Live Game Sheet behavior

- `ΦΥΛΛΟ ΑΓΩΝΑ KOMOBASKET`
- Authoritative, deterministic, read-only projection of finalized data
- Starter mark: BLUE X with RED circle
- Substitute first-entry marks
- Player foul marks
- Continuous BLUE halftime separator
- `ΦΑΟΥΛ ΠΕΡΙΟΔΟΥ` boxes
- Timeout boxes
- Free throw dot
- 2PT diagonal line
- 3PT diagonal line with circled scorer number
- Dynamic `regulationPeriods`
- Continuous red/blue period alternation through overtime
- Extended rosters above 12 players without truncation
- No FIBA/EOK certification claim

No database migration was required for this release.

## Manifest scope

`site-source-sha256.txt` contains deterministic SHA-256 hashes for the deployable KomoBasket website/Worker source, public assets, runtime configuration, and canonical migration/schema inputs required to reproduce this site release. Tests, KomoControl desktop-only source, generated output, backups, local databases, validation PDFs, installers, caches, logs, and secrets are excluded.