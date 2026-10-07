import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { MOBILE_COMPETITION_CACHE, mobileCompetitionError, routeId, singleQueryId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { readStandings } from "@/services/public-mobile-competition.service";

export async function GET(request: Request, context: { params: Promise<{ competitionId: string }> }) {
  const competitionId = routeId((await context.params).competitionId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  const query = new URL(request.url).searchParams;
  const phaseId = singleQueryId(request, "phaseId");
  if (!phaseId || [...query.keys()].some((key) => key !== "phaseId")) {
    return catalogueError("INVALID_PHASE_ID", "A valid phaseId is required.", 400);
  }
  try {
    return Response.json({ data: await readStandings(competitionId, phaseId) }, { headers: MOBILE_COMPETITION_CACHE.standings });
  } catch (error) {
    return mobileCompetitionError(error);
  }
}
