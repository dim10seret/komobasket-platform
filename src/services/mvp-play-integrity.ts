import "server-only";

import { importPKCS8, SignJWT } from "jose";

export const MVP_ANDROID_PACKAGE = "gr.komobasket.app";
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const DECODE_URL = `https://playintegrity.googleapis.com/v1/${MVP_ANDROID_PACKAGE}:decodeIntegrityToken`;
const SCOPE = "https://www.googleapis.com/auth/playintegrity";
const MAX_VERDICT_AGE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 15_000;

export class MvpIntegrityError extends Error {
  constructor(readonly code: "INTEGRITY_UNAVAILABLE" | "INTEGRITY_REJECTED") {
    super(code);
    this.name = "MvpIntegrityError";
  }
}

export type PlayIntegrityConfig = {
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  expectedCertificateSha256?: string;
};

type Verdict = {
  requestDetails?: { requestPackageName?: unknown; requestHash?: unknown; timestampMillis?: unknown };
  appIntegrity?: { appRecognitionVerdict?: unknown; packageName?: unknown; certificateSha256Digest?: unknown };
  deviceIntegrity?: { deviceRecognitionVerdict?: unknown };
};

export function validateStandardPlayVerdict(verdict: unknown, expectedRequestHash: string,
  expectedCertificateSha256: string, nowMs: number): void {
  const value = verdict as Verdict | null;
  const request = value?.requestDetails;
  const app = value?.appIntegrity;
  const device = value?.deviceIntegrity;
  const timestamp = typeof request?.timestampMillis === "string" && /^\d{13}$/.test(request.timestampMillis)
    ? Number(request.timestampMillis) : NaN;
  if (request?.requestPackageName !== MVP_ANDROID_PACKAGE || request.requestHash !== expectedRequestHash
    || !Number.isSafeInteger(timestamp) || timestamp > nowMs + MAX_FUTURE_SKEW_MS
    || nowMs - timestamp > MAX_VERDICT_AGE_MS
    || app?.packageName !== MVP_ANDROID_PACKAGE || app.appRecognitionVerdict !== "PLAY_RECOGNIZED"
    || !Array.isArray(app.certificateSha256Digest)
    || !app.certificateSha256Digest.includes(expectedCertificateSha256)
    || !Array.isArray(device?.deviceRecognitionVerdict)
    || !device.deviceRecognitionVerdict.includes("MEETS_DEVICE_INTEGRITY")) {
    throw new MvpIntegrityError("INTEGRITY_REJECTED");
  }
}

/** Only Google's authenticated decode response is passed to the verdict validator in runtime. */
export async function verifyStandardPlayIntegrity(token: string, expectedRequestHash: string,
  config: PlayIntegrityConfig, fetchImpl: typeof fetch = fetch, nowMs?: number): Promise<void> {
  if (!config.serviceAccountEmail || !config.serviceAccountPrivateKey || !config.expectedCertificateSha256) {
    throw new MvpIntegrityError("INTEGRITY_UNAVAILABLE");
  }
  if (typeof token !== "string" || token.length < 20 || token.length > 16_384
    || !/^[A-Za-z0-9._-]+$/.test(token) || !/^[0-9a-f]{64}$/.test(expectedRequestHash)) {
    throw new MvpIntegrityError("INTEGRITY_REJECTED");
  }
  try {
    const now = Math.floor((nowMs ?? Date.now()) / 1000);
    const key = await importPKCS8(config.serviceAccountPrivateKey.replaceAll("\\n", "\n"), "RS256");
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(config.serviceAccountEmail).setAudience(OAUTH_URL)
      .setIssuedAt(now).setExpirationTime(now + 300).sign(key);
    const oauth = await fetchImpl(OAUTH_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!oauth.ok) throw new MvpIntegrityError("INTEGRITY_UNAVAILABLE");
    const authorization: unknown = await oauth.json();
    const accessToken = (authorization as { access_token?: unknown })?.access_token;
    if (typeof accessToken !== "string" || !accessToken) throw new MvpIntegrityError("INTEGRITY_UNAVAILABLE");
    const decoded = await fetchImpl(DECODE_URL, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ integrity_token: token }), signal: AbortSignal.timeout(10_000),
    });
    if (!decoded.ok) throw new MvpIntegrityError("INTEGRITY_UNAVAILABLE");
    const response: unknown = await decoded.json();
    const payload = (response as { tokenPayloadExternal?: unknown })?.tokenPayloadExternal;
    validateStandardPlayVerdict(payload, expectedRequestHash, config.expectedCertificateSha256,
      nowMs ?? Date.now());
  } catch (error) {
    if (error instanceof MvpIntegrityError) throw error;
    throw new MvpIntegrityError("INTEGRITY_UNAVAILABLE");
  }
}
