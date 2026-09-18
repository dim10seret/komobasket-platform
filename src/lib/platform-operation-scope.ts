import "server-only";
import * as authorization from "@/lib/platform-authorization";

// Restrict shared business operations to the explicitly selected organization.
// The existing Admin authorization helpers and their default behavior are unchanged.
export function platformOperationScope(organizationId?: string) {
  async function checked<T extends { organizationId: string }>(pending: Promise<T>): Promise<T> {
    const access = await pending;
    if (organizationId && access.organizationId !== organizationId) {
      throw new authorization.PlatformAuthorizationError("resource_unavailable", "Ο ζητούμενος πόρος δεν είναι διαθέσιμος.", 404);
    }
    return access;
  }
  return {
    requireCompetitionAccess: (...args: Parameters<typeof authorization.requireCompetitionAccess>) => checked(authorization.requireCompetitionAccess(...args)),
    requireCompetitionVenueAccess: (...args: Parameters<typeof authorization.requireCompetitionVenueAccess>) => checked(authorization.requireCompetitionVenueAccess(...args)),
    requireGameAccess: (...args: Parameters<typeof authorization.requireGameAccess>) => checked(authorization.requireGameAccess(...args)),
    requireOrganizationAccess: (...args: Parameters<typeof authorization.requireOrganizationAccess>) => checked(authorization.requireOrganizationAccess(...args)),
    requirePhaseDependencyGraphAccess: (...args: Parameters<typeof authorization.requirePhaseDependencyGraphAccess>) => checked(authorization.requirePhaseDependencyGraphAccess(...args)),
    requirePlayerAccess: (...args: Parameters<typeof authorization.requirePlayerAccess>) => checked(authorization.requirePlayerAccess(...args)),
    requireRosterMembershipAccess: (...args: Parameters<typeof authorization.requireRosterMembershipAccess>) => checked(authorization.requireRosterMembershipAccess(...args)),
    requireRosterRelationshipAccess: (...args: Parameters<typeof authorization.requireRosterRelationshipAccess>) => checked(authorization.requireRosterRelationshipAccess(...args)),
    requireStaffAccess: (...args: Parameters<typeof authorization.requireStaffAccess>) => checked(authorization.requireStaffAccess(...args)),
    requireStaffMembershipAccess: (...args: Parameters<typeof authorization.requireStaffMembershipAccess>) => checked(authorization.requireStaffMembershipAccess(...args)),
    requireStaffRosterRelationshipAccess: (...args: Parameters<typeof authorization.requireStaffRosterRelationshipAccess>) => checked(authorization.requireStaffRosterRelationshipAccess(...args)),
    requireTeamCompetitionAccess: (...args: Parameters<typeof authorization.requireTeamCompetitionAccess>) => checked(authorization.requireTeamCompetitionAccess(...args)),
    requireTransferRelationshipAccess: (...args: Parameters<typeof authorization.requireTransferRelationshipAccess>) => checked(authorization.requireTransferRelationshipAccess(...args)),
    requireParticipationAccess: (...args: Parameters<typeof authorization.requireParticipationAccess>) => checked(authorization.requireParticipationAccess(...args)),
    requirePhaseAccess: (...args: Parameters<typeof authorization.requirePhaseAccess>) => checked(authorization.requirePhaseAccess(...args)),
    requireScheduleAccess: (...args: Parameters<typeof authorization.requireScheduleAccess>) => checked(authorization.requireScheduleAccess(...args)),
    requireSourcePhaseAccess: (...args: Parameters<typeof authorization.requireSourcePhaseAccess>) => checked(authorization.requireSourcePhaseAccess(...args)),
    requireSourcePhaseMatchupAccess: (...args: Parameters<typeof authorization.requireSourcePhaseMatchupAccess>) => checked(authorization.requireSourcePhaseMatchupAccess(...args)),
    requireTeamAccess: (...args: Parameters<typeof authorization.requireTeamAccess>) => checked(authorization.requireTeamAccess(...args)),
  };
}
