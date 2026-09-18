const PASSWORD_FORMAT_VERSION = "v1";
const PASSWORD_ALGORITHM = "pbkdf2-sha256";
export const ORGANIZATION_USER_PASSWORD_ITERATIONS = 100_000;
export const ORGANIZATION_USER_PASSWORD_SALT_BYTES = 16;
export const ORGANIZATION_USER_PASSWORD_DERIVED_BITS = 256;
export const ORGANIZATION_USER_PASSWORD_MIN_LENGTH = 10;
export const ORGANIZATION_USER_PASSWORD_MAX_LENGTH = 128;

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ORGANIZATION_USER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ORGANIZATION_USER_SESSION_COOKIE_NAME = "__Host-kb_user_session";

export type OrganizationUserAuthErrorCode =
  | "PASSWORD_INVALID"
  | "USER_NOT_FOUND"
  | "SUPER_ADMIN_FORBIDDEN"
  | "CREDENTIAL_REQUIRED"
  | "CREDENTIAL_WRITE_FAILED"
  | "SESSION_INVALID";

export class OrganizationUserAuthError extends Error {
  constructor(
    readonly code: OrganizationUserAuthErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 500,
  ) {
    super(code);
    this.name = "OrganizationUserAuthError";
  }
}

export type OrganizationUserRecord = {
  id: string;
  email: string;
  normalizedEmail: string;
  status: "active" | "disabled";
  isSuperAdmin: boolean;
  passwordHash: string | null;
  credentialVersion: number | null;
};

export type NewOrganizationUserSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  credentialVersion: number;
  createdAt: string;
  expiresAt: string;
};

export type OrganizationUserSessionRecord = NewOrganizationUserSessionRecord & {
  revokedAt: string | null;
  user: OrganizationUserRecord;
};

export type OrganizationUserSessionIdentity = {
  sessionId: string;
  userId: string;
  email: string;
  expiresAt: string;
};

export interface OrganizationUserAuthStore {
  findUserById(userId: string): Promise<OrganizationUserRecord | null>;
  setCredentialAndRevokeSessions(input: {
    userId: string;
    passwordHash: string;
    changedAt: string;
  }): Promise<OrganizationUserRecord | null>;
  createSession(session: NewOrganizationUserSessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<OrganizationUserSessionRecord | null>;
  revokeSessionById(sessionId: string, revokedAt: string): Promise<void>;
  revokeAllSessionsByUserId(userId: string, revokedAt: string): Promise<void>;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
    const decoded = atob(padded);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt),
      iterations,
    },
    key,
    ORGANIZATION_USER_PASSWORD_DERIVED_BITS,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function isValidOrganizationUserPassword(password: unknown): password is string {
  return typeof password === "string"
    && password.length >= ORGANIZATION_USER_PASSWORD_MIN_LENGTH
    && password.length <= ORGANIZATION_USER_PASSWORD_MAX_LENGTH
    && password.trim().length > 0;
}

export async function hashOrganizationUserPassword(password: string): Promise<string> {
  if (!isValidOrganizationUserPassword(password)) {
    throw new OrganizationUserAuthError("PASSWORD_INVALID", 400);
  }
  const salt = crypto.getRandomValues(new Uint8Array(ORGANIZATION_USER_PASSWORD_SALT_BYTES));
  const derived = await derivePassword(password, salt, ORGANIZATION_USER_PASSWORD_ITERATIONS);
  return [
    PASSWORD_FORMAT_VERSION,
    PASSWORD_ALGORITHM,
    String(ORGANIZATION_USER_PASSWORD_ITERATIONS),
    bytesToBase64Url(salt),
    bytesToBase64Url(derived),
  ].join("$");
}

export async function verifyOrganizationUserPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (!isValidOrganizationUserPassword(password)) return false;
  const [version, algorithm, iterationsText, saltText, hashText, ...extra] = encodedHash.split("$");
  const iterations = Number(iterationsText);
  if (
    extra.length !== 0
    || version !== PASSWORD_FORMAT_VERSION
    || algorithm !== PASSWORD_ALGORITHM
    || !Number.isSafeInteger(iterations)
    || iterations < 1
    || iterations > 0xffff_ffff
  ) {
    return false;
  }
  const salt = base64UrlToBytes(saltText);
  const expected = base64UrlToBytes(hashText);
  if (
    salt?.length !== ORGANIZATION_USER_PASSWORD_SALT_BYTES
    || expected?.length !== ORGANIZATION_USER_PASSWORD_DERIVED_BITS / 8
  ) {
    return false;
  }
  const actual = await derivePassword(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

export function generateOrganizationUserSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES)));
}

