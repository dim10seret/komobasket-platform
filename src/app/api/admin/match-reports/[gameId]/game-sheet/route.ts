import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireGameAccess } from "@/lib/platform-authorization";
import { readPlatformGameSheet, renderPlatformGameSheetHtml } from "@/services/platform-game-sheet.service";

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  const { gameId } = await context.params;
  try {
    const user = await resolveCanonicalAppUser(admin.identity);
    const access = await requireGameAccess(user, gameId, "read");
    const result = await readPlatformGameSheet(gameId, access.organizationId);
    if (result.kind === "unavailable") return NextResponse.json({ error: result.reason }, { status: result.reason === "GAME_SHEET_SCORE_OVERFLOW" ? 422 : 409 });
    const nonce = crypto.randomUUID().replaceAll("-", "");
    return new Response(renderPlatformGameSheetHtml(result.sheet, nonce), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const authorization = platformAuthorizationErrorResponse(error);
    return authorization ?? NextResponse.json({ error: "GAME_SHEET_UNAVAILABLE" }, { status: 500 });
  }
}
