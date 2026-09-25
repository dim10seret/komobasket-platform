import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { platformAuthorizationErrorResponse, requireCompetitionAccess } from "@/lib/platform-authorization";
import { matchdayMvpErrorResponse, readMatchdayMvp, saveMatchdayMvp } from "@/services/matchday-mvp.service";

const text = (value: unknown) => String(value ?? "").trim();
const round = (value: unknown) => Number(value);

async function authorize(request: Request, competitionId: string, mode: "read" | "manage") {
  const admin = await requireAdmin(request);
  if (admin.response) return { response: admin.response } as const;
  const user = await resolveCanonicalAppUser(admin.identity);
  const access = await requireCompetitionAccess(user, competitionId, mode);
  return { admin, user, access, response: null } as const;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const competitionId = text(url.searchParams.get("competitionId"));
    const authorized = await authorize(request, competitionId, "read");
    if (authorized.response) return authorized.response;
    return Response.json(await readMatchdayMvp({
      organizationId: authorized.access.organizationId, competitionId,
      phaseId: text(url.searchParams.get("phaseId")), roundNumber: round(url.searchParams.get("roundNumber")),
    }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return matchdayMvpErrorResponse(error) ?? platformAuthorizationErrorResponse(error) ?? Response.json({ error: "Η ανάγνωση MVP δεν ολοκληρώθηκε." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>;
    const competitionId = text(input.competitionId);
    const authorized = await authorize(request, competitionId, "manage");
    if (authorized.response) return authorized.response;
    return Response.json(await saveMatchdayMvp({
      organizationId: authorized.access.organizationId, competitionId, phaseId: text(input.phaseId),
      roundNumber: round(input.roundNumber), gameId: text(input.gameId), playerId: text(input.playerId),
    }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return matchdayMvpErrorResponse(error) ?? platformAuthorizationErrorResponse(error) ?? Response.json({ error: "Η επιλογή MVP δεν αποθηκεύτηκε." }, { status: 400 });
  }
}
