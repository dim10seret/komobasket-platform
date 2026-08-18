import { requireAdmin } from "@/lib/admin-auth";
import {
  createLeagueEntity,
  cleanupLeagueCompetition,
  deleteLeagueCompetition,
  deleteLeaguePhase,
  deleteLeaguePhaseSchedule,
  deleteLeagueSeason,
  deleteLeagueTeam,
  deleteLeagueParticipation,
  generateRoundRobinGamesForSchedule,
  updateLeagueEntity,
} from "@/services/league-admin.service";

const resources = new Set([
  "seasons",
  "competitions",
  "teams",
  "participations",
  "players",
  "rosters",
  "phases",
  "phase-schedules",
  "games",
]);

const editableResources = new Set([
  "seasons",
  "competitions",
  "teams",
  "participations",
  "phases",
  "phase-schedules",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const authorization = requireAdmin(request);

  if (authorization.response) {
    return authorization.response;
  }

  const { resource } = await context.params;

  if (!resources.has(resource)) {
    return Response.json(
      { error: "Άγνωστη κατηγορία διαχείρισης." },
      { status: 404 },
    );
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;

    if (resource === "competitions" && String(input.action ?? "").trim() === "cleanup") {
      const result = await cleanupLeagueCompetition(input, authorization.identity.email);
      return Response.json(result);
    }
    if (resource === "phase-schedules" && String(input.action ?? "").trim() === "generateRoundRobinGames") {
      const result = await generateRoundRobinGamesForSchedule(input, authorization.identity.email);
      return Response.json(result);
    }

    const result = await createLeagueEntity(
      resource,
      input,
      authorization.identity.email,
    );

    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Η αποθήκευση απέτυχε.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const authorization = requireAdmin(request);

  if (authorization.response) {
    return authorization.response;
  }

  const { resource } = await context.params;

  if (!editableResources.has(resource)) {
    return Response.json(
      {
        error:
          "Η επεξεργασία δεν υποστηρίζεται για αυτή την κατηγορία.",
      },
      { status: 404 },
    );
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;

    const result = await updateLeagueEntity(
      resource,
      input,
      authorization.identity.email,
    );

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Η επεξεργασία απέτυχε.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const authorization = requireAdmin(request);

  if (authorization.response) {
    return authorization.response;
  }

  const { resource } = await context.params;

  if (
    resource !== "seasons"
    && resource !== "competitions"
    && resource !== "participations"
    && resource !== "teams"
    && resource !== "phases"
    && resource !== "phase-schedules"
  ) {
    return Response.json(
      { error: "Η διαγραφή δεν υποστηρίζεται για αυτή την κατηγορία." },
      { status: 404 },
    );
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;
    const result = resource === "seasons"
      ? await deleteLeagueSeason(input, authorization.identity.email)
      : resource === "competitions"
        ? await deleteLeagueCompetition(input, authorization.identity.email)
        : resource === "phases"
          ? await deleteLeaguePhase(input, authorization.identity.email)
        : resource === "phase-schedules"
          ? await deleteLeaguePhaseSchedule(input, authorization.identity.email)
        : resource === "teams"
          ? await deleteLeagueTeam(input, authorization.identity.email)
          : await deleteLeagueParticipation(input, authorization.identity.email);

    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Η διαγραφή απέτυχε.",
      },
      { status: 400 },
    );
  }
}
