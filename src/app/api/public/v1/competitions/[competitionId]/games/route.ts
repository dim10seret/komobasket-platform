import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { MOBILE_COMPETITION_CACHE, mobileCompetitionError, routeId } from "@/app/api/public/v1/competitions/mobile-competition-response";
import { listGames, type GameFilters, type GameStatus } from "@/services/public-mobile-competition.service";

const STATUSES: GameStatus[] = ["scheduled", "live", "completed", "postponed", "cancelled"];
const PARAMETERS = new Set(["rootPhaseId", "phaseId", "round", "status", "teamId", "cursor", "limit", "order"]);

function filtersFromRequest(request: Request): GameFilters | null {
  const params = new URL(request.url).searchParams;
  for (const [key] of params) if (!PARAMETERS.has(key) || params.getAll(key).length !== 1) return null;
  const phaseId = params.get("phaseId");
  const rootPhaseId = params.get("rootPhaseId");
  const teamId = params.get("teamId");
  const round = params.get("round");
  const status = params.get("status");
  const cursor = params.get("cursor");
  const limit = params.get("limit");
  const order = params.get("order");
  if (phaseId !== null && !routeId(phaseId)) return null;
  if (rootPhaseId !== null && !routeId(rootPhaseId)) return null;
  if (teamId !== null && !routeId(teamId)) return null;
  if (round !== null && (!/^[1-9]\d{0,4}$/.test(round) || Number(round) > 10000)) return null;
  if (status !== null && !STATUSES.includes(status as GameStatus)) return null;
  if (cursor !== null && (cursor.length < 1 || cursor.length > 1000)) return null;
  if (limit !== null && (!/^[1-9]\d?$/.test(limit) || Number(limit) > 50)) return null;
  if (order !== null && order !== "asc" && order !== "desc") return null;
  return {
    ...(rootPhaseId === null ? {} : { rootPhaseId: routeId(rootPhaseId)! }),
    ...(phaseId === null ? {} : { phaseId: routeId(phaseId)! }),
    ...(teamId === null ? {} : { teamId: routeId(teamId)! }),
    ...(round === null ? {} : { round: Number(round) }),
    ...(status === null ? {} : { status: status as GameStatus }),
    ...(cursor === null ? {} : { cursor }),
    ...(order === null ? {} : { order }),
    limit: limit === null ? 20 : Number(limit),
  };
}

export async function GET(request: Request, context: { params: Promise<{ competitionId: string }> }) {
  const competitionId = routeId((await context.params).competitionId);
  if (!competitionId) return catalogueError("INVALID_COMPETITION_ID", "A valid competitionId is required.", 400);
  const filters = filtersFromRequest(request);
  if (!filters) return catalogueError("INVALID_FILTER", "Invalid games filter.", 400);
  try {
    const result = await listGames(competitionId, filters);
    return Response.json(result, { headers: MOBILE_COMPETITION_CACHE.games });
  } catch (error) {
    return mobileCompetitionError(error);
  }
}
