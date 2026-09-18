import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import {
  OrganizationUserAuthError,
  OrganizationUserAuthAuthority,
  type NewOrganizationUserSessionRecord,
  type OrganizationUserAuthStore,
  type OrganizationUserRecord,
  type OrganizationUserSessionRecord,
} from "@/services/organization-user-auth-core";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type UserRow = {
  id: string;
  email: string;
  normalized_email: string;
  status: "active" | "disabled";
  is_super_admin: number;
  password_hash: string | null;
  credential_version: number | null;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  token_hash: string;
  session_credential_version: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  email: string;
  normalized_email: string;
  user_status: "active" | "disabled";
  is_super_admin: number;
  password_hash: string;
  current_credential_version: number;
};

function toUser(row: UserRow): OrganizationUserRecord {
  return {
    id: row.id,
    email: row.email,
    normalizedEmail: row.normalized_email,
    status: row.status,
    isSuperAdmin: row.is_super_admin === 1,
    passwordHash: row.password_hash,
    credentialVersion: row.credential_version,
  };
}

async function organizationUserDatabase(): Promise<D1DatabaseBinding> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) {
    throw new Error("Organization-user authentication database is unavailable.");
  }
  return environment.NEWS_DB;
}

export function createRevokeAllOrganizationUserSessionsStatement(
  database: D1DatabaseBinding,
  userId: string,
  revokedAt: string,
) {
  return database.prepare(`UPDATE league_user_sessions
    SET revoked_at = COALESCE(revoked_at, ?)
    WHERE user_id = ?`).bind(revokedAt, userId);
}

export function createRevokeSessionsWithoutActiveMembershipsStatement(
  database: D1DatabaseBinding,
  userId: string,
  revokedAt: string,
) {
  return database.prepare(`UPDATE league_user_sessions
    SET revoked_at = COALESCE(revoked_at, ?)
    WHERE user_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM league_organization_memberships membership
        WHERE membership.user_id = ? AND membership.status = 'active'
      )`).bind(revokedAt, userId, userId);
}

export class D1OrganizationUserAuthStore implements OrganizationUserAuthStore {
  constructor(private readonly database: D1DatabaseBinding) {}

  async findUserById(userId: string): Promise<OrganizationUserRecord | null> {
    const row = await this.database.prepare(`SELECT u.id, u.email, u.normalized_email,
      u.status, u.is_super_admin, c.password_hash, c.credential_version
      FROM league_app_users u
      LEFT JOIN league_user_credentials c ON c.user_id = u.id
      WHERE u.id = ?`).bind(userId).first<UserRow>();
    return row ? toUser(row) : null;
  }

  async setCredentialAndRevokeSessions(input: {
    userId: string;
    passwordHash: string;
    changedAt: string;
  }): Promise<OrganizationUserRecord | null> {
    await this.database.batch([
      this.database.prepare(`INSERT INTO league_user_credentials
        (user_id, password_hash, credential_version, password_set_at, updated_at)
        SELECT u.id, ?, 1, ?, ?
        FROM league_app_users u
        WHERE u.id = ? AND u.is_super_admin = 0
        ON CONFLICT(user_id) DO UPDATE SET
          password_hash = excluded.password_hash,
          credential_version = league_user_credentials.credential_version + 1,
          password_set_at = excluded.password_set_at,
          updated_at = excluded.updated_at
        WHERE EXISTS (
          SELECT 1 FROM league_app_users current_user
          WHERE current_user.id = excluded.user_id
            AND current_user.is_super_admin = 0
        )`).bind(input.passwordHash, input.changedAt, input.changedAt, input.userId),
      this.database.prepare(`UPDATE league_user_sessions
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE user_id = ?
          AND EXISTS (
            SELECT 1
            FROM league_user_credentials credential
            JOIN league_app_users current_user ON current_user.id = credential.user_id
            WHERE credential.user_id = ?
              AND credential.password_hash = ?
              AND current_user.is_super_admin = 0
          )`).bind(input.changedAt, input.userId, input.userId, input.passwordHash),
    ]);

    return this.findUserById(input.userId);
  }

