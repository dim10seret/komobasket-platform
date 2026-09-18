import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import {
  OrganizationUserAuthAuthority,
  OrganizationUserAuthError,
  hashOrganizationUserSessionToken,
  verifyOrganizationUserPassword,
  type NewOrganizationUserSessionRecord,
  type OrganizationUserRecord,
} from "@/services/organization-user-auth-core";
import { D1OrganizationUserAuthStore } from "@/services/organization-user-auth.service";
import type { D1DatabaseBinding, KomoBasketCloudflareEnv } from "@/types/cloudflare";
import type { OrganizationUserIdentity, UserOrganizationMembership } from "@/types/organization-user";

export class UserLoginError extends Error {
  constructor(readonly code: "INVALID_CREDENTIALS" | "NO_MEMBERSHIP" | "FORBIDDEN" | "RATE_LIMITED" | "AUTH_UNAVAILABLE", readonly status: number) {
    super(code);
  }
}

// Bind session issuance to the credential actually verified, not a concurrent reset.
class VerifiedCredentialStore extends D1OrganizationUserAuthStore {
  constructor(private readonly db: D1DatabaseBinding, private readonly verified: OrganizationUserRecord) {
    super(db);
  }

  override async createSession(session: NewOrganizationUserSessionRecord): Promise<void> {
    const created = await this.db.prepare(`INSERT INTO league_user_sessions
      (id, user_id, token_hash, credential_version, created_at, expires_at)
      SELECT ?, u.id, ?, c.credential_version, ?, ?
      FROM league_app_users u JOIN league_user_credentials c ON c.user_id = u.id
      WHERE u.id = ? AND u.status = 'active' AND u.is_super_admin = 0
        AND u.normalized_email = ? AND c.password_hash = ? AND c.credential_version = ?
        AND EXISTS (
          SELECT 1 FROM league_organization_memberships m
          JOIN league_organizations o ON o.id = m.organization_id
          WHERE m.user_id = u.id AND m.status = 'active' AND o.status = 'active'
            AND m.role IN ('admin', 'viewer')
        )
      RETURNING id`).bind(
      session.id, session.tokenHash, session.createdAt, session.expiresAt,
      this.verified.id, this.verified.normalizedEmail, this.verified.passwordHash,
      this.verified.credentialVersion,
    ).first<{ id: string }>();
    if (!created) throw new UserLoginError("INVALID_CREDENTIALS", 401);
  }
}

export class OrganizationUserLoginService {
  private readonly store: D1OrganizationUserAuthStore;
  private readonly authority: OrganizationUserAuthAuthority;

  constructor(private readonly db: D1DatabaseBinding, private readonly limiter: KomoBasketCloudflareEnv["USER_LOGIN_RATE_LIMITER"]) {
    this.store = new D1OrganizationUserAuthStore(db);
    this.authority = new OrganizationUserAuthAuthority(this.store);
  }

  private async memberships(userId: string): Promise<UserOrganizationMembership[]> {
    const result = await this.db.prepare(`SELECT o.id, o.name, o.logo_url, m.role
      FROM league_organization_memberships m
      JOIN league_organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
        AND m.role IN ('admin', 'viewer')
      ORDER BY o.name, o.id`).bind(userId).all<{
      id: string; name: string; logo_url: string | null; role: "admin" | "viewer";
    }>();
    return (result.results ?? []).map((row) => ({
      organizationId: row.id, organizationName: row.name, logoUrl: row.logo_url, role: row.role,
    }));
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!this.limiter) throw new UserLoginError("AUTH_UNAVAILABLE", 503);
    let allowed: boolean;
    try {
      allowed = (await this.limiter.limit({ key: await hashOrganizationUserSessionToken(normalizedEmail) })).success;
    } catch {
      throw new UserLoginError("AUTH_UNAVAILABLE", 503);
    }
    if (!allowed) throw new UserLoginError("RATE_LIMITED", 429);

    const row = await this.db.prepare(`SELECT id FROM league_app_users WHERE normalized_email = ?`)
      .bind(normalizedEmail).first<{ id: string }>();
    const user = row ? await this.store.findUserById(row.id) : null;
    if (!user || user.status !== "active" || user.isSuperAdmin || !user.passwordHash
      || !await verifyOrganizationUserPassword(password, user.passwordHash)) {
      throw new UserLoginError("INVALID_CREDENTIALS", 401);
    }
    if (!(await this.memberships(user.id)).length) throw new UserLoginError("NO_MEMBERSHIP", 403);
    const authority = new OrganizationUserAuthAuthority(new VerifiedCredentialStore(this.db, user));
    const session = await authority.createSession(user.id);
    const identity = await this.resolve(session.token);
    return { identity, session };
  }

  async resolve(token: string): Promise<OrganizationUserIdentity> {
    const session = await this.authority.resolveSession(token);
    const memberships = await this.memberships(session.userId);
    if (!memberships.length) throw new UserLoginError("NO_MEMBERSHIP", 403);
    const user = await this.db.prepare(`SELECT display_name FROM league_app_users WHERE id = ?`)
      .bind(session.userId).first<{ display_name: string | null }>();
    return {
      user: { id: session.userId, email: session.email, displayName: user?.display_name ?? null },
      memberships,
    };
  }

  async requireOrganization(token: string, organizationId: string, mode: "read" | "manage" = "read") {
    const identity = await this.resolve(token);
    const membership = identity.memberships.find((item) => item.organizationId === organizationId);
    if (!membership || (mode === "manage" && membership.role !== "admin")) {
      throw new UserLoginError("FORBIDDEN", 403);
    }
    return { identity, membership };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    try {
      const session = await this.authority.resolveSession(token);
      await this.authority.revokeSession(session.sessionId);
    } catch (error) {
      if (!(error instanceof OrganizationUserAuthError && error.code === "SESSION_INVALID")) throw error;
    }
  }
}

export async function organizationUserLoginService() {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_DB) throw new UserLoginError("AUTH_UNAVAILABLE", 503);
  return new OrganizationUserLoginService(env.NEWS_DB, env.USER_LOGIN_RATE_LIMITER);
}
