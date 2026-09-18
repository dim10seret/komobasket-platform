import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCloudflareEnv: vi.fn(),
  resolveCanonicalAppUser: vi.fn(),
  requirePlatformSuperAdmin: vi.fn(),
}));

vi.mock("@/lib/cloudflare", () => ({
  getKomoBasketCloudflareEnv: mocks.getCloudflareEnv,
}));
vi.mock("@/lib/app-user-identity", () => ({
  resolveCanonicalAppUser: mocks.resolveCanonicalAppUser,
}));
vi.mock("@/lib/platform-authorization", () => ({
  requirePlatformSuperAdmin: mocks.requirePlatformSuperAdmin,
  platformAuthorizationErrorResponse: () => null,
}));

import { getAdminIdentity, requireAdmin } from "@/lib/admin-auth";

const teamDomain = "auth-test.cloudflareaccess.com";
const issuer = `https://${teamDomain}`;
const audience = "test-access-audience";
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let privateKey: SigningKey;
let invalidPrivateKey: SigningKey;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

async function token(input: {
  email?: string;
  signingKey?: SigningKey;
  tokenIssuer?: string;
  tokenAudience?: string;
  expiresAt?: number;
  notBefore?: number;
} = {}) {
  const now = Math.floor(Date.now() / 1_000);
  let jwt = new SignJWT({ email: input.email ?? "admin@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "access-test-key" })
    .setIssuer(input.tokenIssuer ?? issuer)
    .setAudience(input.tokenAudience ?? audience)
    .setIssuedAt(now)
    .setExpirationTime(input.expiresAt ?? now + 300);
  if (input.notBefore !== undefined) jwt = jwt.setNotBefore(input.notBefore);
  return jwt.sign(input.signingKey ?? privateKey);
}

function request(jwt?: string, rawEmail?: string) {
  const headers = new Headers();
  if (jwt) headers.set("cf-access-jwt-assertion", jwt);
  if (rawEmail) headers.set("cf-access-authenticated-user-email", rawEmail);
  return new Request("https://komobasket.gr/api/admin/league", { headers });
}

describe.sequential("verified Cloudflare Access admin identity", () => {
  beforeAll(async () => {
    const valid = await generateKeyPair("RS256");
    const invalid = await generateKeyPair("RS256");
    privateKey = valid.privateKey;
    invalidPrivateKey = invalid.privateKey;
    publicJwk = await exportJWK(valid.publicKey);
    publicJwk.kid = "access-test-key";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
  });

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", teamDomain);
    vi.stubEnv("CLOUDFLARE_ACCESS_AUD", audience);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [publicJwk] })));
    mocks.getCloudflareEnv.mockResolvedValue(null);
    mocks.resolveCanonicalAppUser.mockResolvedValue({
      userId: "app-user-admin",
      email: "admin@example.com",
      displayName: null,
      isSuperAdmin: true,
      isLocal: false,
    });
    mocks.requirePlatformSuperAdmin.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("accepts a valid signed JWT and sources normalized email from its payload", async () => {
    const identity = await getAdminIdentity(
      request(await token({ email: " Admin@Example.com " }), "admin@example.com"),
    );
    expect(identity).toEqual({ email: "admin@example.com", isLocal: false });
  });

  it("rejects a spoofed raw email when the JWT is missing", async () => {
    expect(await getAdminIdentity(request(undefined, "admin@example.com"))).toBeNull();
  });

  it("rejects an invalid signature even when the raw email matches", async () => {
    expect(await getAdminIdentity(request(
      await token({ signingKey: invalidPrivateKey }),
      "admin@example.com",
    ))).toBeNull();
  });

  it("rejects wrong audience, wrong issuer, expiration, and future not-before", async () => {
    const now = Math.floor(Date.now() / 1_000);
    expect(await getAdminIdentity(request(await token({ tokenAudience: "wrong" })))).toBeNull();
    expect(await getAdminIdentity(request(await token({ tokenIssuer: "https://wrong.cloudflareaccess.com" })))).toBeNull();
    expect(await getAdminIdentity(request(await token({ expiresAt: now - 60 })))).toBeNull();
    expect(await getAdminIdentity(request(await token({ notBefore: now + 60 })))).toBeNull();
  });

  it("rejects a raw email that disagrees with the verified payload", async () => {
    expect(await getAdminIdentity(request(
      await token({ email: "admin@example.com" }),
      "attacker@example.com",
    ))).toBeNull();
  });

  it("requires an active canonical user after Access verification", async () => {
    const validRequest = request(await token());
    expect((await requireAdmin(validRequest)).response).toBeNull();
    mocks.resolveCanonicalAppUser.mockRejectedValueOnce(new Error("unknown user"));
    expect((await requireAdmin(validRequest)).response?.status).toBe(403);
    mocks.resolveCanonicalAppUser.mockRejectedValueOnce(new Error("disabled user"));
    expect((await requireAdmin(validRequest)).response?.status).toBe(403);
  });

  it("preserves the intentional local development identity path", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_EMAIL", "Local.Admin@Example.com");
    expect(await getAdminIdentity(request())).toEqual({
      email: "local.admin@example.com",
      isLocal: true,
    });
  });
});
