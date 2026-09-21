# KomoBasket Production Site Baseline - Meta Legal Pages

This checkpoint records the live public legal pages after the single approved production deployment.

## Production identity

- Deployment: `cb4fbb91-b736-4fd5-9ddf-b74bc3b513c2`
- Version: `10c69a1e-10f3-460b-ad33-164c41d1b97f`
- Traffic: `100%`
- Source commit: `9d214b4d9c15dd886ce07400b47f751e43bb0340`
- Annotated tag: `production-site-20260921-meta-legal-pages` (targets the source commit)
- Previous baseline: `production-site-20260920-sync-diagnostics`
- D1: `34 applied / 0 pending`; `quick_check = ok`; `FK violations = 0`

## Exact approved source delta

- `src/app/(central)/privacy/page.tsx`
- `src/app/(central)/terms/page.tsx`
- `src/app/(central)/data-deletion/page.tsx`
- `src/components/layout/SupportersFooter.tsx`
- `src/components/layout/route-layout-boundary.test.ts`

The public URLs `/privacy`, `/terms`, and `/data-deletion` returned HTTP 200 without login. All three footer links and the approved Greek content were present. Public site and user routes remained available; Admin routes remained Cloudflare Access protected. No Facebook publishing mutation was triggered during smoke.

## Validation

- Focused legal/layout tests: `4/4 PASS`
- Site regressions: `815/815 PASS` (`771` Vitest + `44` Node)
- TypeScript: `PASS`
- Next production build: `PASS`
- OpenNext build: `PASS`
- Local and production anonymous GET smoke: `PASS`

No D1 migration or D1 write was performed by this release. No auth, Facebook API, Meta config, Cloudflare Access, DNS, R2/Images config, or KomoControl desktop change was made.

## Manifest scope

`site-source-sha256.txt` independently hashes the previous 413 deployable website/Worker source, public asset, runtime configuration, and migration/schema paths plus the three new public page files. Tests, desktop-only source, generated output, backups, local databases, caches, logs, and secrets are excluded.
