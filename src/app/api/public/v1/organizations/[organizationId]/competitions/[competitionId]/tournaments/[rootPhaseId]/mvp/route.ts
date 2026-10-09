import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { PublicMvpContestError, readPublicMvpContestsWithDb } from "@/services/public-mvp-contests.service";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{
  organizationId: string; competitionId: string; rootPhaseId: string;
}> }): Promise<Response> {
  const env = await getKomoBasketCloudflareEnv();
  if (env?.MVP_PUBLIC_READ_ENABLED !== "enabled") {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers: NO_STORE });
  }
  if (!env.NEWS_DB) {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE" } }, { status: 503, headers: NO_STORE });
  }
  const params = await context.params;
  if ([params.organizationId, params.competitionId, params.rootPhaseId]
    .some((id) => !/^[A-Za-z0-9_-]{1,160}$/.test(id))) {
    return Response.json({ error: { code: "INVALID_CONTEXT" } }, { status: 400, headers: NO_STORE });
  }
  try {
    const data = await readPublicMvpContestsWithDb(env.NEWS_DB, params);
    return Response.json({ data }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PublicMvpContestError) {
      return Response.json({ error: { code: error.code } }, { status: 404, headers: NO_STORE });
    }
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE" } }, { status: 503, headers: NO_STORE });
  }
}
