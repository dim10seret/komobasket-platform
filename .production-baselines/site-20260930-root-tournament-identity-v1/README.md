# Root Tournament Identity v1 production baseline

Source: 4a2a5725a05b50a598e9aa68ca6d42e1619736de
Deployment: 43e5c555-85b4-4a6b-a4ab-ac5c887de346
Version: 1ef03ea3-f623-490b-b74e-982b4036bc9c
Traffic: 100%
Annotated tag: production-site-20260930-root-tournament-identity-v1 (targets source commit)
Previous canonical baseline: production-site-20260926-organization-site-cover-v1

## Release
Only migration 0038 was applied. Production moved from 37 applied / 0 pending to 38 applied / 0 pending. No migration 0039 exists.

## D1
quick_check=ok; foreign-key violations=0. league_phases.tournament_name is nullable TEXT. Existing rows remain NULL by design; no backfill was performed. Organization, competition, phase, game and roster-membership counts were unchanged.

## Validation
Retained certified results: focused Admin/Root 24/24; Root Tournament 160/160; site-only 925/925; canonical Node 44/44; TypeScript, Next and OpenNext PASS. No certified source changed afterward.

## Production smoke
Public competition, Program/Results, standings, statistics, hosted homepage, single-root fallback, desktop and 390px PASS. Authenticated Admin Platform, competition and phase loading, root/descendant grouping, NULL-name fallback, Add Phase predecessor context and Καμία root UI PASS. No Admin save or production data fixture was created. Cloudflare Access remained active.

## Source inventory
Manifest entries: 427. Independently recomputed: 427. Missing/malformed/duplicate/hash/source-commit mismatch counts: 0. Manifest SHA-256: b05a6be11052c0428de361e13ae4c2f006a37b0d3f478999c272c60902065b33. This is a source integrity checkpoint, not a cryptographic claim of Worker-bundle equivalence.

## Exact certified delta
- cloudflare/league-schema.sql
- cloudflare/migrations/0038_phase_tournament_name.sql
- src/app/(central)/stats/page.tsx
- src/app/(hosted)/[organizationSlug]/statistics/page.tsx
- src/components/admin/platform/sections/CompetitionSection.tsx
- src/components/competition/PublicCompetitionStatistics.tsx
- src/components/competition/PublicCompetitionsView.tsx
- src/components/hosted/HostedOrganizationHomeData.tsx
- src/lib/phase-root-source.ts
- src/lib/public-competition-statistics.ts
- src/services/league-admin.service.ts
- src/services/public-competition-statistics.service.ts
- src/services/public-competition.service.ts
- src/components/competition/PublicCompetitionStatistics.test.ts
- src/components/competition/public-competition-program-results.test.mjs
- src/components/hosted/hosted-organization-statistics-home.test.mjs
- src/components/admin/platform/sections/root-tournament-identity.test.mjs
- src/lib/phase-root-source.test.ts
- src/lib/public-competition-statistics.test.ts
- src/services/public-competition-statistics.organization.test.mjs
- src/services/public-competition.organization.test.mjs
- src/services/root-tournament-identity.test.ts

## Exclusions
- .tmp_phase1b_font/
- komocontrol/demo/
- komocontrol/electron/demo/
- komocontrol/src/demo/
- output/
- scripts/benchmark-organization-user-local.mjs
