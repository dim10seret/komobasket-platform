import { requireAdmin } from "@/lib/admin-auth";
import {
  departPlayer,
  getLeagueAdminSnapshot,
  migrateHistoricalLeagueData,
} from "@/services/league-admin.service";

export async function GET(request: Request) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    return Response.json(await getLeagueAdminSnapshot());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Αποτυχία φόρτωσης." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (input.action !== "departure") {
      return Response.json({ error: "Μη υποστηριζόμενη ενέργεια." }, { status: 400 });
    }
    return Response.json(await departPlayer(input, authorization.identity.email));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (input.action !== "migrate-history") {
      return Response.json({ error: "Μη υποστηριζόμενη ενέργεια." }, { status: 400 });
    }
    return Response.json(await migrateHistoricalLeagueData(authorization.identity.email));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Η μεταφορά απέτυχε." },
      { status: 400 },
    );
  }
}
