import "server-only";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type PlatformPermissionMode = "read" | "manage";

export type PlatformAuthorizationErrorCode =
  | "unauthenticated"
  | "inactive_user"
  | "organization_unavailable"
  | "inaccessible_organization"
  | "insufficient_permission"
  | "resource_unavailable";

export class PlatformAuthorizationError extends Error {
  readonly code: PlatformAuthorizationErrorCode;
  readonly httpStatus: 401 | 403 | 404;

  constructor(
    code: PlatformAuthorizationErrorCode,
    message: string,
    httpStatus: 401 | 403 | 404,
  ) {
    super(message);
    this.name = "PlatformAuthorizationError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

type AuthoritativeUserRow = {
  id: string;
  status: "active" | "disabled";
  is_super_admin: number;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
};

type MembershipRow = {
  role: "admin" | "viewer";
  status: "active" | "invited" | "revoked";
};

export type OrganizationPermissionDecision =
  | {
      allowed: true;
      role: "super_admin" | "admin" | "viewer";
    }
  | {
      allowed: false;
      reason: Exclude<PlatformAuthorizationErrorCode, "resource_unavailable">;
    };

export type OrganizationAccessContext = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  mode: PlatformPermissionMode;
  role: "super_admin" | "admin" | "viewer";
};

export type ResourceAccessContext = OrganizationAccessContext & {
  resourceId: string;
};

export type CompetitionAccessContext = ResourceAccessContext & {
  competitionId: string;
};

export type PhaseAccessContext = CompetitionAccessContext & {
  phaseId: string;
};

export type ScheduleAccessContext = PhaseAccessContext & {
  scheduleId: string;
};

export type GameAccessContext = CompetitionAccessContext & {
  gameId: string;
  phaseId: string | null;
  scheduleId: string | null;
};

export type RosterRelationshipAccessContext = OrganizationAccessContext & {
  competitionId: string;
  teamId: string;
  playerId: string;
};

export type SourcePhaseAccessContext = CompetitionAccessContext & {
  sourcePhaseId: string;
  sourceCompetitionId: string;
};

export function evaluateOrganizationPermission(input: {
  user: AuthoritativeUserRow | null;
  organization: OrganizationRow | null;
  membership: MembershipRow | null;
  mode: PlatformPermissionMode;
}): OrganizationPermissionDecision {
  if (!input.user) {
    return { allowed: false, reason: "unauthenticated" };
  }
  if (input.user.status !== "active") {
    return { allowed: false, reason: "inactive_user" };
  }
  if (!input.organization || input.organization.status !== "active") {
    return { allowed: false, reason: "organization_unavailable" };
  }
  if (input.user.is_super_admin === 1) {
    return { allowed: true, role: "super_admin" };
  }
  if (!input.membership || input.membership.status !== "active") {
    return { allowed: false, reason: "inaccessible_organization" };
  }
  if (input.mode === "manage" && input.membership.role !== "admin") {
    return { allowed: false, reason: "insufficient_permission" };
  }
  return { allowed: true, role: input.membership.role };
}

function authorizationError(code: PlatformAuthorizationErrorCode) {
  if (code === "unauthenticated") {
    return new PlatformAuthorizationError(
      code,
      "Απαιτείται πιστοποιημένη ταυτότητα εφαρμογής.",
      401,
    );
  }
  if (code === "inactive_user") {
    return new PlatformAuthorizationError(
      code,
      "Ο χρήστης εφαρμογής δεν είναι ενεργός.",
      403,
    );
  }
  if (code === "insufficient_permission") {
    return new PlatformAuthorizationError(
      code,
      "Δεν υπάρχει δικαίωμα διαχείρισης για τον επιλεγμένο Οργανισμό.",
      403,
    );
  }
  if (code === "resource_unavailable") {
    return new PlatformAuthorizationError(
      code,
      "Ο ζητούμενος πόρος δεν είναι διαθέσιμος.",
      404,
    );
  }
  return new PlatformAuthorizationError(
    code,
    "Ο επιλεγμένος Οργανισμός δεν είναι διαθέσιμος.",
    403,
  );
}

async function requireDatabase() {
  const env = await getKomoBasketCloudflareEnv();
  const db = env?.NEWS_DB;
  if (!db) {
    throw new Error("Η canonical βάση εξουσιοδότησης δεν είναι διαθέσιμη.");
  }
  return db;
}

async function requireOrganizationAccessWithDb(
  db: D1DatabaseBinding,
  identity: CanonicalAppUser | null,
  organizationId: string,
  mode: PlatformPermissionMode,
): Promise<OrganizationAccessContext> {
  if (!identity) {
    throw authorizationError("unauthenticated");
  }

  const [user, organization, membership] = await Promise.all([
    db
      .prepare(
        `SELECT id, status, is_super_admin
         FROM league_app_users
         WHERE id = ?`,
      )
      .bind(identity.userId)
      .first<AuthoritativeUserRow>(),
    db
      .prepare(
        `SELECT id, slug, name, status
         FROM league_organizations
         WHERE id = ?`,
      )
      .bind(organizationId)
      .first<OrganizationRow>(),
    db
      .prepare(
        `SELECT role, status
         FROM league_organization_memberships
         WHERE organization_id = ? AND user_id = ?`,
      )
      .bind(organizationId, identity.userId)
      .first<MembershipRow>(),
  ]);

  const decision = evaluateOrganizationPermission({
    user,
    organization,
    membership,
    mode,
  });
  if (!decision.allowed) {
    throw authorizationError(decision.reason);
  }
  if (!organization) {
    throw authorizationError("organization_unavailable");
  }

  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    mode,
    role: decision.role,
  };
}

