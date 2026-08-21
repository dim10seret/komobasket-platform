import { requireAdmin } from "@/lib/admin-auth";
import {
  resolveCanonicalAppUser,
  resolvePlatformReadContext,
} from "@/lib/app-user-identity";
import {
  departPlayer,
  searchAthletesForRosterFoundation,
  searchStaffForRosterFoundation,
  createAthleteWithRoster,
  addExistingAthleteToRoster,
  bulkAddExistingAthletesToRoster,
  updateAthleteCanonical,
  updateRosterShirtNumber,
  removeAthleteFromRoster,
  transferAthleteBetweenTeams,
  createStaffWithRoster,
  addExistingStaffToRoster,
  updateStaffCanonical,
  updateStaffMembership,
  removeStaffFromRoster,
  copyPreviousRosterForTeam,
  bulkScheduleGames,
  finalizeLeaguePhase,
  finalizePhaseById,
  getLeagueAdminSnapshot,
  getTeamRosterManagementView,
} from "@/services/league-admin.service";

export async function GET(request: Request) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const canonicalUser = await resolveCanonicalAppUser(authorization.identity);
    const platformContext = await resolvePlatformReadContext(canonicalUser);
    const requestUrl = new URL(request.url);
    const view = requestUrl.searchParams.get("view");
    if (view === "organizations") {
      return Response.json({
        selectedOrganizationId: platformContext.organizationId,
        organizations: platformContext.accessibleOrganizations,
      });
    }
    if (view === "team-roster") {
      const seasonId = requestUrl.searchParams.get("seasonId")?.trim() || "";
      const competitionId = requestUrl.searchParams.get("competitionId")?.trim() || "";
      const teamId = requestUrl.searchParams.get("teamId")?.trim() || "";
      if (!seasonId || !competitionId || !teamId) {
        return Response.json({ error: "Λείπει seasonId ή competitionId ή teamId." }, { status: 400 });
      }
      return Response.json({
        view: "team-roster",
        data: await getTeamRosterManagementView(
          seasonId,
          competitionId,
          teamId,
          platformContext.organizationId,
        ),
      });
    }

    return Response.json(await getLeagueAdminSnapshot(platformContext.organizationId));
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
    const action = String(input.action ?? "");
    if (action === "departure" || action === "removeAthleteFromRoster") {
      return Response.json(await removeAthleteFromRoster({ rosterId: String(input.rosterId ?? ""), effectiveOn: input.effectiveOn ? String(input.effectiveOn) : null }));
    }
    if (action === "searchAthletes") {
      const canonicalUser = await resolveCanonicalAppUser(authorization.identity);
      const platformContext = await resolvePlatformReadContext(canonicalUser);
      return Response.json(await searchAthletesForRosterFoundation({
        query: String(input.query ?? ""),
        limit: input.limit ? Number(input.limit) : undefined,
      }, platformContext.organizationId));
    }
    if (action === "searchStaff") {
      const canonicalUser = await resolveCanonicalAppUser(authorization.identity);
      const platformContext = await resolvePlatformReadContext(canonicalUser);
      return Response.json(await searchStaffForRosterFoundation({
        query: String(input.query ?? ""),
        limit: input.limit ? Number(input.limit) : undefined,
      }, platformContext.organizationId));
    }
    if (action === "createAthleteWithRoster") {
      return Response.json(await createAthleteWithRoster({
        firstName: String(input.firstName ?? ""),
        lastName: String(input.lastName ?? ""),
        birthDate: input.birthDate ? String(input.birthDate) : null,
        photoUrl: input.photoUrl ? String(input.photoUrl) : null,
        seasonId: String(input.seasonId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
        shirtNumber: input.shirtNumber ? Number(input.shirtNumber) : null,
      }));
    }
    if (action === "addExistingAthlete") {
      return Response.json(await addExistingAthleteToRoster({
        playerId: String(input.playerId ?? ""),
        seasonId: String(input.seasonId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
        shirtNumber: input.shirtNumber ? Number(input.shirtNumber) : null,
      }));
    }
    if (action === "transferAthlete") {
      return Response.json(await transferAthleteBetweenTeams({
        playerId: String(input.playerId ?? ""),
        seasonId: String(input.seasonId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        fromTeamId: String(input.fromTeamId ?? ""),
        toTeamId: String(input.toTeamId ?? ""),
        shirtNumber: input.shirtNumber ? Number(input.shirtNumber) : null,
        effectiveOn: input.effectiveOn ? String(input.effectiveOn) : null,
        note: input.note ? String(input.note) : null,
      }));
    }
    if (action === "bulkAddExistingAthletes") {
      return Response.json(await bulkAddExistingAthletesToRoster({
        seasonId: String(input.seasonId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
        items: Array.isArray(input.items) ? input.items.map((item) => ({
          playerId: String((item as Record<string, unknown>).playerId ?? ""),
          shirtNumber: (item as Record<string, unknown>).shirtNumber ? Number((item as Record<string, unknown>).shirtNumber) : null,
        })) : [],
      }));
    }
    if (action === "updateAthleteCanonical") {
      return Response.json(await updateAthleteCanonical({
        playerId: String(input.playerId ?? ""),
        firstName: input.firstName === undefined ? undefined : input.firstName === null ? null : String(input.firstName),
        lastName: input.lastName === undefined ? undefined : input.lastName === null ? null : String(input.lastName),
        displayName: input.displayName ? String(input.displayName) : undefined,
        birthDate: input.birthDate === undefined ? undefined : input.birthDate ? String(input.birthDate) : null,
        photoUrl: input.photoUrl === undefined ? undefined : input.photoUrl ? String(input.photoUrl) : null,
      }));
    }
    if (action === "updateAthleteShirt") {
      return Response.json(await updateRosterShirtNumber({
        rosterId: String(input.rosterId ?? ""),
        shirtNumber: input.shirtNumber ? Number(input.shirtNumber) : null,
      }));
    }
    if (action === "createStaffWithRoster") {
      return Response.json(await createStaffWithRoster({
        firstName: String(input.firstName ?? ""),
        lastName: String(input.lastName ?? ""),
        birthDate: input.birthDate ? String(input.birthDate) : null,
        photoUrl: input.photoUrl ? String(input.photoUrl) : null,
        role: String(input.role ?? "other"),
        customRoleLabel: input.customRoleLabel ? String(input.customRoleLabel) : null,
        seasonId: String(input.seasonId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
      }));
    }
    if (action === "addExistingStaff") {
      return Response.json(await addExistingStaffToRoster({
        staffId: String(input.staffId ?? ""),
        seasonId: String(input.seasonId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
        role: String(input.role ?? "other"),
        customRoleLabel: input.customRoleLabel ? String(input.customRoleLabel) : null,
      }));
    }
    if (action === "updateStaffCanonical") {
      return Response.json(await updateStaffCanonical({
        staffId: String(input.staffId ?? ""),
        firstName: input.firstName === undefined ? undefined : input.firstName === null ? null : String(input.firstName),
        lastName: input.lastName === undefined ? undefined : input.lastName === null ? null : String(input.lastName),
        displayName: input.displayName ? String(input.displayName) : undefined,
        birthDate: input.birthDate === undefined ? undefined : input.birthDate ? String(input.birthDate) : null,
        photoUrl: input.photoUrl === undefined ? undefined : input.photoUrl ? String(input.photoUrl) : null,
      }));
    }
    if (action === "updateStaffMembership") {
      return Response.json(await updateStaffMembership({
        membershipId: String(input.membershipId ?? ""),
        role: String(input.role ?? "other"),
        customRoleLabel: input.customRoleLabel ? String(input.customRoleLabel) : null,
      }));
    }
    if (action === "removeStaffFromRoster") {
      return Response.json(await removeStaffFromRoster({ membershipId: String(input.membershipId ?? "") }));
    }
    if (action === "copyPreviousRoster") {
      return Response.json(await copyPreviousRosterForTeam({
        seasonId: String(input.seasonId ?? ""),
        competitionId: String(input.competitionId ?? ""),
        teamId: String(input.teamId ?? ""),
      }));
    }
    if (action === "bulkScheduleGames") {
      return Response.json(await bulkScheduleGames({
        competitionId: String(input.competitionId ?? ""),
        gameIds: Array.isArray(input.gameIds) ? input.gameIds : [],
        scheduledDateMode: String(input.scheduledDateMode ?? input.scheduled_date_mode ?? "keep"),
        scheduledDate: input.scheduledDate ?? input.scheduled_date ?? null,
        scheduledTimeMode: String(input.scheduledTimeMode ?? input.scheduled_time_mode ?? "keep"),
        scheduledTime: input.scheduledTime ?? input.scheduled_time ?? null,
        venueMode: String(input.venueMode ?? input.venue_mode ?? "keep"),
        venueId: input.venueId ?? input.venue_id ?? null,
      }, authorization.identity.email));
    }
    if (action === "finalizePhase") {
      const phaseId = String(input.phaseId ?? input.phase_id ?? "").trim();
      const competitionId = String(input.competitionId ?? input.competition_id ?? "").trim();
      if (!phaseId || !competitionId) {
        return Response.json({ error: "Λείπει phaseId ή competitionId." }, { status: 400 });
      }
      return Response.json(await finalizeLeaguePhase({ phaseId, competitionId }, authorization.identity.email));
    }
    if (action === "departPlayerLegacy") {
      return Response.json(await departPlayer(input, authorization.identity.email));
    }

    return Response.json({ error: "Μη υποστηριζόμενη ενέργεια." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." },
      { status: 400 },
    );
  }
}
