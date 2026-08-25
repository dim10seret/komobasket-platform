import { listScorerAvailableGames } from "@/services/komocontrol-game-discovery.service";
import { resolveScorerSession, scorerAuthErrorResponse, scorerAuthSuccess } from "@/services/komocontrol-scorer-auth.service";

export async function GET(request: Request) {
  try {
    const session = await resolveScorerSession(request);
    return scorerAuthSuccess(await listScorerAvailableGames(session.organization.id));
  } catch (error) {
    return scorerAuthErrorResponse(error);
  }
}
