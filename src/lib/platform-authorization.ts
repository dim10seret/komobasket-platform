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

export type SourcePhaseMatchupAccessContext = SourcePhaseAccessContext & {
  matchupId: string;
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

type PhaseDependencyRow = {
  id: string;
  competition_id: string;
  previous_phase_id: string | null;
  carry_over_source_phase_id: string | null;
  participant_source_phase_id: string | null;
};

export async function requirePhaseDependencyGraphAccess(
  identity: CanonicalAppUser | null,
  phaseId: string,
  mode: PlatformPermissionMode,
): Promise<PhaseAccessContext> {
  const phase = await requirePhaseAccess(identity, phaseId, mode);
  const db = await requireDatabase();
  const current = await db.prepare(`
    SELECT p.id, p.competition_id, p.previous_phase_id,
      pr.carry_over_source_phase_id,
      json_extract(pr.settings_json, '$.participantConfiguration.participantSourcePhaseId')
        AS participant_source_phase_id
    FROM league_phases p
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.id=?
  `).bind(phaseId).first<PhaseDependencyRow>();
  if (!current) throw authorizationError("resource_unavailable");

  const sourcePhaseIds = new Set([
    current.previous_phase_id,
    current.carry_over_source_phase_id,
    current.participant_source_phase_id,
  ].map((value) => String(value ?? "").trim()).filter(Boolean));

  for (const sourcePhaseId of sourcePhaseIds) {
    const source = await requirePhaseAccess(identity, sourcePhaseId, mode);
    if (source.organizationId !== phase.organizationId) {
      throw authorizationError("resource_unavailable");
    }
  }

  const downstream = await db.prepare(`
    SELECT p.id, p.competition_id, p.previous_phase_id,
      pr.carry_over_source_phase_id,
      json_extract(pr.settings_json, '$.participantConfiguration.participantSourcePhaseId')
        AS participant_source_phase_id
    FROM league_phases p
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.previous_phase_id=?
      OR pr.carry_over_source_phase_id=?
      OR json_extract(pr.settings_json, '$.participantConfiguration.participantSourcePhaseId')=?
  `).bind(phaseId, phaseId, phaseId).all<PhaseDependencyRow>();
  for (const dependency of downstream.results ?? []) {
    const dependentPhase = await requirePhaseAccess(identity, dependency.id, mode);
    if (dependentPhase.organizationId !== phase.organizationId) {
      throw authorizationError("resource_unavailable");
    }
  }

  return phase;
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

type SourcePhaseMatchupRelationshipRow = SourcePhaseRelationshipRow & {
  settings_json: string | null;
};

export async function requireSourcePhaseMatchupAccess(
  identity: CanonicalAppUser | null,
  input: {
    targetCompetitionId: string;
    sourcePhaseId: string;
    matchupId: string;
  },
  mode: PlatformPermissionMode = "manage",
): Promise<SourcePhaseMatchupAccessContext> {
  const db = await requireDatabase();
  const relationship = await db
    .prepare(
      `SELECT tc.id AS target_competition_id,
              tc.organization_id AS target_organization_id,
              sp.id AS source_phase_id,
              sc.id AS source_competition_id,
              sc.organization_id AS source_organization_id,
              pr.settings_json
       FROM league_competitions tc
       JOIN league_phases sp ON sp.id = ?
       JOIN league_competitions sc ON sc.id = sp.competition_id
       LEFT JOIN league_phase_rules pr ON pr.phase_id = sp.id
       WHERE tc.id = ?`,
    )
    .bind(input.sourcePhaseId, input.targetCompetitionId)
    .first<SourcePhaseMatchupRelationshipRow>();

  const organizationId = relationship?.target_organization_id;
  if (
    !relationship
    || !organizationId
    || relationship.source_organization_id !== organizationId
  ) {
    throw authorizationError("resource_unavailable");
  }

  let matchupExists = false;
  try {
    const settings = JSON.parse(relationship.settings_json || "{}") as Record<string, unknown>;
    const bracket = settings.bracketConfiguration && typeof settings.bracketConfiguration === "object"
      ? settings.bracketConfiguration as Record<string, unknown>
      : {};
    const matchups = Array.isArray(bracket.matchups) ? bracket.matchups : [];
    matchupExists = matchups.some((matchup) => (
      matchup
      && typeof matchup === "object"
      && String((matchup as Record<string, unknown>).id ?? "") === input.matchupId
    ));
  } catch {
    matchupExists = false;
  }
  if (!matchupExists) {
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
      matchupId: input.matchupId,
    };
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      throw authorizationError("resource_unavailable");
    }
    throw error;
  }
}

