import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { MOBILE_TEAM_CACHE, mobileTeamError } from "@/app/api/public/v1/competitions/mobile-team-response";
import { readMobileTeam } from "@/services/public-mobile-team.service";

export async function GET(request: Request, context: { params: Promise<{ competitionId: string; teamId: string }> }) {
  const { competitionId: rawCompetitionId, teamId: rawTeamId } = await context.params;
  const competitionId = routeId(rawCompetitionId);
  const teamId = routeId(rawTeamId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  if (!teamId) return catalogueError("INVALID_TEAM_ID", "A valid teamId is required.", 400);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "rootPhaseId") || params.getAll("rootPhaseId").length > 1) {
    return catalogueError("INVALID_FILTER", "Invalid team detail filter.", 400);
  }
  const rootPhaseId = params.get("rootPhaseId");
  if (rootPhaseId !== null && !routeId(rootPhaseId)) return catalogueError("INVALID_FILTER", "Invalid team detail filter.", 400);
  try {
    return Response.json({ data: await readMobileTeam(competitionId, teamId, rootPhaseId === null ? undefined : routeId(rootPhaseId)!) }, { headers: MOBILE_TEAM_CACHE.detail });
  } catch (error) {
    return mobileTeamError(error);
  }
}