export async function requireOrganizationAccess(
  identity: CanonicalAppUser | null,
  organizationId: string,
  mode: PlatformPermissionMode,
) {
  const db = await requireDatabase();
  return requireOrganizationAccessWithDb(db, identity, organizationId, mode);
}

type OwnedResourceRow = {
  id: string;
  organization_id: string | null;
};

async function authorizeOwnedResource<T extends OwnedResourceRow>(
  db: D1DatabaseBinding,
  identity: CanonicalAppUser | null,
  mode: PlatformPermissionMode,
  resource: T | null,
) {
  if (!resource?.organization_id) {
    throw authorizationError("resource_unavailable");
  }
  try {
    const organization = await requireOrganizationAccessWithDb(
      db,
      identity,
      resource.organization_id,
      mode,
    );
    return { resource, organization };
  } catch (error) {
    if (
      error instanceof PlatformAuthorizationError &&
      error.code !== "unauthenticated" &&
      error.code !== "inactive_user"
    ) {
      throw authorizationError("resource_unavailable");
    }
    throw error;
  }
}

export async function requireCompetitionAccess(
  identity: CanonicalAppUser | null,
  competitionId: string,
  mode: PlatformPermissionMode,
): Promise<CompetitionAccessContext> {
  const db = await requireDatabase();
  const resource = await db
    .prepare(
      `SELECT id, organization_id
       FROM league_competitions
       WHERE id = ?`,
    )
    .bind(competitionId)
    .first<OwnedResourceRow>();
  const authorized = await authorizeOwnedResource(db, identity, mode, resource);
  return {
    ...authorized.organization,
    resourceId: authorized.resource.id,
    competitionId: authorized.resource.id,
  };
}

type PhaseRow = OwnedResourceRow & {
  competition_id: string;
};

export async function requirePhaseAccess(
  identity: CanonicalAppUser | null,
  phaseId: string,
  mode: PlatformPermissionMode,
): Promise<PhaseAccessContext> {
  const db = await requireDatabase();
  const resource = await db
    .prepare(
      `SELECT p.id, p.competition_id, c.organization_id
       FROM league_phases p
       JOIN league_competitions c ON c.id = p.competition_id
       WHERE p.id = ?`,
    )
    .bind(phaseId)
    .first<PhaseRow>();
  const authorized = await authorizeOwnedResource(db, identity, mode, resource);
  return {
    ...authorized.organization,
    resourceId: authorized.resource.id,
    phaseId: authorized.resource.id,
    competitionId: authorized.resource.competition_id,
  };
}

type ScheduleRow = PhaseRow & {
  phase_id: string;
};

export async function requireScheduleAccess(
  identity: CanonicalAppUser | null,
  scheduleId: string,
  mode: PlatformPermissionMode,
): Promise<ScheduleAccessContext> {
  const db = await requireDatabase();
  const resource = await db
    .prepare(
      `SELECT s.id, s.competition_id, s.phase_id, c.organization_id
       FROM league_phase_schedules s
       JOIN league_competitions c ON c.id = s.competition_id
       JOIN league_phases p
         ON p.id = s.phase_id AND p.competition_id = s.competition_id
       WHERE s.id = ?`,
    )
    .bind(scheduleId)
    .first<ScheduleRow>();
  const authorized = await authorizeOwnedResource(db, identity, mode, resource);
  return {
    ...authorized.organization,
    resourceId: authorized.resource.id,
    scheduleId: authorized.resource.id,
    phaseId: authorized.resource.phase_id,
    competitionId: authorized.resource.competition_id,
  };
}

type GameRow = OwnedResourceRow & {
  competition_id: string;
  phase_id: string | null;
  schedule_id: string | null;
};

export async function requireGameAccess(
  identity: CanonicalAppUser | null,
  gameId: string,
  mode: PlatformPermissionMode,
): Promise<GameAccessContext> {
  const db = await requireDatabase();
  const resource = await db
    .prepare(
      `SELECT g.id, g.competition_id, g.phase_id, g.schedule_id,
              c.organization_id
       FROM league_games g
       JOIN league_competitions c ON c.id = g.competition_id
       WHERE g.id = ?`,
    )
    .bind(gameId)
    .first<GameRow>();
  const authorized = await authorizeOwnedResource(db, identity, mode, resource);
  return {
    ...authorized.organization,
    resourceId: authorized.resource.id,
    gameId: authorized.resource.id,
    phaseId: authorized.resource.phase_id,
    scheduleId: authorized.resource.schedule_id,
    competitionId: authorized.resource.competition_id,
  };
}

