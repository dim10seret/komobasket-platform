# MVP4A.1 public Google voter authentication

This local foundation creates no vote endpoint or public voting page. `MVP_GOOGLE_AUTH_ENABLED`
must equal `enabled`; missing configuration fails closed. It is independent of
`MVP_PUBLIC_READ_ENABLED` and `MVP_GUEST_VOTING_ENABLED`.

The fixed callback is `/api/public/v1/mvp-google-auth/callback`. Start accepts only a
canonical local path matching `/mvp/competitions/{competitionId}/tournaments/{rootPhaseId}/contests/{contestId}`.
The server creates a random state token, nonce, and PKCE S256 verifier. A short-lived
`login` row in `mvp_google_sessions` holds the hash of state and the other values.
The callback matches the browser's state cookie, atomically deletes that row, exchanges
the code server-side, and verifies Google's signed ID token. A failed attempt requires
a new start; state cannot be reused.

The verified `iss` and `sub` are HMAC-SHA-256 digested with `MVP_GOOGLE_SUB_HMAC_KEY`.
Only the digest and a random internal voter ID are retained. Do not rotate this key
without a planned identity migration: changing it otherwise creates new voter
identities and can defeat the future one-vote-per-account constraint. Never log the
secret, `sub`, authorization code, or ID token. Email, profile, Google access tokens,
and refresh tokens are not stored.

Required server-only configuration, when this feature is later authorized:

- `MVP_GOOGLE_AUTH_ENABLED=enabled`
- `MVP_GOOGLE_CLIENT_ID`: Google Web OAuth client ID
- `MVP_GOOGLE_CLIENT_SECRET`: Google Web OAuth client secret
- `MVP_GOOGLE_REDIRECT_URI`: exact HTTPS production callback, or matching localhost
  callback in a local development environment
- `MVP_GOOGLE_SUB_HMAC_KEY`: independently generated 32-byte base64url key
- `NEWS_DB` and `USER_LOGIN_RATE_LIMITER` bindings

The public voter cookie is separate from staff cookies. Production cookies are
host-only, `Secure`, `HttpOnly`, and `SameSite=Lax`. Only non-production localhost
HTTP uses local cookie names without `Secure`. A random session token is stored only
as a SHA-256 hash in D1. The session endpoint checks expiry/revocation and returns
an authenticated Boolean plus a CSRF token. Logout requires exact Origin,
same-origin fetch metadata when present, and the CSRF header/cookie match; it revokes
the D1 session. Future vote writes must use the same protection.

Migration 0043 is additive and follows committed 0042. The Google ballot table is
fully constrained but has no write route in this stage. Applying 0042/0043 or
activating any feature flag in production requires separate authorization.
