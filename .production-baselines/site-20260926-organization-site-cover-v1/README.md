# Organization Site Cover v1 production baseline

Source: d9abb00aaac481b10ec599f4e25f25f36d09a4a1
Deployment: e624d1f4-9999-4704-978a-0060648abc92
Version: fcfb26ac-5e91-465d-b7a6-7d1102b40700
Traffic: 100%
Annotated tag: production-site-20260926-organization-site-cover-v1 (targets source commit)

## Provenance
Immediate previous live source: 74e5b97f7e571eafe647886802cd1ee0a09b7b08
Immediate previous live deployment: 75142a6c-a521-4060-b610-b6547cf21bef
Immediate previous live version: 2463f1c9-9e6a-439d-aa9c-70be6e7dc66f
Previous canonical baseline: production-site-20260925-platform-mvp-admin-results-v1
The newer live Current-Phase Series Summary release is preserved; the older canonical tag was not treated as the live deployment.

## Validation
Retained certified results: focused 111/111; site Vitest 898/898; canonical Node 13/13; TypeScript, Next and OpenNext PASS.
Real local browser upload, replacement, removal and default restoration PASS on homepage and competition hero, desktop and 390px.
No source/test edits or rebuild in this release pass. Existing certified OpenNext artifact deployed.

## D1
Only migration 0037 applied. Before: 36 applied / 1 pending. After: 37 applied / 0 pending.
quick_check=ok; foreign-key violations=0. All 63 existing business-table counts unchanged. Counts are sampled in small non-atomic read batches.
All five organization site_cover_url values remain NULL. No production branding or test data writes.

## Read-only production smoke
HTTP 200: /, /schedule, /stats, /competitions, /friendlymatches, /friendlymatches/competitions.
Organization Edit: Site cover default state and existing logo controls verified without saving.
Default heroes, navigation and responsive desktop/390px rendering PASS; no browser console errors.
Published Friendly Matches has no public competition/current phase. Its empty state was verified; populated series behavior is preserved by unchanged source/certified local tests.
Production upload / replace / remove: NOT PERFORMED BY DESIGN. The complete write cycle passed locally.

## Source inventory
Manifest entries: 426. Independently recomputed: 426. Missing/malformed/duplicate/hash mismatch counts: 0.
Current source matches deployed source commit via Git clean-filter object IDs. This is a source integrity checkpoint, not a cryptographic claim of Worker bundle equivalence.

## Exact committed release delta
- cloudflare/league-schema.sql
- cloudflare/migrations/0037_organization_site_cover.sql
- src/app/(hosted)/[organizationSlug]/competitions/games/[gameId]/live/page.tsx
- src/app/(hosted)/[organizationSlug]/competitions/games/[gameId]/page.tsx
- src/app/(hosted)/[organizationSlug]/competitions/page.tsx
- src/app/(hosted)/[organizationSlug]/contact/page.tsx
- src/app/(hosted)/[organizationSlug]/page.tsx
- src/app/(hosted)/[organizationSlug]/statistics/page.tsx
- src/app/(hosted)/[organizationSlug]/supporters/page.tsx
- src/app/api/admin/organization-site-cover/route.ts
- src/components/admin/platform/OrganizationPublicPageManagement.tsx
- src/components/admin/platform/OrganizationSiteCoverControl.tsx
- src/components/admin/platform/PlatformOrganizationManagement.tsx
- src/components/hosted/HostedOrganizationHero.tsx
- src/components/hosted/hosted-site-cover.test.tsx
- src/lib/admin-route-authorization.test.ts
- src/lib/hosted-public-url.ts
- src/lib/organization-platform-http.ts
- src/services/hosted-public-organization.service.ts
- src/services/organization-platform.test.ts
- src/services/organization-public-header-logo-operation.ts
- src/services/organization-site-cover.test.ts
- src/services/platform-management.service.ts
- src/services/supporters.organization.test.mjs

## Exclusions
.tmp_phase1b_font/, output/, scripts/benchmark-organization-user-local.mjs, generated build output, local DBs and secrets are not committed.
Worker and D1 credentials were isolated to their authorized operations. No force push or configuration changes.
