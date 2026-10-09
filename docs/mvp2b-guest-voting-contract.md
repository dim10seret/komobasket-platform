# MVP2B guest MVP voting backend (local only)

The new POST paths are `/api/public/v1/mvp-voting/challenge`, `/credential`, and `/vote`.
They return `Cache-Control: no-store`. They return 404 unless the Worker environment
explicitly sets `MVP_GUEST_VOTING_ENABLED=enabled`. No production configuration is
changed by MVP2B. The routes also fail closed without `NEWS_DB`, the existing
Cloudflare rate-limit binding, or all three Google settings below.

The required future Worker secrets/configuration are:

- `MVP_GOOGLE_SERVICE_ACCOUNT_EMAIL`: service account authorized for Play Integrity.
- `MVP_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: corresponding PKCS#8 PEM private key.
- `MVP_ANDROID_CERT_SHA256`: expected URL-safe base64 SHA-256 app signing certificate digest from the Play verdict.

No service-account identity, key, signing digest, or Google Cloud project number is
supplied or guessed in source. The Android client must use a Google Play Integrity
Standard token provider configured for the linked Google Cloud project. The server
exchanges a signed service-account JWT for an OAuth access token, calls Google's
`decodeIntegrityToken`, and checks the returned package, signing digest, app and
device verdicts, request hash, and timestamp. There is no local/test verifier in
the production route and no bypass flag.

## Android client flow

1. Generate an app-private, non-exportable P-256 signing key and retain it across
   app restarts. Export only its SPKI public key as unpadded base64url. A new key
   after reinstall is a new voting credential; one physical device is not
   guaranteed to equal one ballot.
2. POST to `/challenge` with `action="register"`, `contestId`, `candidateId`, and
   `publicKeySpki`. Receive `credentialId`, a 32-byte random base64url `challenge`,
   `requestHash`, `expiresAt`, and `protocolVersion=1`. The challenge is single-use
   and expires after 120 seconds. Only one unexpired challenge exists per key.
3. For registration, build the UTF-8 bytes of the following compact JSON array,
   with no extra whitespace and in exactly this order:

   `["komobasket-mvp-guest",1,"register",contestId,candidateId,credentialId,publicKeySha256,challenge]`

   `publicKeySha256` is lowercase hex SHA-256 of the DER SPKI bytes. Sign those
   bytes using ECDSA P-256/SHA-256. Send the 64-byte IEEE P-1363 `r || s`
   signature as unpadded base64url; convert Android's DER ECDSA signature to
   P-1363 if necessary. Compute/request the Play Integrity Standard token with
   `requestHash = lowercase hex SHA-256` of the same bytes. POST to `/credential`
   with `contestId`, `candidateId`, `credentialId`, `challenge`, `signature`, and
   `integrityToken`. The server independently recomputes all bindings.
4. For a vote, POST to `/challenge` with `action="vote"` and the same public key,
   chosen contest and candidate. Sign the corresponding array with `"vote"` as
   the action, obtain a fresh Play Integrity token bound to its request hash, and
   POST the same proof fields to `/vote`. The response contains the accepted
   ballot receipt or a safe error. Accepted votes cannot be changed.

The client must not present a UUID, IP address, or Play token alone as voter
identity. The server verifies possession of the recognized private key and a
Google-verified integrity verdict before invoking the existing guarded MVP2A
vote insertion. A challenge issue request can never itself accept a vote.

## Remaining activation requirements

- Apply migration 0042 only through a separately approved production migration.
- Provision and independently verify the Google Play-linked service account,
  Android app signing digest and Worker secrets, then explicitly approve the
  feature flag. A real Play-distributed app and physical device must exercise
  genuine verdicts before activation. Emulators generally do not satisfy the
  required `MEETS_DEVICE_INTEGRITY` policy.
- Build and verify the native Android flow in a separate phase.
- Complete MVP2C lazy finalization and public result publication separately.
- Future iOS support uses the same credential/vote tables but needs App Attest
  attestation, signed assertions, and monotonically increasing counters. No iOS
  route or verifier is implemented here.

Hidden `after_close` results contain no intermediate candidate counts, totals,
percentages, or leaders. Operator statistics and public results APIs are outside
MVP2B.
