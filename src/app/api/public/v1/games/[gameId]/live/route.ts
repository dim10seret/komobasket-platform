import { PublicLiveGameServiceError, readPublicLiveGame } from "@/services/public-live-game.service";

const CACHE_HEADERS = { "Cache-Control": "public, max-age=0, must-revalidate" };

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const result = await readPublicLiveGame(gameId, { ifNoneMatch: request.headers.get("if-none-match") });
    if (result.kind === "not-modified") return new Response(null, { status: 304, headers: { ...CACHE_HEADERS, ETag: result.etag } });
    if (result.kind === "not-live") return Response.json({ data: null, error: { code: "GAME_NOT_LIVE" } }, { status: 404, headers: CACHE_HEADERS });
    return Response.json({ data: result.game }, { status: 200, headers: { ...CACHE_HEADERS, ETag: result.etag } });
  } catch (error) {
    const code = error instanceof PublicLiveGameServiceError ? error.code : "PUBLIC_LIVE_UNAVAILABLE";
    const status = code === "PUBLIC_LIVE_NOT_FOUND" ? 404 : code === "PUBLIC_LIVE_CORRUPTED" ? 409 : 503;
    return Response.json({ data: null, error: { code } }, { status, headers: CACHE_HEADERS });
  }
}
