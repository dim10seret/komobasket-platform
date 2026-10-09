import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { MVP_ANDROID_PACKAGE, MvpIntegrityError, validateStandardPlayVerdict,
  verifyStandardPlayIntegrity } from "./mvp-play-integrity";

const hash = "a".repeat(64);
const certificate = "synthetic-certificate-digest";
const now = Date.UTC(2026, 9, 9, 12);
const valid = () => ({
  requestDetails: { requestPackageName: MVP_ANDROID_PACKAGE, requestHash: hash, timestampMillis: String(now - 1000) },
  appIntegrity: { packageName: MVP_ANDROID_PACKAGE, appRecognitionVerdict: "PLAY_RECOGNIZED",
    certificateSha256Digest: [certificate] },
  deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
});

describe("Google Standard Play Integrity verifier", () => {
  it("rejects missing Google configuration before contacting Google", async () => {
    const fetcher = vi.fn();
    await expect(verifyStandardPlayIntegrity("synthetic-integrity-token", hash, {}, fetcher, now))
      .rejects.toMatchObject({ code: "INTEGRITY_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects wrong request binding, stale/future verdicts, package, app, certificate and device", () => {
    const mutations: Array<(value: ReturnType<typeof valid>) => void> = [
      (v) => { v.requestDetails.requestHash = "b".repeat(64); },
      (v) => { v.requestDetails.timestampMillis = String(now - 121_000); },
      (v) => { v.requestDetails.timestampMillis = String(now + 16_000); },
      (v) => { v.requestDetails.requestPackageName = "wrong.package"; },
      (v) => { v.appIntegrity.packageName = "wrong.package"; },
      (v) => { v.appIntegrity.appRecognitionVerdict = "UNRECOGNIZED_VERSION"; },
      (v) => { v.appIntegrity.certificateSha256Digest = ["other"]; },
      (v) => { v.deviceIntegrity.deviceRecognitionVerdict = []; },
    ];
    for (const mutate of mutations) {
      const value = valid(); mutate(value);
      expect(() => validateStandardPlayVerdict(value, hash, certificate, now)).toThrow(MvpIntegrityError);
    }
    expect(() => validateStandardPlayVerdict(valid(), hash, certificate, now)).not.toThrow();
  });

  it("uses signed OAuth and Google's decode endpoint, never a client-decoded verdict", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("grant_type=");
        return Response.json({ access_token: "synthetic-access-token" });
      }
      expect(String(url)).toBe(`https://playintegrity.googleapis.com/v1/${MVP_ANDROID_PACKAGE}:decodeIntegrityToken`);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer synthetic-access-token" });
      return Response.json({ tokenPayloadExternal: valid() });
    });
    await expect(verifyStandardPlayIntegrity("synthetic-integrity-token", hash, {
      serviceAccountEmail: "synthetic@example.iam.gserviceaccount.com",
      serviceAccountPrivateKey: pem, expectedCertificateSha256: certificate,
    }, fetcher as typeof fetch, now)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Google rejects decoding or returns no verified payload", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const config = { serviceAccountEmail: "synthetic@example.iam.gserviceaccount.com",
      serviceAccountPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      expectedCertificateSha256: certificate };
    for (const decoded of [new Response("no", { status: 401 }), Response.json({ verdict: valid() })]) {
      let calls = 0;
      const fetcher = vi.fn(async () => ++calls === 1
        ? Response.json({ access_token: "synthetic-access-token" }) : decoded);
      await expect(verifyStandardPlayIntegrity("synthetic-integrity-token", hash, config,
        fetcher as typeof fetch, now)).rejects.toBeInstanceOf(MvpIntegrityError);
    }
  });
});
