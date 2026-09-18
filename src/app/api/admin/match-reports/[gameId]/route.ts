import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireGameAccess } from "@/lib/platform-authorization";
import { readPlatformMatchReport } from "@/services/platform-match-report.service";

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }) {
  const authorization = await requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const { gameId } = await context.params;
    const user = await resolveCanonicalAppUser(authorization.identity);
    const access = await requireGameAccess(user, gameId, "read");
    const result = await readPlatformMatchReport(gameId, access.organizationId);
    if (result.kind === "unavailable") {
      return Response.json({ error: "MATCH_REPORT_UNAVAILABLE", availability: result.availability }, { status: 409 });
    }
    return Response.json({ data: result.report });
  } catch (error) {
    const authorizationResponse = platformAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return Response.json({ error: "MATCH_REPORT_UNAVAILABLE" }, { status: 500 });
  }
}
