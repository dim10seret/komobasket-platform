import { requireAdmin } from "@/lib/admin-auth";
import { createLeagueEntity } from "@/services/league-admin.service";

const resources = new Set(["seasons", "competitions", "teams", "participations", "players", "rosters", "phases", "games"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;
  const { resource } = await context.params;
  if (!resources.has(resource)) {
    return Response.json({ error: "Άγνωστη κατηγορία διαχείρισης." }, { status: 404 });
  }
  try {
    const result = await createLeagueEntity(
      resource,
      (await request.json()) as Record<string, unknown>,
      authorization.identity.email,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Η αποθήκευση απέτυχε." },
      { status: 400 },
    );
  }
}
