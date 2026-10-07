import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { MOBILE_TEAM_CACHE, mobileTeamError } from "@/app/api/public/v1/competitions/mobile-team-response";
import { listMobileTeams } from "@/services/public-mobile-team.service";

export async function GET(request: Request, context: { params: Promise<{ competitionId: string }> }) {
  const competitionId = routeId((await context.params).competitionId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  if (new URL(request.url).searchParams.size) return catalogueError("INVALID_FILTER", "Teams do not accept filters.", 400);
  try {
    return Response.json({ data: await listMobileTeams(competitionId) }, { headers: MOBILE_TEAM_CACHE.list });
  } catch (error) {
    return mobileTeamError(error);
  }
}
