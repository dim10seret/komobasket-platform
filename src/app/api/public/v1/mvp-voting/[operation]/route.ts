import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { sha256Hex } from "@/services/mvp-guest-crypto";
import { MvpGuestError, MvpGuestVotingService } from "@/services/mvp-guest-voting.service";
import { MvpIntegrityError, verifyStandardPlayIntegrity } from "@/services/mvp-play-integrity";
import { MvpVoteError } from "@/services/mvp-vote.service";
import type { KomoBasketCloudflareEnv } from "@/types/cloudflare";

const NO_STORE = { "Cache-Control": "no-store" };
type Operation = "challenge" | "credential" | "vote";
class MvpRateLimitError extends Error {}
class MvpBodyTooLargeError extends Error {}

function failure(status: number, code: string): Response {
  return Response.json({ error: { code, message: "MVP voting request could not be completed." } },
    { status, headers: NO_STORE });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new MvpGuestError("INVALID_INPUT");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new MvpBodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new MvpGuestError("INVALID_INPUT"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MvpGuestError("INVALID_INPUT");
  return parsed as Record<string, unknown>;
}

async function rateLimit(env: KomoBasketCloudflareEnv, request: Request, operation: Operation,
  body: Record<string, unknown>): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !env.USER_LOGIN_RATE_LIMITER) throw new MvpIntegrityError("INTEGRITY_UNAVAILABLE");
  // Separate MVP-prefixed keys share only the existing Cloudflare limiter infrastructure.
  // IP is an abuse signal, never voting identity.
  const subjects = [ip, operation === "challenge" ? body.publicKeySpki : body.credentialId];
  for (const [index, subject] of subjects.entries()) {
    if (typeof subject !== "string" || !subject || subject.length > 2048) throw new MvpGuestError("INVALID_INPUT");
    const digest = await sha256Hex(new TextEncoder().encode(subject));
    let allowed: boolean;
    try { allowed = (await env.USER_LOGIN_RATE_LIMITER.limit({ key: `mvp2b:${operation}:${index}:${digest}` })).success; }
    catch { throw new MvpIntegrityError("INTEGRITY_UNAVAILABLE"); }
    if (!allowed) throw new MvpRateLimitError();
  }
}

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }): Promise<Response> {
  const { operation } = await context.params;
  if (operation !== "challenge" && operation !== "credential" && operation !== "vote") return failure(404, "NOT_FOUND");
  const env = await getKomoBasketCloudflareEnv();
  if (env?.MVP_GUEST_VOTING_ENABLED !== "enabled") return failure(404, "NOT_FOUND");
  if (!env.NEWS_DB || !env.MVP_GOOGLE_SERVICE_ACCOUNT_EMAIL
    || !env.MVP_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !env.MVP_ANDROID_CERT_SHA256
    || !env.USER_LOGIN_RATE_LIMITER) return failure(503, "VOTING_UNAVAILABLE");
  try {
    const body = await readBody(request);
    await rateLimit(env, request, operation, body);
    const service = new MvpGuestVotingService(env.NEWS_DB, {
      verify: (token, requestHash) => verifyStandardPlayIntegrity(token, requestHash, {
        serviceAccountEmail: env.MVP_GOOGLE_SERVICE_ACCOUNT_EMAIL,
        serviceAccountPrivateKey: env.MVP_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
        expectedCertificateSha256: env.MVP_ANDROID_CERT_SHA256,
      }),
    });
    const result = operation === "challenge"
      ? await service.issueChallenge(body as Parameters<MvpGuestVotingService["issueChallenge"]>[0])
      : operation === "credential"
        ? await service.register(body as Parameters<MvpGuestVotingService["register"]>[0])
        : await service.vote(body as Parameters<MvpGuestVotingService["vote"]>[0]);
    return Response.json({ data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MvpBodyTooLargeError) return failure(413, "INVALID_INPUT");
    if (error instanceof MvpRateLimitError) return failure(429, "RATE_LIMITED");
    if (error instanceof MvpIntegrityError) return failure(error.code === "INTEGRITY_REJECTED" ? 401 : 503, error.code);
    if (error instanceof MvpGuestError) {
      const status = error.code === "INVALID_INPUT" ? 400 : error.code === "CONTEST_UNAVAILABLE"
        || error.code === "CREDENTIAL_UNAVAILABLE" ? 404 : error.code === "CHALLENGE_CONFLICT" ? 409 : 401;
      return failure(status, error.code);
    }
    if (error instanceof MvpVoteError) return failure(error.code === "ALREADY_VOTED" ? 409
      : error.code === "INVALID_INPUT" ? 400 : error.code === "UNVERIFIED_VOTER" ? 401 : 404, error.code);
    return failure(503, "VOTING_UNAVAILABLE");
  }
}
