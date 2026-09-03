import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireGameAccess } from "@/lib/platform-authorization";
import { readPlatformMatchReport } from "@/services/platform-match-report.service";
import { generateStatisticsPdf, statisticsPdfFilename } from "@/services/platform-statistics-pdf.service";

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const { gameId } = await context.params;
    const user = await resolveCanonicalAppUser(authorization.identity);
    const access = await requireGameAccess(user, gameId, "read");
    const result = await readPlatformMatchReport(gameId, access.organizationId);
    if (result.kind === "unavailable") {
      return Response.json({ error: "MATCH_REPORT_UNAVAILABLE", availability: result.availability }, { status: 409 });
    }
    const pdf = await generateStatisticsPdf(result.report);
    const filename = statisticsPdfFilename(result.report);
    const body = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(body).set(pdf);
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="komobasket-statistics.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    const authorizationResponse = platformAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return Response.json({ error: "STATISTICS_PDF_UNAVAILABLE" }, { status: 500 });
  }
}
