import { normalizeScorerUsername, verifyScorerPassword } from "./komocontrol-scorer-credentials";

export const SCORER_SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ScorerAuthErrorCode = "INPUT_INVALID" | "AUTH_INVALID" | "AUTH_REQUIRED" | "SESSION_INVALID";

export class ScorerAuthError extends Error {
  constructor(readonly code: ScorerAuthErrorCode, readonly status: 400 | 401) {
    super(code);
    this.name = "ScorerAuthError";
  }
}

export interface LoginInput {
  username: string;
  password: string;
  deviceId: string;
}

export interface ScorerRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  username: string;
  normalizedUsername: string;
  passwordHash: string;
  status: "active" | "disabled";
  credentialVersion: number;
}

export interface SessionRecord {
  id: string;
  scorerId: string;
  tokenHash: string;
  credentialVersion: number;
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  scorer: Omit<ScorerRecord, "passwordHash">;
}

export interface NewSessionRecord {
  id: string;
  scorerId: string;
  tokenHash: string;
  credentialVersion: number;
  deviceId: string;
  createdAt: string;
  expiresAt: string;
}

export interface ScorerAuthStore {
  findScorerByNormalizedUsername(normalizedUsername: string): Promise<ScorerRecord | null>;
  createSession(session: NewSessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: string): Promise<void>;
}

export interface SafeSessionDto {
  scorer: { id: string; username: string };
  organization: { id: string; name: string };
  session: { id: string; expiresAt: string; deviceId: string };
}

function requiredBoundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maximum ? text : null;
}

export function validateLoginInput(value: unknown): LoginInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScorerAuthError("INPUT_INVALID", 400);
  }
  const input = value as Record<string, unknown>;
  const username = requiredBoundedText(input.username, 128);
  const password = requiredBoundedText(input.password, 1_024);
  const deviceId = requiredBoundedText(input.deviceId, 128);
  if (!username || !password || !deviceId || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw new ScorerAuthError("INPUT_INVALID", 400);
  }
  return { username, password, deviceId };
}

export function generateOpaqueSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export async function hashOpaqueSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bearerToken(authorization: string | null): string {
  if (!authorization) throw new ScorerAuthError("AUTH_REQUIRED", 401);
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match || !SESSION_TOKEN_PATTERN.test(match[1])) throw new ScorerAuthError("SESSION_INVALID", 401);
  return match[1];
}

function safeSession(record: SessionRecord): SafeSessionDto {
  return {
    scorer: { id: record.scorer.id, username: record.scorer.username },
    organization: { id: record.scorer.organizationId, name: record.scorer.organizationName },
    session: { id: record.id, expiresAt: record.expiresAt, deviceId: record.deviceId },
  };
}

export class ScorerSessionAuthority {
  constructor(
    private readonly store: ScorerAuthStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(input: LoginInput): Promise<SafeSessionDto & { token: string }> {
    const scorer = await this.store.findScorerByNormalizedUsername(normalizeScorerUsername(input.username));
    const passwordValid = scorer ? await verifyScorerPassword(input.password, scorer.passwordHash) : false;
    if (!scorer || !passwordValid || scorer.status !== "active") {
      throw new ScorerAuthError("AUTH_INVALID", 401);
    }

    const token = generateOpaqueSessionToken();
    const tokenHash = await hashOpaqueSessionToken(token);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + SCORER_SESSION_TTL_SECONDS * 1_000);
    const { passwordHash: _passwordHash, ...safeScorer } = scorer;
    const session: NewSessionRecord = {
      id: `komocontrol_session_${crypto.randomUUID()}`,
      scorerId: scorer.id,
      tokenHash,
      credentialVersion: scorer.credentialVersion,
      deviceId: input.deviceId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.store.createSession(session);
    return {
      ...safeSession({ ...session, revokedAt: null, scorer: safeScorer }),
      token,
    };
  }

  async resolve(authorization: string | null): Promise<SafeSessionDto> {
    const token = bearerToken(authorization);
    const record = await this.store.findSessionByTokenHash(await hashOpaqueSessionToken(token));
    if (
      !record
      || record.revokedAt !== null
      || Date.parse(record.expiresAt) <= this.now().getTime()
      || record.scorer.status !== "active"
      || record.credentialVersion !== record.scorer.credentialVersion
    ) {
      throw new ScorerAuthError("SESSION_INVALID", 401);
    }
    return safeSession(record);
  }

  async logout(authorization: string | null): Promise<void> {
    const token = bearerToken(authorization);
    await this.store.revokeSessionByTokenHash(await hashOpaqueSessionToken(token), this.now().toISOString());
  }
}
