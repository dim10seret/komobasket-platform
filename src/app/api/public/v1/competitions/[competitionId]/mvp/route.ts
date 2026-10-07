import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { MobileOfficialMvpError, readMobileOfficialMvp } from "@/services/public-mobile-mvp.service";

const MVP_CACHE = { "Cache-Control": "public, max-age=60, s-maxage=300" };

export async function GET(request: Request, context: { params: Promise<{ competitionId: string }> }): Promise<Response> {
  const competitionId = routeId((await context.params).competitionId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "phaseId" && key !== "round")
    || query.getAll("phaseId").length !== 1 || query.getAll("round").length !== 1) {
    return catalogueError("INVALID_FILTER", "Valid phaseId and round are required.", 400);
  }
  const phaseId = routeId(query.get("phaseId")!);
  const rawRound = query.get("round")!;
  if (!phaseId || !/^[1-9]\d{0,4}$/.test(rawRound) || Number(rawRound) > 10000) {
    return catalogueError("INVALID_FILTER", "Valid phaseId and round are required.", 400);
  }
  try {
    const result = await readMobileOfficialMvp({ competitionId, phaseId, round: Number(rawRound) });
    return Response.json(result, { headers: MVP_CACHE });
  } catch (error) {
    if (error instanceof MobileOfficialMvpError) {
      if (error.code === "INVALID_ROUND") return catalogueError(error.code, "Valid round is required.", 400);
      if (error.code === "CONTEXT_NOT_FOUND") return catalogueError(error.code, "Public selection not found.", 404);
    }
    return catalogueError("DATABASE_UNAVAILABLE", "Public MVP data is temporarily unavailable.", 503);
  }
}
