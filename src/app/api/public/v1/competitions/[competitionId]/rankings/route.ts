import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { MobileRankingError, RANKING_CATEGORIES, readMobileRankings, type RankingCategory } from "@/services/public-mobile-rankings.service";

const RANKINGS_CACHE = { "Cache-Control": "public, max-age=15, s-maxage=60" };

export async function GET(request: Request, context: { params: Promise<{ competitionId: string }> }): Promise<Response> {
  const competitionId = routeId((await context.params).competitionId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !["phaseIds", "category", "cursor", "limit"].includes(key))) {
    return catalogueError("INVALID_FILTER", "Invalid rankings filter.", 400);
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
  const rawCategory = params.getAll("category");
  if (rawCategory.length !== 1 || !RANKING_CATEGORIES.includes(rawCategory[0] as RankingCategory)) {
    return catalogueError("INVALID_CATEGORY", "A supported category is required.", 400);
  }
  const rawLimit = params.getAll("limit");
  if (rawLimit.length > 1 || (rawLimit.length === 1 && !/^[1-9]\d*$/.test(rawLimit[0]))) {
    return catalogueError("INVALID_LIMIT", "Limit must be between 1 and 50.", 400);
  }
  const limit = rawLimit.length ? Number(rawLimit[0]) : 10;
  if (limit > 50) return catalogueError("INVALID_LIMIT", "Limit must be between 1 and 50.", 400);
  const rawCursor = params.getAll("cursor");
  if (rawCursor.length > 1 || (rawCursor.length === 1 && (!rawCursor[0] || rawCursor[0].length > 1024))) {
    return catalogueError("INVALID_CURSOR", "Invalid pagination cursor.", 400);
  }
  try {
    const result = await readMobileRankings({ competitionId, phaseIds, category: rawCategory[0] as RankingCategory,
      limit, cursor: rawCursor[0] });
    return Response.json(result, { headers: RANKINGS_CACHE });
  } catch (error) {
    if (error instanceof MobileRankingError) {
      const status = error.code === "COMPETITION_NOT_FOUND" ? 404 : error.code === "STALE_CURSOR" ? 409
        : error.code === "DATABASE_UNAVAILABLE" ? 503 : 400;
      const message = status === 404 ? "Public selection not found." : status === 409 ? "Ranking changed; restart pagination."
        : status === 503 ? "Public rankings are temporarily unavailable."
        : error.code === "INVALID_PHASES" ? "Valid phaseIds are required." : "Invalid pagination cursor.";
      return catalogueError(error.code, message, status);
    }
    return catalogueError("DATABASE_UNAVAILABLE", "Public rankings are temporarily unavailable.", 503);
  }
}