export type TeamCompetitionAccessContext = OrganizationAccessContext & {
  competitionId: string;
  teamId: string;
};

export type StaffRosterRelationshipAccessContext = TeamCompetitionAccessContext & {
  staffId: string;
};

export type TransferRelationshipAccessContext = TeamCompetitionAccessContext & {
  playerId: string;
  fromTeamId: string;
  toTeamId: string;
};

type TeamCompetitionRow = {
  competition_id: string;
  competition_organization_id: string | null;
  team_id: string;
  team_organization_id: string | null;
};

export async function requireTeamCompetitionAccess(
  identity: CanonicalAppUser | null,
  input: { competitionId: string; teamId: string },
  mode: PlatformPermissionMode = "manage",
): Promise<TeamCompetitionAccessContext> {
  const db = await requireDatabase();
  const relationship = await db
    .prepare(
      `SELECT c.id AS competition_id,
              c.organization_id AS competition_organization_id,
              t.id AS team_id,
              t.organization_id AS team_organization_id
       FROM league_competitions c
       JOIN league_teams t ON t.id = ?
       WHERE c.id = ?`,
    )
    .bind(input.teamId, input.competitionId)
    .first<TeamCompetitionRow>();
  const organizationId = relationship?.competition_organization_id;
  if (
    !relationship ||
    !organizationId ||
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
      competitionId: relationship.competition_id,
      teamId: relationship.team_id,
    };
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      throw authorizationError("resource_unavailable");
    }
    throw error;
  }
}

export async function requireRosterMembershipAccess(
  identity: CanonicalAppUser | null,
  rosterId: string,
  mode: PlatformPermissionMode = "manage",
) {
  const db = await requireDatabase();
  const membership = await db
    .prepare(
      `SELECT player_id, team_id, competition_id
       FROM league_roster_memberships
       WHERE id = ? AND competition_id IS NOT NULL`,
    )
    .bind(rosterId)
    .first<{ player_id: string; team_id: string; competition_id: string }>();
  if (!membership) {
    throw authorizationError("resource_unavailable");
  }
  return requireRosterRelationshipAccess(
    identity,
    {
      playerId: membership.player_id,
      teamId: membership.team_id,
      competitionId: membership.competition_id,
    },
    mode,
  );
}

type StaffRosterRelationshipRow = TeamCompetitionRow & {
  staff_id: string;
  staff_organization_id: string | null;
};

