import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireGameAccess } from "@/lib/platform-authorization";
import { generatePlatformGameSheetPdf, readPlatformGameSheet } from "@/services/platform-game-sheet.service";

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;
  const { gameId } = await context.params;
  try {
    const user = await resolveCanonicalAppUser(admin.identity);
    const access = await requireGameAccess(user, gameId, "read");
    const result = await readPlatformGameSheet(gameId, access.organizationId);
    if (result.kind === "unavailable") return NextResponse.json({ error: result.reason }, { status: result.reason === "GAME_SHEET_SCORE_OVERFLOW" ? 422 : 409 });
    const pdf = await generatePlatformGameSheetPdf(result.sheet);
    const body = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(body).set(pdf);
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"komobasket-game-sheet.pdf\"",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const authorization = platformAuthorizationErrorResponse(error);
    return authorization ?? NextResponse.json({ error: "GAME_SHEET_UNAVAILABLE" }, { status: 500 });
  }
}
