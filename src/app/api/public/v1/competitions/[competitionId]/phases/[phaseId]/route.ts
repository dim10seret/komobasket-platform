import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { MOBILE_COMPETITION_CACHE, mobileCompetitionError, routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { readPhaseDetail } from "@/services/public-mobile-competition.service";

export async function GET(_request: Request, context: { params: Promise<{ competitionId: string; phaseId: string }> }) {
  const { competitionId: rawCompetitionId, phaseId: rawPhaseId } = await context.params;
  const competitionId = routeId(rawCompetitionId);
  const phaseId = routeId(rawPhaseId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  if (!phaseId) return catalogueError("INVALID_PHASE_ID", "A valid phaseId is required.", 400);
  try {
    return Response.json({ data: await readPhaseDetail(competitionId, phaseId) }, { headers: MOBILE_COMPETITION_CACHE.phase });
  } catch (error) {
    return mobileCompetitionError(error);
  }
}
