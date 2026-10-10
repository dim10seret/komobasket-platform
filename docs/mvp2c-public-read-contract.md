# MVP2C public MVP read

`GET /api/public/v1/competitions/{competitionId}/tournaments/{rootPhaseId}/mvp`

The route is disabled unless `MVP_PUBLIC_READ_ENABLED=enabled`. It also requires the `NEWS_DB` binding and migrations 0041 and 0042. The organization ID is derived from the public competition detail; callers cannot supply it as authority. It returns `404` when the competition or canonical tournament is not currently public and mutually consistent with that organization. Every response has `Cache-Control: no-store` so the next real read after a deadline can reconcile expired contests.

The success body is `{ data: { organizationId, competitionId, rootPhaseId, serverTime, active, history } }`. `active` contains open polls; `history` contains finalized polls and polls awaiting operator resolution. Each entry carries the canonical phase and round or series matchup identity, opens/closes times, status, candidate snapshots, and an `official` object only after finalization. `serverTime`, `opensAt`, `closesAt`, and `finalizedAt` are Unix seconds. The client countdown is informational; the database enforces the deadline.

`after_close` contests return `resultsVisibility: "hidden"`, `totalVotes: null`, and `votes: null` for every candidate until finalized. `live` contests expose counts. Finalized contests expose the same winner publication to App and Website clients. The winner's PTS/REB/AST/EFF are the stored supporting **game** snapshot, including for a Series MVP; they are not aggregate series totals.

The GET calls lazy reconciliation. A unique vote leader finalizes automatically. A first-place tie or zero votes enters an operator decision state. An internal authorized service, `resolveMvpContestWithDb`, resolves only those two states and records the actor, time, and reason in `league_audit_log`. No public resolution operation, scheduled job, or UI is introduced here.

The existing C1 Official Matchday MVP route and DTO remain unchanged. A finalized round poll creates its existing `league_matchday_mvp_selections` record in the same transaction as the contest finalization. Production enablement and migration 0042 require separate approval.
