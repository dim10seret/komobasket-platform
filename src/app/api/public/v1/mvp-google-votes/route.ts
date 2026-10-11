import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { MvpGoogleAuthError, requireMvpVoterMutationOrigin,
  resolveMvpGoogleVoterSession } from "@/services/mvp-google-auth.service";
import { castMvpGoogleVoteWithDb, MvpGoogleVoteError, validMvpGoogleVoteId } from
  "@/services/mvp-google-vote.service";
import type { KomoBasketCloudflareEnv } from "@/types/cloudflare";

const HEADERS = { "Cache-Control": "no-store, private", "Vary": "Cookie" };
class BodyTooLargeError extends Error {}
class RateLimitedError extends Error {}

function failure(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: HEADERS });
}

async function body(request: Request): Promise<{ contestId: string; candidateId: string }> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
    throw new MvpGoogleVoteError("INVALID_INPUT");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MvpGoogleVoteError("INVALID_INPUT");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new BodyTooLargeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new MvpGoogleVoteError("INVALID_INPUT"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MvpGoogleVoteError("INVALID_INPUT");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !validMvpGoogleVoteId(record.contestId)
    || !validMvpGoogleVoteId(record.candidateId)) throw new MvpGoogleVoteError("INVALID_INPUT");
  return { contestId: record.contestId, candidateId: record.candidateId };
}

async function rateLimit(env: KomoBasketCloudflareEnv, request: Request, voterId: string): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip")
    ?? (process.env.NODE_ENV !== "production" ? "local" : null);
  if (!ip || !env.USER_LOGIN_RATE_LIMITER) throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
  for (const subject of [ip, voterId]) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject)));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    let allowed: boolean;
    try { allowed = (await env.USER_LOGIN_RATE_LIMITER.limit({ key: `mvp-google-vote:${hex}` })).success; }
    catch { throw new MvpGoogleAuthError("AUTH_UNAVAILABLE"); }
    if (!allowed) throw new RateLimitedError();
  }
}

export async function POST(request: Request): Promise<Response> {
  const env = await getKomoBasketCloudflareEnv();
  if (env?.MVP_GOOGLE_VOTING_ENABLED !== "enabled") return failure(404, "NOT_FOUND");
  if (env.MVP_PUBLIC_READ_ENABLED !== "enabled" || !env.NEWS_DB) return failure(503, "VOTING_UNAVAILABLE");
  try {
    const voter = await resolveMvpGoogleVoterSession(env.NEWS_DB, env, request);
    if (!voter) return failure(401, "UNAUTHENTICATED");
    requireMvpVoterMutationOrigin(request);
    const input = await body(request);
    await rateLimit(env, request, voter.voterId);
    const result = await castMvpGoogleVoteWithDb(env.NEWS_DB, voter, input);
    return Response.json({ data: result }, { status: result.alreadyVoted ? 200 : 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return failure(413, "INVALID_INPUT");
    if (error instanceof RateLimitedError) return failure(429, "RATE_LIMITED");
    if (error instanceof MvpGoogleVoteError) return failure(error.code === "INVALID_INPUT" ? 400
      : error.code === "ALREADY_VOTED" ? 409 : 404, error.code);
    if (error instanceof MvpGoogleAuthError) return failure(error.code === "INVALID_REQUEST" ? 403
      : error.code === "AUTH_DISABLED" ? 404 : 503, error.code);
    return failure(503, "VOTING_UNAVAILABLE");
  }
}
