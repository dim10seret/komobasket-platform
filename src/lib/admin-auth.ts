import { createRemoteJWKSet, jwtVerify } from "jose";
import { resolveCanonicalAppUser, type CanonicalAppUser } from "@/lib/app-user-identity";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import {
  platformAuthorizationErrorResponse,
  requirePlatformSuperAdmin,
} from "@/lib/platform-authorization";

const LOCAL_ADMIN_EMAIL = "local-admin@komobasket.gr";
const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

const remoteJwksByUrl = new Map<string, RemoteJwks>();

export type AdminIdentity = {
  email: string;
  isLocal: boolean;
};

type CloudflareAccessConfiguration = {
  audience: string;
  issuer: string;
  jwksUrl: string;
};

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeTeamDomain(value: string | null | undefined) {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/$/, "");
  if (!normalized || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(normalized)) {
    return null;
  }
  return normalized;
}

async function getCloudflareAccessConfiguration(): Promise<CloudflareAccessConfiguration | null> {
  const env = await getKomoBasketCloudflareEnv();
  const teamDomain = normalizeTeamDomain(
    process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN
      ?? env?.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
  );
  const audience = (
    process.env.CLOUDFLARE_ACCESS_AUD
      ?? env?.CLOUDFLARE_ACCESS_AUD
      ?? ""
  ).trim();
  if (!teamDomain || !audience) return null;

  const issuer = `https://${teamDomain}`;
  return {
    audience,
    issuer,
    jwksUrl: `${issuer}/cdn-cgi/access/certs`,
  };
}

function getRemoteJwks(url: string) {
  const cached = remoteJwksByUrl.get(url);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(new URL(url), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  remoteJwksByUrl.set(url, jwks);
  return jwks;
}

async function getVerifiedAccessIdentity(request: Request): Promise<AdminIdentity | null> {
  const token = request.headers.get(ACCESS_JWT_HEADER)?.trim();
  if (!token) return null;

  const configuration = await getCloudflareAccessConfiguration();
  if (!configuration) return null;

  try {
    const { payload } = await jwtVerify(
      token,
      getRemoteJwks(configuration.jwksUrl),
      {
        algorithms: ["RS256"],
        issuer: configuration.issuer,
        audience: configuration.audience,
      },
    );
    const email = normalizeEmail(
      typeof payload.email === "string" ? payload.email : null,
    );
    if (!email) return null;

    const forwardedEmail = normalizeEmail(request.headers.get(ACCESS_EMAIL_HEADER));
    if (forwardedEmail && forwardedEmail !== email) return null;

    return { email, isLocal: false };
  } catch {
    return null;
  }
}

export async function getAdminIdentity(request: Request): Promise<AdminIdentity | null> {
  if (process.env.NODE_ENV !== "production") {
    return {
      email: normalizeEmail(process.env.ADMIN_EMAIL) || LOCAL_ADMIN_EMAIL,
      isLocal: true,
    };
  }

  return getVerifiedAccessIdentity(request);
}

function unauthenticatedResponse() {
  return Response.json(
    { error: "Δεν έχετε πρόσβαση στη διαχείριση της Πλατφόρμας." },
    { status: 401 },
  );
}

function canonicalIdentityResponse() {
  return Response.json(
    { error: "Η πιστοποιημένη ταυτότητα δεν έχει ενεργή πρόσβαση στην Πλατφόρμα." },
    { status: 403 },
  );
}

export async function requireAdmin(request: Request) {
  const identity = await getAdminIdentity(request);
  if (!identity) {
    return {
      identity: null,
      user: null,
      response: unauthenticatedResponse(),
    } as const;
  }

  try {
    const user = await resolveCanonicalAppUser(identity);
    return { identity, user, response: null } as const;
  } catch {
    return {
      identity: null,
      user: null,
      response: canonicalIdentityResponse(),
    } as const;
  }
}

export async function requirePlatformSuperAdminRequest(request: Request) {
  const authorization = await requireAdmin(request);
  if (authorization.response) return authorization;

  try {
    await requirePlatformSuperAdmin(authorization.user);
    return authorization;
  } catch (error) {
    return {
      identity: null,
      user: null,
      response:
        platformAuthorizationErrorResponse(error)
        ?? canonicalIdentityResponse(),
    } as const;
  }
}

export type AuthenticatedAdmin = {
  identity: AdminIdentity;
  user: CanonicalAppUser;
};
