# MVP4A.2 authenticated Google MVP ballots

This local backend remains disabled unless both `MVP_GOOGLE_AUTH_ENABLED=enabled`
and the separate `MVP_GOOGLE_VOTING_ENABLED=enabled` are configured. Public MVP
read must also be enabled. Production must not enable Google voting until MVP4B
includes `mvp_google_votes` in every tally and finalization path.

`POST /api/public/v1/mvp-google-votes` accepts only JSON
`{"contestId":"...","candidateId":"..."}` (at most 4096 bytes). It requires a
valid Google voter session, the existing same-origin and CSRF header/cookie
proof, and a rate-limit allowance. A first accepted ballot returns HTTP 201
with `{data:{contestId,candidateId,acceptedAt,alreadyVoted:false}}`. Repeating
the same ballot returns HTTP 200 with `alreadyVoted:true`. A different choice
returns HTTP 409 `ALREADY_VOTED`; the original ballot is immutable. The client
never supplies or receives the internal voter ID.

`GET /api/public/v1/mvp-google-votes/me?contestId=...` returns only the
authenticated voter's `{data:{contestId,voted,candidateId}}` for a currently
public contest. It does not expose identities, other ballots, or totals.
Both responses and errors use `Cache-Control: no-store, private`.

The SQL insert itself checks the current session, public season, organization
and competition, phase enablement, app-poll status, candidate ownership, and
the database clock against the poll opening and closing timestamps. Migration
0043 supplies the unique `(contest_id,voter_id)` constraint, composite
candidate foreign key, and immutable-ballot triggers. No migration or existing
MVP tally was changed in MVP4A.2.
