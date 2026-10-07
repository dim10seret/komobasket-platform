import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { MOBILE_COMPETITION_CACHE, mobileCompetitionError, routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { readCompetitionDetail } from "@/services/public-mobile-competition.service";

export async function GET(_request: Request, context: { params: Promise<{ competitionId: string }> }) {
  const competitionId = routeId((await context.params).competitionId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  try {
    return Response.json({ data: await readCompetitionDetail(competitionId) }, { headers: MOBILE_COMPETITION_CACHE.detail });
  } catch (error) {
    return mobileCompetitionError(error);
  }
}
