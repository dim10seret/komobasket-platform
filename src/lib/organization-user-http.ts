import "server-only";

import {
  ORGANIZATION_USER_SESSION_COOKIE_NAME,
  OrganizationUserAuthError,
  generateOrganizationUserSessionToken,
  serializeOrganizationUserSessionCookie,
} from "@/services/organization-user-auth-core";
import { organizationUserLoginService, UserLoginError } from "@/services/organization-user-login.service";

export const USER_CSRF_COOKIE = "__Host-kb_user_csrf";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGES = {
  INVALID_CREDENTIALS: "Λανθασμένο email ή κωδικός.",
  NO_MEMBERSHIP: "Δεν υπάρχει ενεργή πρόσβαση σε οργανισμό.",
  FORBIDDEN: "Δεν επιτρέπεται η συγκεκριμένη ενέργεια.",
  RATE_LIMITED: "Πολλές προσπάθειες σύνδεσης. Δοκιμάστε ξανά σε ένα λεπτό.",
  AUTH_UNAVAILABLE: "Η σύνδεση δεν είναι προσωρινά διαθέσιμη. Δοκιμάστε αργότερα.",
};

export function userCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

export function requireUserMutationOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const cookie = userCookie(request, USER_CSRF_COOKIE);
  const proof = request.headers.get("x-kb-user-csrf");
  if (origin !== new URL(request.url).origin || (site !== null && site !== "same-origin")
    || !cookie || !TOKEN_PATTERN.test(cookie) || proof !== cookie) {
    throw new UserLoginError("FORBIDDEN", 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new UserLoginError("FORBIDDEN", 415);
  }
}

async function readSmallJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new UserLoginError("INVALID_CREDENTIALS", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 4096) {
      await reader.cancel();
      throw new UserLoginError("INVALID_CREDENTIALS", 413);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new UserLoginError("INVALID_CREDENTIALS", 400);
  }
}

function json(body: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    "Cache-Control": "no-store, private", "Vary": "Cookie", "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  if (status === 429) headers.set("Retry-After", "60");
  return Response.json(body, { status, headers });
}

function safeError(error: unknown) {
  if (error instanceof UserLoginError) return { code: error.code, error: MESSAGES[error.code], status: error.status };
  if (error instanceof OrganizationUserAuthError && error.code === "SESSION_INVALID") {
    return { code: "UNAUTHENTICATED", error: "Απαιτείται σύνδεση.", status: 401 };
  }
  return { code: "AUTH_UNAVAILABLE", error: MESSAGES.AUTH_UNAVAILABLE, status: 503 };
}

export async function handleUserAuth(request: Request, action: "login" | "logout" | "me"): Promise<Response> {
  let csrfToken: string | undefined;
  const cookies: string[] = [];
  try {
    if (action === "me") {
      const origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site"
        || (origin && origin !== new URL(request.url).origin)) throw new UserLoginError("FORBIDDEN", 403);
      const existing = userCookie(request, USER_CSRF_COOKIE);
      csrfToken = existing && TOKEN_PATTERN.test(existing) ? existing : generateOrganizationUserSessionToken();
      cookies.push(`${USER_CSRF_COOKIE}=${csrfToken}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict`);
      const token = userCookie(request, ORGANIZATION_USER_SESSION_COOKIE_NAME);
      if (!token) return json({ code: "UNAUTHENTICATED", error: "Απαιτείται σύνδεση.", csrfToken }, 401, cookies);
      const identity = await (await organizationUserLoginService()).resolve(token);
      return json({ ...identity, csrfToken }, 200, cookies);
    }
    requireUserMutationOrigin(request);
    const body = await readSmallJson(request);
    const service = await organizationUserLoginService();
    if (action === "logout") {
      await service.logout(userCookie(request, ORGANIZATION_USER_SESSION_COOKIE_NAME));
      cookies.push(`${ORGANIZATION_USER_SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
      return json({ ok: true }, 200, cookies);
    }
    if (typeof body.email !== "string" || body.email.length > 320
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      || typeof body.password !== "string" || body.password.length > 128 || !body.password.length) {
      throw new UserLoginError("INVALID_CREDENTIALS", 400);
    }
    const result = await service.login(body.email, body.password);
    cookies.push(serializeOrganizationUserSessionCookie(result.session.token));
    return json(result.identity, 200, cookies);
  } catch (error) {
    const safe = safeError(error);
    return json({ code: safe.code, error: safe.error, ...(csrfToken ? { csrfToken } : {}) }, safe.status, cookies);
  }
}
