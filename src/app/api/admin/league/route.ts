import { requireAdmin } from "@/lib/admin-auth";
import {
  listAccessibleOrganizations,
  resolveCanonicalAppUser,
  resolvePlatformReadContext,
} from "@/lib/app-user-identity";
import {
  PlatformAuthorizationError,
  platformAuthorizationErrorResponse,
  requireCompetitionAccess,
  requireCompetitionVenueAccess,
  requireGameAccess,
  requireOrganizationAccess,
  requirePhaseDependencyGraphAccess,
  requirePlayerAccess,
  requireRosterMembershipAccess,
  requireRosterRelationshipAccess,
  requireStaffAccess,
  requireStaffMembershipAccess,
  requireStaffRosterRelationshipAccess,
  requireTeamCompetitionAccess,
  requireTransferRelationshipAccess,
} from "@/lib/platform-authorization";
import {
  departPlayer,
  searchAthletesForRosterFoundation,
  searchStaffForRosterFoundation,
  createAthleteCanonical,
  createAthleteWithRoster,
  addExistingAthleteToRoster,
  addAthleteToCompetitionRosterWithMovement,
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
  listCompetitionLatestMovements,
} from "@/services/league-admin.service";
import { platformLeagueActions } from "@/services/platform-league-actions";

export async function GET(request: Request) {
  const authorization = await requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    const canonicalUser = await resolveCanonicalAppUser(authorization.identity);
    const accessibleOrganizations = await listAccessibleOrganizations(canonicalUser);
    const requestUrl = new URL(request.url);
    const view = requestUrl.searchParams.get("view");
    if (view === "organizations") {
      return Response.json({
        isSuperAdmin: canonicalUser.isSuperAdmin,
        organizations: accessibleOrganizations.map((organization) => ({
          ...organization,
          status: "active" as const,
        })),
      });
    }
    const requestedOrganizationId = requestUrl.searchParams.get("organizationId")?.trim() || "";
    const selectedOrganization = requestedOrganizationId
      ? await requireOrganizationAccess(canonicalUser, requestedOrganizationId, "read")
      : await resolvePlatformReadContext(canonicalUser).then((context) => ({
          organizationId: context.organizationId,
          organizationSlug: context.organization.slug,
          organizationName: context.organization.name,
          role: context.organization.role,
        }));
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
          selectedOrganization.organizationId,
        ),
      });
    }
    if (view === "competition-latest-movements") {
      const seasonId = requestUrl.searchParams.get("seasonId")?.trim() || "";
      const competitionId = requestUrl.searchParams.get("competitionId")?.trim() || "";
      if (!seasonId || !competitionId) {
        return Response.json({ error: "Λείπει seasonId ή competitionId." }, { status: 400 });
      }
      return Response.json({
        view: "competition-latest-movements",
        data: await listCompetitionLatestMovements({
          organizationId: selectedOrganization.organizationId,
          seasonId,
          competitionId,
        }),
      });
    }

    return Response.json({
      ...(await getLeagueAdminSnapshot(selectedOrganization.organizationId)),
      organizationContext: {
        organizationId: selectedOrganization.organizationId,
        slug: selectedOrganization.organizationSlug,
        name: selectedOrganization.organizationName,
        logoUrl: accessibleOrganizations.find(
          (organization) => organization.organizationId === selectedOrganization.organizationId,
        )?.logoUrl ?? null,
        role: selectedOrganization.role,
      },
    });
  } catch (error) {
    const authorizationResponse = platformAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return Response.json(
      { error: error instanceof Error ? error.message : "Αποτυχία φόρτωσης." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireAdmin(request);
  if (authorization.response) return authorization.response;
  try {
    return await platformLeagueActions(await resolveCanonicalAppUser(authorization.identity)).PATCH(request);
  } catch (error) {
    return platformAuthorizationErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Η ενέργεια απέτυχε." }, { status: 400 });
  }
}
