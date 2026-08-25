import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";
import {
  ScorerAuthError,
  ScorerSessionAuthority,
  type LoginInput,
  type NewSessionRecord,
  type ScorerAuthStore,
  type ScorerRecord,
  type SessionRecord,
} from "@/services/komocontrol-scorer-auth-core";

type ScorerRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  username: string;
  normalized_username: string;
  password_hash: string;
  status: "active" | "disabled";
  credential_version: number;
};

type SessionRow = {
  session_id: string;
  scorer_id: string;
  token_hash: string;
  session_credential_version: number;
  device_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  organization_id: string;
  organization_name: string;
  username: string;
  normalized_username: string;
  scorer_status: "active" | "disabled";
  scorer_credential_version: number;
};

async function scorerDatabase(): Promise<D1DatabaseBinding> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("KomoControl scorer authentication database is unavailable.");
  return environment.NEWS_DB;
}

class D1ScorerAuthStore implements ScorerAuthStore {
  constructor(private readonly database: D1DatabaseBinding) {}

  async findScorerByNormalizedUsername(normalizedUsername: string): Promise<ScorerRecord | null> {
    const row = await this.database.prepare(`SELECT s.id, s.organization_id, o.name AS organization_name,
      s.username, s.normalized_username, s.password_hash, s.status, s.credential_version
      FROM league_komocontrol_scorers s
      JOIN league_organizations o ON o.id = s.organization_id
      WHERE s.normalized_username = ?`).bind(normalizedUsername).first<ScorerRow>();
    return row ? {
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      username: row.username,
      normalizedUsername: row.normalized_username,
      passwordHash: row.password_hash,
      status: row.status,
      credentialVersion: row.credential_version,
    } : null;
  }

  async createSession(session: NewSessionRecord): Promise<void> {
    await this.database.prepare(`INSERT INTO league_komocontrol_scorer_sessions
      (id, scorer_id, token_hash, credential_version, device_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(session.id, session.scorerId, session.tokenHash, session.credentialVersion, session.deviceId, session.createdAt, session.expiresAt)
      .run();
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.database.prepare(`SELECT ss.id AS session_id, ss.scorer_id, ss.token_hash,
      ss.credential_version AS session_credential_version, ss.device_id, ss.created_at, ss.expires_at, ss.revoked_at,
      s.organization_id, o.name AS organization_name, s.username, s.normalized_username,
      s.status AS scorer_status, s.credential_version AS scorer_credential_version
      FROM league_komocontrol_scorer_sessions ss
      JOIN league_komocontrol_scorers s ON s.id = ss.scorer_id
      JOIN league_organizations o ON o.id = s.organization_id
      WHERE ss.token_hash = ?`).bind(tokenHash).first<SessionRow>();
    return row ? {
      id: row.session_id,
      scorerId: row.scorer_id,
      tokenHash: row.token_hash,
      credentialVersion: row.session_credential_version,
      deviceId: row.device_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      scorer: {
        id: row.scorer_id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        username: row.username,
        normalizedUsername: row.normalized_username,
        status: row.scorer_status,
        credentialVersion: row.scorer_credential_version,
      },
    } : null;
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: string): Promise<void> {
    await this.database.prepare(`UPDATE league_komocontrol_scorer_sessions
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE token_hash = ?`).bind(revokedAt, tokenHash).run();
  }
}

async function authority(): Promise<ScorerSessionAuthority> {
  return new ScorerSessionAuthority(new D1ScorerAuthStore(await scorerDatabase()));
}

export async function loginScorer(input: LoginInput) {
  return (await authority()).login(input);
}

export async function resolveScorerSession(request: Request) {
  return (await authority()).resolve(request.headers.get("authorization"));
}

export async function logoutScorer(request: Request) {
  await (await authority()).logout(request.headers.get("authorization"));
}

export function scorerAuthErrorResponse(error: unknown): Response {
  if (error instanceof ScorerAuthError) {
    return Response.json({ error: { code: error.code } }, { status: error.status, headers: { "Cache-Control": "no-store, private" } });
  }
  return Response.json({ error: { code: "AUTH_UNAVAILABLE" } }, { status: 500, headers: { "Cache-Control": "no-store, private" } });
}

export function scorerAuthSuccess(data: unknown, status = 200): Response {
  return Response.json({ data }, { status, headers: { "Cache-Control": "no-store, private" } });
}
