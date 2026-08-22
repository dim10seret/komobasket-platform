import { requireAdmin, type AdminIdentity } from "@/lib/admin-auth";
import {
  resolveCanonicalAppUser,
  resolvePlatformReadContext,
} from "@/lib/app-user-identity";
import {
  platformAuthorizationErrorResponse,
  requireCompetitionAccess,
  requireCompetitionVenueAccess,
  requireOrganizationAccess,
  requireParticipationAccess,
  requirePhaseAccess,
  requireRosterRelationshipAccess,
  requireSourcePhaseAccess,
  requireSourcePhaseMatchupAccess,
  requireTeamAccess,
  requireTeamCompetitionAccess,
} from "@/lib/platform-authorization";
import {
  createLeagueEntity,
  cleanupLeagueCompetition,
  deleteLeagueCompetition,
  deletePhaseProgram,
  DeletePhaseProgramError,
  deleteLeaguePhase,
  deleteLeaguePhaseSchedule,
  deleteLeagueSeason,
  deleteLeagueTeam,
  deleteLeagueParticipation,
  deleteLeagueCompetitionVenue,
  finalizeLeaguePhase,
  materializePhaseProgram,
  saveSeriesPlanningSlot,
  updateLeagueEntity,
} from "@/services/league-admin.service";

const resources = new Set([
  "seasons",
  "competitions",
  "teams",
  "participations",
  "competition-venues",
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
  "competition-venues",
  "phases",
  "phase-schedules",
  "games",
]);

