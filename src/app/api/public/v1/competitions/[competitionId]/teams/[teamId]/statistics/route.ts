import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { MOBILE_TEAM_CACHE, mobileTeamError } from "@/app/api/public/v1/competitions/mobile-team-response";
import { readMobileTeamStatistics } from "@/services/public-mobile-team.service";

export async function GET(request: Request, context: { params: Promise<{ competitionId: string; teamId: string }> }) {
  const { competitionId: rawCompetitionId, teamId: rawTeamId } = await context.params;
  const competitionId = routeId(rawCompetitionId);
  const teamId = routeId(rawTeamId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  if (!teamId) return catalogueError("INVALID_TEAM_ID", "A valid teamId is required.", 400);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "phaseIds")) {
    return catalogueError("INVALID_FILTER", "Invalid statistics filter.", 400);
  }
  const rawPhases = params.getAll("phaseIds");
  if (rawPhases.length !== 1 || rawPhases[0].length > 2400) {
    return catalogueError("INVALID_PHASES", "Valid phaseIds are required.", 400);
  }
  const phaseIds = rawPhases[0].split(",").map((id) => id.trim());
  if (!phaseIds.length || phaseIds.length > 24 || new Set(phaseIds).size > 12
    || phaseIds.some((id) => !routeId(id))) {
    return catalogueError("INVALID_PHASES", "Valid phaseIds are required.", 400);
  }
  try {
    return Response.json({ data: await readMobileTeamStatistics(competitionId, teamId, phaseIds) },
      { headers: MOBILE_TEAM_CACHE.statistics });
  } catch (error) {
    return mobileTeamError(error);
  }
}