export async function requireStaffRosterRelationshipAccess(
  identity: CanonicalAppUser | null,
  input: { staffId: string; teamId: string; competitionId: string },
  mode: PlatformPermissionMode = "manage",
): Promise<StaffRosterRelationshipAccessContext> {
  const db = await requireDatabase();
  const relationship = await db
    .prepare(
      `SELECT s.id AS staff_id,
              s.organization_id AS staff_organization_id,
              t.id AS team_id,
              t.organization_id AS team_organization_id,
              c.id AS competition_id,
              c.organization_id AS competition_organization_id
       FROM league_staff s
       JOIN league_teams t ON t.id = ?
       JOIN league_competitions c ON c.id = ?
       WHERE s.id = ?`,
    )
    .bind(input.teamId, input.competitionId, input.staffId)
    .first<StaffRosterRelationshipRow>();
  const organizationId = relationship?.competition_organization_id;
  if (
    !relationship ||
    !organizationId ||
    relationship.staff_organization_id !== organizationId ||
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
      staffId: relationship.staff_id,
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

export async function requireStaffMembershipAccess(
  identity: CanonicalAppUser | null,
  membershipId: string,
  mode: PlatformPermissionMode = "manage",
) {
  const db = await requireDatabase();
  const membership = await db
    .prepare(
      `SELECT staff_id, team_id, competition_id
       FROM league_staff_memberships
       WHERE id = ?`,
    )
    .bind(membershipId)
    .first<{ staff_id: string; team_id: string; competition_id: string }>();
  if (!membership) {
    throw authorizationError("resource_unavailable");
  }
  return requireStaffRosterRelationshipAccess(
    identity,
    {
      staffId: membership.staff_id,
      teamId: membership.team_id,
      competitionId: membership.competition_id,
    },
    mode,
  );
}

export async function requireTransferRelationshipAccess(
  identity: CanonicalAppUser | null,
  input: {
    playerId: string;
    competitionId: string;
    fromTeamId: string;
    toTeamId: string;
  },
  mode: PlatformPermissionMode = "manage",
): Promise<TransferRelationshipAccessContext> {
  const db = await requireDatabase();
  const relationship = await db
    .prepare(
      `SELECT p.id AS player_id,
              p.organization_id AS player_organization_id,
              ft.id AS from_team_id,
              ft.organization_id AS from_organization_id,
              tt.id AS to_team_id,
              tt.organization_id AS to_organization_id,
              c.id AS competition_id,
              c.organization_id AS competition_organization_id
       FROM league_players p
       JOIN league_teams ft ON ft.id = ?
       JOIN league_teams tt ON tt.id = ?
       JOIN league_competitions c ON c.id = ?
       WHERE p.id = ?`,
    )
    .bind(input.fromTeamId, input.toTeamId, input.competitionId, input.playerId)
    .first<{
      player_id: string;
      player_organization_id: string | null;
      from_team_id: string;
      from_organization_id: string | null;
      to_team_id: string;
      to_organization_id: string | null;
      competition_id: string;
      competition_organization_id: string | null;
    }>();
  const organizationId = relationship?.competition_organization_id;
  if (
    !relationship ||
    !organizationId ||
    relationship.player_organization_id !== organizationId ||
    relationship.from_organization_id !== organizationId ||
    relationship.to_organization_id !== organizationId
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
      teamId: relationship.to_team_id,
      fromTeamId: relationship.from_team_id,
      toTeamId: relationship.to_team_id,
      competitionId: relationship.competition_id,
    };
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      throw authorizationError("resource_unavailable");
    }
    throw error;
  }
}

async function requireCompetitionChildAccess(
  identity: CanonicalAppUser | null,
  table: "league_competition_teams" | "league_competition_venues",
  resourceId: string,
  mode: PlatformPermissionMode,
) {
  const db = await requireDatabase();
  const resource = await db
    .prepare(
      `SELECT child.id, child.competition_id, c.organization_id
       FROM ${table} child
       JOIN league_competitions c ON c.id = child.competition_id
       WHERE child.id = ?`,
    )
    .bind(resourceId)
    .first<PhaseRow>();
  const authorized = await authorizeOwnedResource(db, identity, mode, resource);
  return {
    ...authorized.organization,
    resourceId: authorized.resource.id,
    competitionId: authorized.resource.competition_id,
  };
}

export function requireParticipationAccess(
  identity: CanonicalAppUser | null,
  participationId: string,
  mode: PlatformPermissionMode = "manage",
) {
  return requireCompetitionChildAccess(
    identity,
    "league_competition_teams",
    participationId,
    mode,
  );
}

export function requireCompetitionVenueAccess(
  identity: CanonicalAppUser | null,
  venueId: string,
  mode: PlatformPermissionMode = "manage",
) {
  return requireCompetitionChildAccess(
    identity,
    "league_competition_venues",
    venueId,
    mode,
  );
}

export function platformAuthorizationErrorResponse(error: unknown) {
  if (!(error instanceof PlatformAuthorizationError)) {
    return null;
  }
  const status = error.code === "unauthenticated" ? 401 : 403;
  return Response.json(
    {
      code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
      error:
        status === 401
          ? "Απαιτείται πιστοποιημένη ταυτότητα."
          : "Δεν επιτρέπεται η συγκεκριμένη ενέργεια.",
    },
    { status },
  );
}
