import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { MobilePlayerError, readMobilePlayer } from "@/services/public-mobile-player.service";

const PLAYER_CACHE = { "Cache-Control": "public, max-age=15, s-maxage=60" };

export async function GET(request: Request, context: { params: Promise<{ competitionId: string; playerId: string }> }): Promise<Response> {
  const { competitionId: rawCompetitionId, playerId: rawPlayerId } = await context.params;
  const competitionId = routeId(rawCompetitionId);
  const playerId = routeId(rawPlayerId);
  if (!competitionId || !playerId) return catalogueError("INVALID_ID", "Valid competitionId and playerId are required.", 400);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "phaseIds")) {
    return catalogueError("INVALID_FILTER", "Invalid player profile filter.", 400);
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
    const result = await readMobilePlayer({ competitionId, playerId, phaseIds });
    return Response.json(result, { headers: PLAYER_CACHE });
  } catch (error) {
    if (error instanceof MobilePlayerError) {
      if (error.code === "INVALID_PHASES") return catalogueError(error.code, "Valid phaseIds are required.", 400);
      if (error.code === "PLAYER_NOT_FOUND" || error.code === "COMPETITION_NOT_FOUND") {
        return catalogueError(error.code, "Public selection not found.", 404);
      }
    }
    return catalogueError("DATABASE_UNAVAILABLE", "Public player profile is temporarily unavailable.", 503);
  }
}
