import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { MvpGoogleAuthError, resolveMvpGoogleVoterSession } from "@/services/mvp-google-auth.service";
import { MvpGoogleVoteError, readMyMvpGoogleVoteWithDb } from "@/services/mvp-google-vote.service";

const HEADERS = { "Cache-Control": "no-store, private", "Vary": "Cookie" };
function failure(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: HEADERS });
}

export async function GET(request: Request): Promise<Response> {
  const env = await getKomoBasketCloudflareEnv();
  if (env?.MVP_GOOGLE_VOTING_ENABLED !== "enabled") return failure(404, "NOT_FOUND");
  if (env.MVP_PUBLIC_READ_ENABLED !== "enabled" || !env.NEWS_DB) return failure(503, "VOTING_UNAVAILABLE");
  try {
    const voter = await resolveMvpGoogleVoterSession(env.NEWS_DB, env, request);
    if (!voter) return failure(401, "UNAUTHENTICATED");
    const contestId = new URL(request.url).searchParams.get("contestId") ?? "";
    const data = await readMyMvpGoogleVoteWithDb(env.NEWS_DB, voter.voterId, contestId);
    return Response.json({ data }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof MvpGoogleVoteError) return failure(error.code === "INVALID_INPUT" ? 400 : 404, error.code);
    if (error instanceof MvpGoogleAuthError) return failure(error.code === "AUTH_DISABLED" ? 404 : 503, error.code);
    return failure(503, "VOTING_UNAVAILABLE");
  }
}