async function requireRootResourceAccess(
  table: "league_players" | "league_teams" | "league_staff",
  identity: CanonicalAppUser | null,
  resourceId: string,
  mode: PlatformPermissionMode,
): Promise<ResourceAccessContext> {
  const db = await requireDatabase();
  const resource = await db
    .prepare(`SELECT id, organization_id FROM ${table} WHERE id = ?`)
    .bind(resourceId)
    .first<OwnedResourceRow>();
  const authorized = await authorizeOwnedResource(db, identity, mode, resource);
  return {
    ...authorized.organization,
    resourceId: authorized.resource.id,
  };
}

export function requirePlayerAccess(
  identity: CanonicalAppUser | null,
  playerId: string,
  mode: PlatformPermissionMode,
) {
  return requireRootResourceAccess("league_players", identity, playerId, mode);
}

export function requireTeamAccess(
  identity: CanonicalAppUser | null,
  teamId: string,
  mode: PlatformPermissionMode,
) {
  return requireRootResourceAccess("league_teams", identity, teamId, mode);
}

export function requireStaffAccess(
  identity: CanonicalAppUser | null,
  staffId: string,
  mode: PlatformPermissionMode,
) {
  return requireRootResourceAccess("league_staff", identity, staffId, mode);
}

type RosterRelationshipRow = {
  player_id: string;
  player_organization_id: string | null;
  team_id: string;
  team_organization_id: string | null;
  competition_id: string;
  competition_organization_id: string | null;
};

export async function requireRosterRelationshipAccess(
  identity: CanonicalAppUser | null,
  input: {
    playerId: string;
    teamId: string;
    competitionId: string;
  },
  mode: PlatformPermissionMode = "manage",
): Promise<RosterRelationshipAccessContext> {
  const db = await requireDatabase();
  const relationship = await db
    .prepare(
      `SELECT p.id AS player_id,
              p.organization_id AS player_organization_id,
              t.id AS team_id,
              t.organization_id AS team_organization_id,
              c.id AS competition_id,
              c.organization_id AS competition_organization_id
       FROM league_players p
       JOIN league_teams t ON t.id = ?
       JOIN league_competitions c ON c.id = ?
       WHERE p.id = ?`,
    )
    .bind(input.teamId, input.competitionId, input.playerId)
    .first<RosterRelationshipRow>();

  const organizationId = relationship?.competition_organization_id;
  if (
    !relationship ||
    !organizationId ||
    relationship.player_organization_id !== organizationId ||
    relationship.team_organization_id !== organizationId
  ) {
    throw authorizationError("resource_unavailable");
  }

  try {
    const organization = await requireOrganizationAccessWithDb(
      db,
      identity,
      organizationId,
      mode,
    );
    return {
      ...organization,
      playerId: relationship.player_id,
      teamId: relationship.team_id,
      competitionId: relationship.competition_id,
    };
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      throw authorizationError("resource_unavailable");
    }
    throw error;
  }
}

type SourcePhaseRelationshipRow = {
  target_competition_id: string;
  target_organization_id: string | null;
  source_phase_id: string;
  source_competition_id: string;
  source_organization_id: string | null;
};

export async function requireSourcePhaseAccess(
  identity: CanonicalAppUser | null,
  input: {
    targetCompetitionId: string;
    sourcePhaseId: string;
  },
  mode: PlatformPermissionMode = "manage",
): Promise<SourcePhaseAccessContext> {
  const db = await requireDatabase();
  const relationship = await db
    .prepare(
      `SELECT tc.id AS target_competition_id,
              tc.organization_id AS target_organization_id,
              sp.id AS source_phase_id,
              sc.id AS source_competition_id,
              sc.organization_id AS source_organization_id
       FROM league_competitions tc
       JOIN league_phases sp ON sp.id = ?
       JOIN league_competitions sc ON sc.id = sp.competition_id
       WHERE tc.id = ?`,
    )
    .bind(input.sourcePhaseId, input.targetCompetitionId)
    .first<SourcePhaseRelationshipRow>();

  const organizationId = relationship?.target_organization_id;
  if (
    !relationship ||
    !organizationId ||
    relationship.source_organization_id !== organizationId
  ) {
    throw authorizationError("resource_unavailable");
  }

  try {
    const organization = await requireOrganizationAccessWithDb(
      db,
      identity,
      organizationId,
      mode,
    );
    return {
      ...organization,
      resourceId: relationship.target_competition_id,
      competitionId: relationship.target_competition_id,
      sourcePhaseId: relationship.source_phase_id,
      sourceCompetitionId: relationship.source_competition_id,
    };
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      throw authorizationError("resource_unavailable");
    }
    throw error;
  }
}