export async function hashOrganizationUserSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeOrganizationUserSessionCookie(rawToken: string): string {
  if (!SESSION_TOKEN_PATTERN.test(rawToken)) {
    throw new OrganizationUserAuthError("SESSION_INVALID", 401);
  }
  return `${ORGANIZATION_USER_SESSION_COOKIE_NAME}=${rawToken}; Max-Age=${ORGANIZATION_USER_SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function assertSessionUser(user: OrganizationUserRecord | null): asserts user is OrganizationUserRecord & {
  passwordHash: string;
  credentialVersion: number;
} {
  if (!user || user.status !== "active" || user.isSuperAdmin || !user.passwordHash || user.credentialVersion === null) {
    throw new OrganizationUserAuthError("SESSION_INVALID", 401);
  }
}

export class OrganizationUserAuthAuthority {
  constructor(
    private readonly store: OrganizationUserAuthStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async setPassword(userId: string, password: string) {
    if (!isValidOrganizationUserPassword(password)) {
      throw new OrganizationUserAuthError("PASSWORD_INVALID", 400);
    }
    const current = await this.store.findUserById(userId);
    if (!current) throw new OrganizationUserAuthError("USER_NOT_FOUND", 404);
    if (current.isSuperAdmin) {
      throw new OrganizationUserAuthError("SUPER_ADMIN_FORBIDDEN", 403);
    }

    const passwordHash = await hashOrganizationUserPassword(password);
    const changedAt = this.now().toISOString();
    const updated = await this.store.setCredentialAndRevokeSessions({
      userId,
      passwordHash,
      changedAt,
    });
    if (updated?.isSuperAdmin) {
      throw new OrganizationUserAuthError("SUPER_ADMIN_FORBIDDEN", 403);
    }
    if (!updated || updated.passwordHash !== passwordHash || updated.credentialVersion === null) {
      throw new OrganizationUserAuthError("CREDENTIAL_WRITE_FAILED", 500);
    }
    return {
      userId: updated.id,
      credentialVersion: updated.credentialVersion,
      passwordSetAt: changedAt,
    };
  }

  async verifyCredential(userId: string, password: string): Promise<boolean> {
    const user = await this.store.findUserById(userId);
    if (!user || user.status !== "active" || user.isSuperAdmin || !user.passwordHash) return false;
    return verifyOrganizationUserPassword(password, user.passwordHash);
  }

  async createSession(userId: string) {
    const user = await this.store.findUserById(userId);
    assertSessionUser(user);

    const rawToken = generateOrganizationUserSessionToken();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + ORGANIZATION_USER_SESSION_TTL_SECONDS * 1_000);
    const session: NewOrganizationUserSessionRecord = {
      id: `user_session_${crypto.randomUUID()}`,
      userId: user.id,
      tokenHash: await hashOrganizationUserSessionToken(rawToken),
      credentialVersion: user.credentialVersion,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.store.createSession(session);
    return {
      token: rawToken,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  }

  async resolveSession(rawToken: string): Promise<OrganizationUserSessionIdentity> {
    if (!SESSION_TOKEN_PATTERN.test(rawToken)) {
      throw new OrganizationUserAuthError("SESSION_INVALID", 401);
    }
    const record = await this.store.findSessionByTokenHash(
      await hashOrganizationUserSessionToken(rawToken),
    );
    if (
      !record
      || record.revokedAt !== null
      || !Number.isFinite(Date.parse(record.expiresAt))
      || Date.parse(record.expiresAt) <= this.now().getTime()
    ) {
      throw new OrganizationUserAuthError("SESSION_INVALID", 401);
    }
    assertSessionUser(record.user);
    if (record.credentialVersion !== record.user.credentialVersion) {
      throw new OrganizationUserAuthError("SESSION_INVALID", 401);
    }
    return {
      sessionId: record.id,
      userId: record.user.id,
      email: record.user.email,
      expiresAt: record.expiresAt,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.store.revokeSessionById(sessionId, this.now().toISOString());
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.store.revokeAllSessionsByUserId(userId, this.now().toISOString());
  }
}