  async createSession(session: NewOrganizationUserSessionRecord): Promise<void> {
    await this.database.prepare(`INSERT INTO league_user_sessions
      (id, user_id, token_hash, credential_version, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(
      session.id,
      session.userId,
      session.tokenHash,
      session.credentialVersion,
      session.createdAt,
      session.expiresAt,
    ).run();
  }

  async findSessionByTokenHash(tokenHash: string): Promise<OrganizationUserSessionRecord | null> {
    const row = await this.database.prepare(`SELECT s.id AS session_id, s.user_id, s.token_hash,
      s.credential_version AS session_credential_version, s.created_at, s.expires_at, s.revoked_at,
      u.email, u.normalized_email, u.status AS user_status, u.is_super_admin,
      c.password_hash, c.credential_version AS current_credential_version
      FROM league_user_sessions s
      JOIN league_app_users u ON u.id = s.user_id
      JOIN league_user_credentials c ON c.user_id = s.user_id
      WHERE s.token_hash = ?`).bind(tokenHash).first<SessionRow>();
    if (!row) return null;
    return {
      id: row.session_id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      credentialVersion: row.session_credential_version,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      user: {
        id: row.user_id,
        email: row.email,
        normalizedEmail: row.normalized_email,
        status: row.user_status,
        isSuperAdmin: row.is_super_admin === 1,
        passwordHash: row.password_hash,
        credentialVersion: row.current_credential_version,
      },
    };
  }

  async revokeSessionById(sessionId: string, revokedAt: string): Promise<void> {
    await this.database.prepare(`UPDATE league_user_sessions
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE id = ?`).bind(revokedAt, sessionId).run();
  }

  async revokeAllSessionsByUserId(userId: string, revokedAt: string): Promise<void> {
    await createRevokeAllOrganizationUserSessionsStatement(
      this.database,
      userId,
      revokedAt,
    ).run();
  }
}

async function authority(): Promise<OrganizationUserAuthAuthority> {
  return new OrganizationUserAuthAuthority(
    new D1OrganizationUserAuthStore(await organizationUserDatabase()),
  );
}

export async function setOrganizationUserPassword(userId: string, password: string) {
  return (await authority()).setPassword(userId, password);
}

export async function getOrganizationUserCredentialStatus(userId: string) {
  const id = userId.trim();
  if (!id) throw new OrganizationUserAuthError("USER_NOT_FOUND", 404);
  const database = await organizationUserDatabase();
  const row = await database.prepare(`SELECT u.id, u.is_super_admin,
    CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS credential_configured,
    c.password_set_at
    FROM league_app_users u
    LEFT JOIN league_user_credentials c ON c.user_id = u.id
    WHERE u.id = ?`).bind(id).first<{
    id: string;
    is_super_admin: number;
    credential_configured: number;
    password_set_at: string | null;
  }>();
  if (!row) throw new OrganizationUserAuthError("USER_NOT_FOUND", 404);
  if (row.is_super_admin === 1) {
    throw new OrganizationUserAuthError("SUPER_ADMIN_FORBIDDEN", 403);
  }
  return {
    userId: row.id,
    credentialConfigured: row.credential_configured === 1,
    passwordSetAt: row.password_set_at,
  };
}

export async function verifyOrganizationUserCredential(userId: string, password: string) {
  return (await authority()).verifyCredential(userId, password);
}

export async function createOrganizationUserSession(userId: string) {
  return (await authority()).createSession(userId);
}

export async function resolveOrganizationUserSession(rawToken: string) {
  return (await authority()).resolveSession(rawToken);
}

export async function revokeOrganizationUserSession(sessionId: string) {
  await (await authority()).revokeSession(sessionId);
}

export async function revokeAllOrganizationUserSessions(userId: string) {
  await (await authority()).revokeAllSessions(userId);
}

export function organizationUserAuthErrorResponse(error: unknown): Response | null {
  if (!(error instanceof OrganizationUserAuthError)) return null;
  const messages: Record<OrganizationUserAuthError["code"], string> = {
    PASSWORD_INVALID: "Ο κωδικός πρέπει να περιέχει από 10 έως 128 χαρακτήρες.",
    USER_NOT_FOUND: "Ο χρήστης δεν βρέθηκε.",
    SUPER_ADMIN_FORBIDDEN: "Ο Super Admin δεν χρησιμοποιεί κωδικό χρήστη Οργανισμού.",
    CREDENTIAL_REQUIRED: "Δεν έχει οριστεί κωδικός για τον χρήστη.",
    CREDENTIAL_WRITE_FAILED: "Η αποθήκευση του κωδικού απέτυχε.",
    SESSION_INVALID: "Η συνεδρία χρήστη δεν είναι έγκυρη.",
  };
  return Response.json(
    { code: error.code, error: messages[error.code] },
    { status: error.status },
  );
}
