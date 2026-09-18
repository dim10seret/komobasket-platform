import {
  resolvePlatformReadContext,
} from "@/lib/app-user-identity";
import {
  PlatformAuthorizationError,
  platformAuthorizationErrorResponse,
  requireCompetitionAccess,
  requireCompetitionVenueAccess,
  requireGameAccess,
  requireOrganizationAccess,
  requireParticipationAccess,
  requirePhaseAccess,
  requirePhaseDependencyGraphAccess,
  requireRosterRelationshipAccess,
  requireScheduleAccess,
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

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { platformOperationScope } from "@/lib/platform-operation-scope";

export function platformLeagueResources(actor: CanonicalAppUser, scopeOrganizationId?: string) {
 const { requireCompetitionAccess, requireCompetitionVenueAccess, requireGameAccess, requireOrganizationAccess, requirePhaseDependencyGraphAccess, requireRosterRelationshipAccess, requireTeamCompetitionAccess, requireParticipationAccess, requirePhaseAccess, requireScheduleAccess, requireSourcePhaseAccess, requireSourcePhaseMatchupAccess, requireTeamAccess } = platformOperationScope(scopeOrganizationId);
 const resolveActor = async (identity: CanonicalAppUser) => identity;

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
  identity: CanonicalAppUser,
  input: Record<string, unknown>,
) {
  const user = await resolveActor(identity);
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
  identity: CanonicalAppUser,
  input: Record<string, unknown>,
  fallbackCompetitionId = "",
) {
  const user = await resolveActor(identity);
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

function rejectResourceMismatch(): never {
  throw new PlatformAuthorizationError(
    "resource_unavailable",
    "Ο ζητούμενος πόρος δεν είναι διαθέσιμος.",
    404,
  );
}

function requireMatchingId(actual: string | null, expected: string, supplied: unknown) {
  const requested = String(supplied ?? "").trim();
  if (requested && requested !== expected) rejectResourceMismatch();
  if (requested && actual !== null && requested !== actual) rejectResourceMismatch();
}

async function requirePhaseProgramAccess(
  identity: CanonicalAppUser,
  input: Record<string, unknown>,
) {
  const user = await resolveActor(identity);
  const phaseId = String(input.phaseId ?? input.phase_id ?? "").trim();
  const phase = await requirePhaseAccess(user, phaseId, "manage");
  requireMatchingId(
    phase.competitionId,
    phase.competitionId,
    input.competitionId ?? input.competition_id,
  );

  const scheduleId = String(input.scheduleId ?? input.schedule_id ?? "").trim();
  if (scheduleId) {
    const schedule = await requireScheduleAccess(user, scheduleId, "manage");
    if (
      schedule.phaseId !== phase.phaseId
      || schedule.competitionId !== phase.competitionId
    ) {
      rejectResourceMismatch();
    }
  }
  return { user, phase };
}

async function requireScheduleMutationAccess(
  identity: CanonicalAppUser,
  input: Record<string, unknown>,
) {
  const user = await resolveActor(identity);
  const scheduleId = String(input.id ?? input.scheduleId ?? input.schedule_id ?? "").trim();
  const schedule = await requireScheduleAccess(user, scheduleId, "manage");
  requireMatchingId(
    schedule.competitionId,
    schedule.competitionId,
    input.competitionId ?? input.competition_id,
  );
  requireMatchingId(
    schedule.phaseId,
    schedule.phaseId,
    input.phaseId ?? input.phase_id,
  );
  return { user, schedule };
}

async function requireGameMutationAccess(
  identity: CanonicalAppUser,
  input: Record<string, unknown>,
  existingGameId = "",
) {
  const user = await resolveActor(identity);
  const gameId = String(existingGameId || input.id || "").trim();
  const existingGame = gameId
    ? await requireGameAccess(user, gameId, "manage")
    : null;
  const competitionId = String(
    input.competitionId
      ?? input.competition_id
      ?? existingGame?.competitionId
      ?? "",
  ).trim();
  const competition = await requireCompetitionAccess(user, competitionId, "manage");
  if (existingGame && existingGame.competitionId !== competition.competitionId) {
    rejectResourceMismatch();
  }

  if (existingGame?.phaseId) {
    const canonicalPhase = await requirePhaseAccess(user, existingGame.phaseId, "manage");
    if (canonicalPhase.competitionId !== competition.competitionId) {
      rejectResourceMismatch();
    }
  }

  if (existingGame?.scheduleId) {
    const canonicalSchedule = await requireScheduleAccess(user, existingGame.scheduleId, "manage");
    if (
      canonicalSchedule.competitionId !== competition.competitionId
      || (existingGame.phaseId && canonicalSchedule.phaseId !== existingGame.phaseId)
    ) {
      rejectResourceMismatch();
    }
  }

  const phaseId = String(input.phaseId ?? input.phase_id ?? "").trim();
  if (phaseId) {
    const phase = await requirePhaseAccess(user, phaseId, "manage");
    if (phase.competitionId !== competition.competitionId) rejectResourceMismatch();
    if (existingGame?.phaseId && existingGame.phaseId !== phase.phaseId) rejectResourceMismatch();
  }

  const scheduleId = String(input.scheduleId ?? input.schedule_id ?? "").trim();
  if (scheduleId) {
    const schedule = await requireScheduleAccess(user, scheduleId, "manage");
    if (schedule.competitionId !== competition.competitionId) rejectResourceMismatch();
    if (phaseId && schedule.phaseId !== phaseId) rejectResourceMismatch();
    if (existingGame?.scheduleId && existingGame.scheduleId !== schedule.scheduleId) {
      rejectResourceMismatch();
    }
  }

  const teamIds = [
    input.homeTeamId ?? input.home_team_id,
    input.awayTeamId ?? input.away_team_id,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  await Promise.all(teamIds.map((teamId) => requireTeamCompetitionAccess(
    user,
    { competitionId: competition.competitionId, teamId },
    "manage",
  )));

  const venueId = String(input.venueId ?? input.venue_id ?? "").trim();
  if (venueId) {
    const venue = await requireCompetitionVenueAccess(user, venueId, "manage");
    if (venue.competitionId !== competition.competitionId) rejectResourceMismatch();
  }
  return { user, competition, existingGame };
}

async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
const { resource } = await context.params;

  if (!resources.has(resource)) {
    return Response.json(
      { error: "Άγνωστη κατηγορία διαχείρισης." },
      { status: 404 },
    );
  }

  try {
    const input = (await request.json()) as Record<string, unknown>;
    if (scopeOrganizationId && resource === "phase-schedules" && request.method === "POST") await requirePhaseProgramAccess(actor, input);
    if (scopeOrganizationId && resource === "participations" && request.method === "POST") {
      if (input.teamIds !== undefined && !Array.isArray(input.teamIds)) return Response.json({error:"INVALID_TEAM_SELECTION"},{status:400});
      await requireCompetitionAccess(actor, String(input.competitionId || ""), "manage");
    }
    if (scopeOrganizationId && input.sourceCompetitionId) await requireCompetitionAccess(actor, String(input.sourceCompetitionId), "read");

    if (resource === "competitions" && String(input.action ?? "").trim() === "cleanup") {
      const user = await resolveActor(actor);
      await requireCompetitionAccess(user, String(input.id ?? ""), "manage");
      const result = await cleanupLeagueCompetition(input, actor.email);
      return Response.json(result);
    }
    if (resource === "phase-schedules" && ["generateRoundRobinGames", "materializePhaseProgram"].includes(String(input.action ?? "").trim())) {
      await requirePhaseProgramAccess(actor, input);
      const result = await materializePhaseProgram(input, actor.email);
      return Response.json(result);
    }

    let organizationId: string | undefined;
    if (["competitions", "teams", "players"].includes(resource)) {
      organizationId = (await requireCreateOrganization(actor, input)).organizationId;
    } else if (resource === "phases") {
      await requirePhaseConfigurationAccess(actor, input);
    } else if (resource === "competition-venues") {
      const user = await resolveActor(actor);
      await requireCompetitionAccess(user, String(input.competitionId ?? ""), "manage");
    } else if (resource === "participations") {
      const user = await resolveActor(actor);
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
      const user = await resolveActor(actor);
      await requireRosterRelationshipAccess(user, {
        playerId: String(input.playerId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
      }, "manage");
    } else if (resource === "games") {
      await requireGameMutationAccess(actor, input);
    }

    const result = await createLeagueEntity(
      resource,
      input,
      actor.email,
      organizationId,
      scopeOrganizationId,
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

async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
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
    if (scopeOrganizationId && resource === "phase-schedules" && request.method === "POST") await requirePhaseProgramAccess(actor, input);
    if (scopeOrganizationId && resource === "participations" && request.method === "POST") {
      if (input.teamIds !== undefined && !Array.isArray(input.teamIds)) return Response.json({error:"INVALID_TEAM_SELECTION"},{status:400});
      await requireCompetitionAccess(actor, String(input.competitionId || ""), "manage");
    }
    if (scopeOrganizationId && input.sourceCompetitionId) await requireCompetitionAccess(actor, String(input.sourceCompetitionId), "read");

    if (resource === "phases" && String(input.action ?? "").trim() === "finalizePhase") {
      const user = await resolveActor(actor);
      const phaseId = String(input.phaseId ?? input.phase_id ?? input.id ?? "").trim();
      const phase = await requirePhaseDependencyGraphAccess(user, phaseId, "manage");
      requireMatchingId(
        phase.competitionId,
        phase.competitionId,
        input.competitionId ?? input.competition_id,
      );
      const result = await finalizeLeaguePhase(input, actor.email);
      return Response.json(result);
    }
    if (resource === "phase-schedules" && String(input.action ?? "").trim() === "saveSeriesPlanningSlot") {
      const { user, phase } = await requirePhaseProgramAccess(actor, input);
      const matchupId = String(input.matchupId ?? input.matchup_id ?? "").trim();
      if (matchupId) {
        await requireSourcePhaseMatchupAccess(user, {
          targetCompetitionId: phase.competitionId,
          sourcePhaseId: phase.phaseId,
          matchupId,
        }, "manage");
      }
      const result = await saveSeriesPlanningSlot(input, actor.email);
      return Response.json(result);
    }

    if (resource === "competitions") {
      const user = await resolveActor(actor);
      await requireCompetitionAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "teams") {
      const user = await resolveActor(actor);
      await requireTeamAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "participations") {
      const user = await resolveActor(actor);
      await requireParticipationAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "competition-venues") {
      const user = await resolveActor(actor);
      await requireCompetitionVenueAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "phases") {
      const user = await resolveActor(actor);
      const phase = await requirePhaseAccess(user, String(input.id ?? ""), "manage");
      await requirePhaseConfigurationAccess(
        actor,
        input,
        phase.competitionId,
      );
    } else if (resource === "phase-schedules") {
      await requireScheduleMutationAccess(actor, input);
    } else if (resource === "games") {
      await requireGameMutationAccess(
        actor,
        input,
        String(input.id ?? ""),
      );
    }

    const result = await updateLeagueEntity(
      resource,
      input,
      actor.email,
      scopeOrganizationId,
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

async function DELETE(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
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
    if (scopeOrganizationId && resource === "phase-schedules" && request.method === "POST") await requirePhaseProgramAccess(actor, input);
    if (scopeOrganizationId && resource === "participations" && request.method === "POST") {
      if (input.teamIds !== undefined && !Array.isArray(input.teamIds)) return Response.json({error:"INVALID_TEAM_SELECTION"},{status:400});
      await requireCompetitionAccess(actor, String(input.competitionId || ""), "manage");
    }
    if (scopeOrganizationId && input.sourceCompetitionId) await requireCompetitionAccess(actor, String(input.sourceCompetitionId), "read");
    if (resource === "competitions") {
      const user = await resolveActor(actor);
      await requireCompetitionAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "teams") {
      const user = await resolveActor(actor);
      await requireTeamAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "participations") {
      const user = await resolveActor(actor);
      await requireParticipationAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "competition-venues") {
      const user = await resolveActor(actor);
      await requireCompetitionVenueAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "phases") {
      const user = await resolveActor(actor);
      await requirePhaseAccess(user, String(input.id ?? ""), "manage");
    } else if (resource === "phase-schedules") {
      if (String(input.action ?? "").trim() === "deletePhaseProgram") {
        await requirePhaseProgramAccess(actor, input);
      } else {
        await requireScheduleMutationAccess(actor, input);
      }
    }
    const result = resource === "seasons"
      ? await deleteLeagueSeason(input, actor.email)
      : resource === "competitions"
        ? await deleteLeagueCompetition(input, actor.email)
        : resource === "phases"
          ? await deleteLeaguePhase(input, actor.email)
        : resource === "phase-schedules"
          ? String(input.action ?? "").trim() === "deletePhaseProgram"
            ? await deletePhaseProgram(input, actor.email)
            : await deleteLeaguePhaseSchedule(input, actor.email)
        : resource === "teams"
          ? await deleteLeagueTeam(input, actor.email)
          : resource === "competition-venues"
            ? await deleteLeagueCompetitionVenue(input, actor.email)
            : await deleteLeagueParticipation(input, actor.email);

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




 return { POST, PATCH, DELETE };
}
