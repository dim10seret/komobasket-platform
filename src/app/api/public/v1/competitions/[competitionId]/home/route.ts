import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { mobileCompetitionError, routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { readCompetitionHome } from "@/services/public-mobile-competition.service";

const HOME_CACHE = { "Cache-Control": "public, max-age=15, s-maxage=30" };

export async function GET(request: Request, context: { params: Promise<{ competitionId: string }> }) {
  const competitionId = routeId((await context.params).competitionId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "rootPhaseId") || params.getAll("rootPhaseId").length > 1) {
    return catalogueError("INVALID_FILTER", "Invalid Home filter.", 400);
  }
  const rootPhaseId = params.get("rootPhaseId");
  if (rootPhaseId !== null && !routeId(rootPhaseId)) return catalogueError("INVALID_FILTER", "Invalid Home filter.", 400);
  try {
    return Response.json({ data: await readCompetitionHome(competitionId, rootPhaseId === null ? undefined : routeId(rootPhaseId)!) }, { headers: HOME_CACHE });
  } catch (error) {
    return mobileCompetitionError(error);
  }
}