async function requireCreateOrganization(
  identity: AdminIdentity,
  input: Record<string, unknown>,
) {
  const user = await resolveCanonicalAppUser(identity);
  const requestedOrganizationId = String(
    input.organizationId ?? input.organization_id ?? "",
  ).trim();
  const organizationId = requestedOrganizationId
    || (await resolvePlatformReadContext(user)).organizationId;
  const organization = await requireOrganizationAccess(user, organizationId, "manage");
  return { user, organizationId: organization.organizationId };
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(String).map((item) => item.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function phaseMatchups(input: Record<string, unknown>, participant: Record<string, unknown>) {
  const raw = participant.matchups ?? input.matchups;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function requirePhaseConfigurationAccess(
  identity: AdminIdentity,
  input: Record<string, unknown>,
  fallbackCompetitionId = "",
) {
  const user = await resolveCanonicalAppUser(identity);
  const competitionId = String(
    input.competitionId ?? input.competition_id ?? fallbackCompetitionId,
  ).trim();
  const competition = await requireCompetitionAccess(user, competitionId, "manage");
  const participant = recordValue(input.participantConfiguration);
  const participantSourcePhaseId = String(
    participant.participantSourcePhaseId
      || participant.sourcePhaseId
      || input.participantSourcePhaseId
      || "",
  ).trim();
  const sourcePhaseIds = new Set([
    String(input.previousPhaseId ?? input.previous_phase_id ?? "").trim(),
    String(input.carryOverSourcePhaseId ?? "").trim(),
    participantSourcePhaseId,
  ].filter(Boolean));

  await Promise.all([...sourcePhaseIds].map((sourcePhaseId) => requireSourcePhaseAccess(
    user,
    { targetCompetitionId: competitionId, sourcePhaseId },
    "manage",
  )));

  const matchupIds = new Set([
    ...stringArray(participant.sourceMatchupIds || input.sourceMatchupIds),
  ]);
  const teamIds = new Set([
    ...stringArray(participant.selectedTeamIds || input.participantTeamIds),
  ]);
  for (const matchup of phaseMatchups(input, participant)) {
    const nextMatchup = recordValue(matchup);
    for (const rawSlot of [nextMatchup.slotA, nextMatchup.slotB]) {
      const slot = recordValue(rawSlot);
      const type = String(slot.type ?? "").trim();
      if (["fixed_team", "manual"].includes(type)) {
        const teamId = String(slot.teamId ?? "").trim();
        if (teamId) teamIds.add(teamId);
      }
      if (["matchup_winner", "matchup_loser"].includes(type)) {
        const matchupId = String(slot.matchupId ?? "").trim();
        if (matchupId) matchupIds.add(matchupId);
      }
    }
  }

  await Promise.all([...teamIds].map(async (teamId) => {
    const team = await requireTeamAccess(user, teamId, "manage");
    if (team.organizationId !== competition.organizationId) {
      await requireTeamCompetitionAccess(user, { competitionId, teamId }, "manage");
    }
  }));

  if (participantSourcePhaseId) {
    await Promise.all([...matchupIds].map((matchupId) => requireSourcePhaseMatchupAccess(
      user,
      { targetCompetitionId: competitionId, sourcePhaseId: participantSourcePhaseId, matchupId },
      "manage",
    )));
  }

  return { user, competitionId };
}

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
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireCompetitionAccess(user, String(input.id ?? ""), "manage");
      const result = await cleanupLeagueCompetition(input, authorization.identity.email);
      return Response.json(result);
    }
    if (resource === "phase-schedules" && ["generateRoundRobinGames", "materializePhaseProgram"].includes(String(input.action ?? "").trim())) {
      const result = await materializePhaseProgram(input, authorization.identity.email);
      return Response.json(result);
    }

    let organizationId: string | undefined;
    if (["competitions", "teams", "players"].includes(resource)) {
      organizationId = (await requireCreateOrganization(authorization.identity, input)).organizationId;
    } else if (resource === "phases") {
      await requirePhaseConfigurationAccess(authorization.identity, input);
    } else if (resource === "competition-venues") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireCompetitionAccess(user, String(input.competitionId ?? ""), "manage");
    } else if (resource === "participations") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      const competitionId = String(input.competitionId ?? "");
      const teamIds = Array.isArray(input.teamIds)
        ? input.teamIds.map(String)
        : [String(input.teamId ?? "")].filter(Boolean);
      await Promise.all(
        teamIds.map((teamId) => requireTeamCompetitionAccess(
          user,
          { competitionId, teamId },
          "manage",
        )),
      );
    } else if (resource === "rosters") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireRosterRelationshipAccess(user, {
        playerId: String(input.playerId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
      }, "manage");
    }

    const result = await createLeagueEntity(
      resource,
      input,
      authorization.identity.email,
      organizationId,
    );

    return Response.json(result, { status: 201 });
  } catch (error) {
    const authorizationResponse = platformAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
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

    if (resource === "phases" && String(input.action ?? "").trim() === "finalizePhase") {
      const result = await finalizeLeaguePhase(input, authorization.identity.email);
      return Response.json(result);
    }
    if (resource === "phase-schedules" && String(input.action ?? "").trim() === "saveSeriesPlanningSlot") {
      const result = await saveSeriesPlanningSlot(input, authorization.identity.email);
      return Response.json(result);
    }

    if (resource === "competitions") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireCompetitionAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "teams") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireTeamAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "participations") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireParticipationAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "competition-venues") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireCompetitionVenueAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "phases") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      const phase = await requirePhaseAccess(user, String(input.id ?? ""), "manage");
      await requirePhaseConfigurationAccess(
        authorization.identity,
        input,
        phase.competitionId,
      );
    }

    const result = await updateLeagueEntity(
      resource,
      input,
      authorization.identity.email,
    );

    return Response.json(result);
  } catch (error) {
    const authorizationResponse = platformAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
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
    && resource !== "competition-venues"
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
    if (resource === "competitions") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireCompetitionAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "teams") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireTeamAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "participations") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireParticipationAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "competition-venues") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requireCompetitionVenueAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "phases") {
      const user = await resolveCanonicalAppUser(authorization.identity);
      await requirePhaseAccess(user, String(input.id ?? ""), "manage");
    }
    const result = resource === "seasons"
      ? await deleteLeagueSeason(input, authorization.identity.email)
      : resource === "competitions"
        ? await deleteLeagueCompetition(input, authorization.identity.email)
        : resource === "phases"
          ? await deleteLeaguePhase(input, authorization.identity.email)
        : resource === "phase-schedules"
          ? String(input.action ?? "").trim() === "deletePhaseProgram"
            ? await deletePhaseProgram(input, authorization.identity.email)
            : await deleteLeaguePhaseSchedule(input, authorization.identity.email)
        : resource === "teams"
          ? await deleteLeagueTeam(input, authorization.identity.email)
          : resource === "competition-venues"
            ? await deleteLeagueCompetitionVenue(input, authorization.identity.email)
            : await deleteLeagueParticipation(input, authorization.identity.email);

    return Response.json(result);
  } catch (error) {
    const authorizationResponse = platformAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    const phaseProgramError = error instanceof DeletePhaseProgramError ? error : null;
    return Response.json(
      {
        ...(phaseProgramError ? { code: phaseProgramError.code } : {}),
        error:
          error instanceof Error
            ? error.message
            : "Η διαγραφή απέτυχε.",
      },
      { status: phaseProgramError ? 409 : 400 },
    );
  }
}


