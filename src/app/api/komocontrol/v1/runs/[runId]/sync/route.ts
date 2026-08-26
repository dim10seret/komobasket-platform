import { resolveScorerSession, scorerAuthErrorResponse } from "@/services/komocontrol-scorer-auth.service";
import { GameplaySyncServiceError, gameplaySyncErrorResponse, syncScorerGameplay } from "@/services/komocontrol-gameplay-sync.service";

export async function PUT(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const session = await resolveScorerSession(request);
    const { runId } = await context.params;
    let payload: unknown;
    try { payload = await request.json(); } catch { return gameplaySyncErrorResponse(new GameplaySyncServiceError("SYNC_INVALID", 400)); }
    return Response.json({ data: await syncScorerGameplay(session, runId, payload) }, {
      status: 200,
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return error instanceof GameplaySyncServiceError ? gameplaySyncErrorResponse(error) : scorerAuthErrorResponse(error);
  }
}
