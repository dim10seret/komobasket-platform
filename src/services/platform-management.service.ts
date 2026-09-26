import "server-only";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { normalizeOptionalOrganizationPublicHeaderLogoUrl, normalizeOptionalPublicHttpUrl, normalizeOptionalOrganizationSiteCoverUrl } from "@/lib/hosted-public-url";
import { isReservedOrganizationSlug } from "@/lib/organization-slug";
import {
  createRevokeAllOrganizationUserSessionsStatement,
  createRevokeSessionsWithoutActiveMembershipsStatement,
} from "@/services/organization-user-auth.service";

type OrganizationStatus = "active" | "suspended" | "archived";
type OrganizationPublicationStatus = "unpublished" | "published";
type AppUserStatus = "active" | "disabled";
type MembershipRole = "admin" | "viewer";
type MembershipStatus = "active" | "invited" | "revoked";

export type OrganizationDependencyCounts = {
  competitions: number;
  teams: number;
  players: number;
  staff: number;
  memberships: number;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  logo_url: string | null;
  public_header_logo_url: string | null;
  public_header_link_url: string | null;
  site_cover_url: string | null;
  publication_status: OrganizationPublicationStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  role?: "super_admin" | MembershipRole;
};

type AppUserRow = {
  id: string;
  email: string;
  normalized_email: string;
  display_name: string | null;
  status: AppUserStatus;
  is_super_admin: number;
  credential_configured: number;
  password_set_at: string | null;
  created_at: string;
  updated_at: string;
};

type MembershipRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  created_at: string;
  updated_at: string;
};

export class PlatformManagementError extends Error {
  readonly code: string;
  readonly httpStatus: 400 | 404 | 409;

  constructor(code: string, message: string, httpStatus: 400 | 404 | 409) {
    super(message);
    this.name = "PlatformManagementError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const ORGANIZATION_STATUSES = new Set<OrganizationStatus>([
  "active",
  "suspended",
  "archived",
]);
const ORGANIZATION_PUBLICATION_STATUSES = new Set<OrganizationPublicationStatus>([
  "unpublished",
  "published",
]);
const USER_STATUSES = new Set<AppUserStatus>(["active", "disabled"]);
const MEMBERSHIP_ROLES = new Set<MembershipRole>(["admin", "viewer"]);
const MEMBERSHIP_STATUSES = new Set<MembershipStatus>([
  "active",
  "invited",
  "revoked",
]);
const FORBIDDEN_IDENTITY_KEYS = [
  "id",
  "normalizedEmail",
  "normalized_email",
  "isSuperAdmin",
  "is_super_admin",
  "accessSubject",
  "access_subject",
] as const;

function requiredText(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new PlatformManagementError(
      "invalid_input",
      `Το πεδίο ${label} είναι υποχρεωτικό.`,
      400,
    );
  }
  return text;
}

function optionalText(value: unknown) {
  if (value === undefined) return undefined;
  const text = value === null ? "" : String(value).trim();
  return text || null;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  label: string,
): T {
  const text = String(value ?? "").trim() as T;
  if (!allowed.has(text)) {
    throw new PlatformManagementError(
      "invalid_input",
      `Μη έγκυρη τιμή για ${label}.`,
      400,
    );
  }
  return text;
}

function rejectKeys(input: Record<string, unknown>, keys: readonly string[]) {
  const found = keys.find((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (found) {
    throw new PlatformManagementError(
      "forbidden_field",
      `Το πεδίο ${found} ορίζεται αποκλειστικά από τον διακομιστή.`,
      400,
    );
  }
}

function normalizeEmail(value: unknown) {
  const email = requiredText(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PlatformManagementError(
      "invalid_email",
      "Το email δεν είναι έγκυρο.",
      400,
    );
  }
  return email;
}

function normalizeSlug(value: unknown, allowCentralKomoBasket = false) {
  const slug = requiredText(value, "slug").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new PlatformManagementError(
      "invalid_slug",
      "Το slug επιτρέπεται να περιέχει πεζά λατινικά, αριθμούς και παύλες.",
      400,
    );
  }
  if (isReservedOrganizationSlug(slug) && !(allowCentralKomoBasket && slug === "komobasket")) {
    throw new PlatformManagementError(
      "reserved_organization_slug",
      "Το slug είναι δεσμευμένο από την πλατφόρμα.",
      400,
    );
  }
  return slug;
}

async function requireDatabase() {
  const env = await getKomoBasketCloudflareEnv();
  const db = env?.NEWS_DB;
  if (!db) throw new Error("Η canonical βάση διαχείρισης δεν είναι διαθέσιμη.");
  return db;
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function auditStatement(
  db: Awaited<ReturnType<typeof requireDatabase>>,
  actorEmail: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  return db
    .prepare(
      `INSERT INTO league_audit_log
       (id, actor_email, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      createId("audit"),
      actorEmail,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
    );
}

async function loadOrganization(id: string) {
  const db = await requireDatabase();
  return db
    .prepare(
      `SELECT id, slug, name, status, logo_url, public_header_logo_url, public_header_link_url, site_cover_url, publication_status, published_at,
              created_at, updated_at
       FROM league_organizations WHERE id = ?`,
    )
    .bind(id)
    .first<OrganizationRow>();
}

const EMPTY_ORGANIZATION_GUARD = `
  NOT EXISTS (SELECT 1 FROM league_competitions c WHERE c.organization_id = league_organizations.id)
  AND NOT EXISTS (SELECT 1 FROM league_teams t WHERE t.organization_id = league_organizations.id)
  AND NOT EXISTS (SELECT 1 FROM league_players p WHERE p.organization_id = league_organizations.id)
  AND NOT EXISTS (SELECT 1 FROM league_staff s WHERE s.organization_id = league_organizations.id)
  AND NOT EXISTS (
    SELECT 1 FROM league_organization_memberships m
    WHERE m.organization_id = league_organizations.id
  )`;

export async function getManagedOrganizationDependencies(
  organizationId: string,
): Promise<OrganizationDependencyCounts> {
  const id = requiredText(organizationId, "organizationId");
  const organization = await loadOrganization(id);
  if (!organization) {
    throw new PlatformManagementError("organization_not_found", "Ο Οργανισμός δεν βρέθηκε.", 404);
  }
  const db = await requireDatabase();
  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM league_competitions c WHERE c.organization_id = ?) AS competitions,
       (SELECT COUNT(*) FROM league_teams t WHERE t.organization_id = ?) AS teams,
       (SELECT COUNT(*) FROM league_players p WHERE p.organization_id = ?) AS players,
       (SELECT COUNT(*) FROM league_staff s WHERE s.organization_id = ?) AS staff,
       (SELECT COUNT(*) FROM league_organization_memberships m WHERE m.organization_id = ?) AS memberships`,
  ).bind(id, id, id, id, id).first<Record<keyof OrganizationDependencyCounts, number>>();
  return {
    competitions: Number(counts?.competitions ?? 0),
    teams: Number(counts?.teams ?? 0),
    players: Number(counts?.players ?? 0),
    staff: Number(counts?.staff ?? 0),
    memberships: Number(counts?.memberships ?? 0),
  };
}

async function loadUser(id: string) {
  const db = await requireDatabase();
  return db
    .prepare(
      `SELECT u.id, u.email, u.normalized_email, u.display_name, u.status,
              u.is_super_admin,
              CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS credential_configured,
              c.password_set_at, u.created_at, u.updated_at
       FROM league_app_users u
       LEFT JOIN league_user_credentials c ON c.user_id = u.id
       WHERE u.id = ?`,
    )
    .bind(id)
    .first<AppUserRow>();
}

async function loadMembership(id: string) {
  const db = await requireDatabase();
  return db
    .prepare(
      `SELECT m.id, m.organization_id, o.name AS organization_name,
              m.user_id, u.email AS user_email,
              u.display_name AS user_display_name, m.role, m.status,
              m.created_at, m.updated_at
       FROM league_organization_memberships m
       JOIN league_organizations o ON o.id = m.organization_id
       JOIN league_app_users u ON u.id = m.user_id
       WHERE m.id = ?`,
    )
    .bind(id)
    .first<MembershipRow>();
}

export async function listManagedOrganizations(user: CanonicalAppUser) {
  const db = await requireDatabase();
  if (user.isSuperAdmin) {
    const result = await db
      .prepare(
        `SELECT id, slug, name, status, logo_url, public_header_logo_url, public_header_link_url, site_cover_url, publication_status, published_at,
                created_at, updated_at
         FROM league_organizations ORDER BY name, id`,
      )
      .all<OrganizationRow>();
    return (result.results ?? []).map((row) => ({ ...row, role: "super_admin" as const }));
  }

  const result = await db
    .prepare(
      `SELECT o.id, o.slug, o.name, o.status, o.logo_url,
              o.public_header_logo_url, o.public_header_link_url, o.site_cover_url, o.publication_status,
              o.published_at, o.created_at, o.updated_at, m.role
       FROM league_organization_memberships m
       JOIN league_organizations o ON o.id = m.organization_id
       WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
       ORDER BY o.name, o.id`,
    )
    .bind(user.userId)
    .all<OrganizationRow>();
  return result.results ?? [];
}

export async function listManagedUsers() {
  const db = await requireDatabase();
  const result = await db
    .prepare(
      `SELECT u.id, u.email, u.normalized_email, u.display_name, u.status,
              u.is_super_admin,
              CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS credential_configured,
              c.password_set_at, u.created_at, u.updated_at
       FROM league_app_users u
       LEFT JOIN league_user_credentials c ON c.user_id = u.id
       ORDER BY u.normalized_email, u.id`,
    )
    .all<AppUserRow>();
  return result.results ?? [];
}

export async function listManagedMemberships(filters: {
  organizationId?: string;
  userId?: string;
} = {}) {
  const db = await requireDatabase();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.organizationId) {
    conditions.push("m.organization_id = ?");
    values.push(filters.organizationId);
  }
  if (filters.userId) {
    conditions.push("m.user_id = ?");
    values.push(filters.userId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db
    .prepare(
      `SELECT m.id, m.organization_id, o.name AS organization_name,
              m.user_id, u.email AS user_email,
              u.display_name AS user_display_name, m.role, m.status,
              m.created_at, m.updated_at
       FROM league_organization_memberships m
       JOIN league_organizations o ON o.id = m.organization_id
       JOIN league_app_users u ON u.id = m.user_id
       ${where}
       ORDER BY o.name, u.normalized_email, m.id`,
    )
    .bind(...values)
    .all<MembershipRow>();
  return result.results ?? [];
}

export async function createManagedOrganization(
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, ["id", "logoUrl", "logo_url", "publicationStatus", "publication_status", "publishedAt", "published_at"]);
  const name = requiredText(input.name, "name");
  const slug = normalizeSlug(input.slug);
  const status = enumValue(input.status ?? "active", ORGANIZATION_STATUSES, "status");
  const db = await requireDatabase();
  const duplicate = await db
    .prepare("SELECT id FROM league_organizations WHERE slug = ?")
    .bind(slug)
    .first<{ id: string }>();
  if (duplicate) {
    throw new PlatformManagementError(
      "duplicate_organization_slug",
      "Υπάρχει ήδη Οργανισμός με αυτό το slug.",
      409,
    );
  }

  const id = createId("organization");
  await db.batch([
    db
      .prepare(
        `INSERT INTO league_organizations (id, slug, name, status)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, slug, name, status),
    auditStatement(db, actorEmail, "create", "organization", id, {
      slug,
      name,
      status,
    }),
  ]);
  return loadOrganization(id);
}

export async function updateManagedOrganization(
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, ["organization_id", "logoUrl", "logo_url", "publishedAt", "published_at"]);
  const id = requiredText(input.organizationId, "organizationId");
  const current = await loadOrganization(id);
  if (!current) {
    throw new PlatformManagementError("organization_not_found", "Ο Οργανισμός δεν βρέθηκε.", 404);
  }
  const name = input.name === undefined ? current.name : requiredText(input.name, "name");
  const slug = input.slug === undefined
    ? current.slug
    : normalizeSlug(input.slug, current.id === "organization_komobasket");
  const status = input.status === undefined
    ? current.status
    : enumValue(input.status, ORGANIZATION_STATUSES, "status");
  const publicationStatus = input.publicationStatus === undefined && input.publication_status === undefined
    ? current.publication_status
    : enumValue(
        input.publicationStatus ?? input.publication_status,
        ORGANIZATION_PUBLICATION_STATUSES,
        "publicationStatus",
      );
  const publicHeaderLogoUrl = input.publicHeaderLogoUrl === undefined && input.public_header_logo_url === undefined
    ? current.public_header_logo_url
    : normalizeOptionalOrganizationPublicHeaderLogoUrl(
        input.publicHeaderLogoUrl ?? input.public_header_logo_url,
        id,
      );
  const publicHeaderLinkUrl = input.publicHeaderLinkUrl === undefined && input.public_header_link_url === undefined
    ? current.public_header_link_url
    : normalizeOptionalPublicHttpUrl(
        input.publicHeaderLinkUrl ?? input.public_header_link_url,
        "Public header link URL",
      );
  const db = await requireDatabase();
  const duplicate = await db
    .prepare("SELECT id FROM league_organizations WHERE slug = ? AND id <> ?")
    .bind(slug, id)
    .first<{ id: string }>();
  if (duplicate) {
    throw new PlatformManagementError(
      "duplicate_organization_slug",
      "Υπάρχει ήδη Οργανισμός με αυτό το slug.",
      409,
    );
  }
  await db.batch([
    db
      .prepare(
        `UPDATE league_organizations
         SET name = ?, slug = ?, status = ?, publication_status = ?,
             public_header_logo_url = ?, public_header_link_url = ?,
             published_at = CASE
               WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP)
               ELSE published_at
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        name,
        slug,
        status,
        publicationStatus,
        publicHeaderLogoUrl,
        publicHeaderLinkUrl,
        publicationStatus,
        id,
      ),
    auditStatement(db, actorEmail, "update", "organization", id, {
      before: {
        name: current.name,
        slug: current.slug,
        status: current.status,
        publicationStatus: current.publication_status,
        publicHeaderLogoUrl: current.public_header_logo_url,
        publicHeaderLinkUrl: current.public_header_link_url,
      },
      after: { name, slug, status, publicationStatus, publicHeaderLogoUrl, publicHeaderLinkUrl },
    }),
  ]);
  return loadOrganization(id);
}

export async function updateManagedOrganizationPublicPresentation(
  organizationId: string,
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, [
    "id", "organization_id", "name", "slug", "status",
    "publicationStatus", "publication_status", "logoUrl", "logo_url",
    "publishedAt", "published_at",
  ]);
  const current = await loadOrganization(organizationId);
  if (!current) {
    throw new PlatformManagementError("organization_not_found", "Ο Οργανισμός δεν βρέθηκε.", 404);
  }
  const publicHeaderLogoUrl = input.publicHeaderLogoUrl === undefined && input.public_header_logo_url === undefined
    ? current.public_header_logo_url
    : normalizeOptionalOrganizationPublicHeaderLogoUrl(
        input.publicHeaderLogoUrl ?? input.public_header_logo_url,
        organizationId,
      );
  const publicHeaderLinkUrl = input.publicHeaderLinkUrl === undefined && input.public_header_link_url === undefined
    ? current.public_header_link_url
    : normalizeOptionalPublicHttpUrl(
        input.publicHeaderLinkUrl ?? input.public_header_link_url,
        "Public header link URL",
      );
  const db = await requireDatabase();
  await db.batch([
    db.prepare(
      `UPDATE league_organizations
       SET public_header_logo_url = ?, public_header_link_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(publicHeaderLogoUrl, publicHeaderLinkUrl, organizationId),
    auditStatement(db, actorEmail, "update", "organization_public_presentation", organizationId, {
      before: {
        publicHeaderLogoUrl: current.public_header_logo_url,
        publicHeaderLinkUrl: current.public_header_link_url,
      },
      after: { publicHeaderLogoUrl, publicHeaderLinkUrl },
    }),
  ]);
  return loadOrganization(organizationId);
}

export async function updateManagedOrganizationLogo(
  organizationId: string,
  logoUrl: string,
  actorEmail: string,
) {
  const current = await loadOrganization(organizationId);
  if (!current) {
    throw new PlatformManagementError("organization_not_found", "Ο Οργανισμός δεν βρέθηκε.", 404);
  }
  const db = await requireDatabase();
  await db.batch([
    db.prepare(
      `UPDATE league_organizations
       SET logo_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(logoUrl, organizationId),
    auditStatement(db, actorEmail, "update_logo", "organization", organizationId, {
      before: { logoUrl: current.logo_url },
      after: { logoUrl },
    }),
  ]);
  return loadOrganization(organizationId);
}

export async function deleteManagedOrganization(
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, ["id"]);
  const id = requiredText(input.organizationId, "organizationId");
  const current = await loadOrganization(id);
  if (!current) {
    throw new PlatformManagementError("organization_not_found", "Ο Οργανισμός δεν βρέθηκε.", 404);
  }
  const dependencies = await getManagedOrganizationDependencies(id);
  if (Object.values(dependencies).some((count) => count > 0)) {
    throw new PlatformManagementError(
      "organization_not_empty",
      "Ο Οργανισμός περιέχει δεδομένα και δεν μπορεί να διαγραφεί. Μπορείτε να τον αρχειοθετήσετε.",
      409,
    );
  }

  const db = await requireDatabase();
  const auditId = createId("audit");
  const details = JSON.stringify({ deleted: current, dependencies });
  await db.batch([
    db.prepare(
      `INSERT INTO league_audit_log
       (id, actor_email, action, entity_type, entity_id, details_json, created_at)
       SELECT ?, ?, 'delete', 'organization', id, ?, CURRENT_TIMESTAMP
       FROM league_organizations
       WHERE id = ? AND ${EMPTY_ORGANIZATION_GUARD}`,
    ).bind(auditId, actorEmail, details, id),
    db.prepare(
      `DELETE FROM league_organizations
       WHERE id = ? AND ${EMPTY_ORGANIZATION_GUARD}`,
    ).bind(id),
  ]);

  if (await loadOrganization(id)) {
    throw new PlatformManagementError(
      "organization_not_empty",
      "Ο Οργανισμός περιέχει δεδομένα και δεν μπορεί να διαγραφεί. Μπορείτε να τον αρχειοθετήσετε.",
      409,
    );
  }
  return { deleted: true, organizationId: id };
}

export async function createManagedUser(
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, FORBIDDEN_IDENTITY_KEYS);
  const normalizedEmail = normalizeEmail(input.email);
  const displayName = optionalText(input.displayName ?? input.display_name) ?? null;
  const status = enumValue(input.status ?? "active", USER_STATUSES, "status");
  const db = await requireDatabase();
  const duplicate = await db
    .prepare("SELECT id FROM league_app_users WHERE normalized_email = ?")
    .bind(normalizedEmail)
    .first<{ id: string }>();
  if (duplicate) {
    throw new PlatformManagementError(
      "duplicate_normalized_email",
      "Υπάρχει ήδη χρήστης εφαρμογής με αυτό το email.",
      409,
    );
  }
  const id = createId("app_user");
  await db.batch([
    db
      .prepare(
        `INSERT INTO league_app_users
         (id, email, normalized_email, display_name, status, is_super_admin)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .bind(id, normalizedEmail, normalizedEmail, displayName, status),
    auditStatement(db, actorEmail, "create", "app_user", id, {
      email: normalizedEmail,
      displayName,
      status,
      isSuperAdmin: false,
    }),
  ]);
  return loadUser(id);
}

export async function updateManagedUser(
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, [
    "id",
    "normalizedEmail",
    "normalized_email",
    "isSuperAdmin",
    "is_super_admin",
    "accessSubject",
    "access_subject",
  ]);
  const id = requiredText(input.userId, "userId");
  const current = await loadUser(id);
  if (!current) {
    throw new PlatformManagementError("user_not_found", "Ο χρήστης δεν βρέθηκε.", 404);
  }
  const normalizedEmail = input.email === undefined
    ? current.normalized_email
    : normalizeEmail(input.email);
  const displayName = input.displayName === undefined && input.display_name === undefined
    ? current.display_name
    : optionalText(input.displayName ?? input.display_name) ?? null;
  const status = input.status === undefined
    ? current.status
    : enumValue(input.status, USER_STATUSES, "status");
  const db = await requireDatabase();
  if (current.is_super_admin === 1 && normalizedEmail !== current.normalized_email) {
    throw new PlatformManagementError(
      "super_admin_identity_locked",
      "Το email ενός Super Admin δεν αλλάζει από τη συνήθη διαχείριση χρηστών.",
      409,
    );
  }
  if (current.is_super_admin === 1 && current.status === "active" && status === "disabled") {
    const count = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM league_app_users
         WHERE status = 'active' AND is_super_admin = 1`,
      )
      .first<{ count: number }>();
    if (Number(count?.count ?? 0) <= 1) {
      throw new PlatformManagementError(
        "last_super_admin_lockout",
        "Ο μοναδικός ενεργός Super Admin δεν μπορεί να απενεργοποιηθεί.",
        409,
      );
    }
  }
  const duplicate = await db
    .prepare("SELECT id FROM league_app_users WHERE normalized_email = ? AND id <> ?")
    .bind(normalizedEmail, id)
    .first<{ id: string }>();
  if (duplicate) {
    throw new PlatformManagementError(
      "duplicate_normalized_email",
      "Υπάρχει ήδη χρήστης εφαρμογής με αυτό το email.",
      409,
    );
  }
  const statements = [
    db
      .prepare(
        `UPDATE league_app_users
         SET email = ?, normalized_email = ?, display_name = ?, status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(normalizedEmail, normalizedEmail, displayName, status, id),
    auditStatement(db, actorEmail, "update", "app_user", id, {
      before: {
        email: current.email,
        displayName: current.display_name,
        status: current.status,
      },
      after: { email: normalizedEmail, displayName, status },
    }),
  ];
  if (
    current.is_super_admin === 0
    && (normalizedEmail !== current.normalized_email || status === "disabled")
  ) {
    statements.push(
      createRevokeAllOrganizationUserSessionsStatement(db, id, new Date().toISOString()),
    );
  }
  await db.batch(statements);
  return loadUser(id);
}

export async function createManagedMembership(
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, ["id"]);
  const organizationId = requiredText(
    input.organizationId ?? input.organization_id,
    "organizationId",
  );
  const userId = requiredText(input.userId ?? input.user_id, "userId");
  const role = enumValue(input.role, MEMBERSHIP_ROLES, "role");
  const status = enumValue(input.status ?? "invited", MEMBERSHIP_STATUSES, "status");
  const db = await requireDatabase();
  const [organization, user, existing] = await Promise.all([
    loadOrganization(organizationId),
    loadUser(userId),
    db
      .prepare(
        `SELECT id FROM league_organization_memberships
         WHERE organization_id = ? AND user_id = ?`,
      )
      .bind(organizationId, userId)
      .first<{ id: string }>(),
  ]);
  if (!organization) {
    throw new PlatformManagementError("organization_not_found", "Ο Οργανισμός δεν βρέθηκε.", 404);
  }
  if (!user) {
    throw new PlatformManagementError("user_not_found", "Ο χρήστης δεν βρέθηκε.", 404);
  }
  if (existing) {
    throw new PlatformManagementError(
      "membership_exists",
      "Η σχέση χρήστη και Οργανισμού υπάρχει ήδη. Χρησιμοποιήστε ρητή ενημέρωση ή επανενεργοποίηση.",
      409,
    );
  }
  const id = createId("organization_membership");
  await db.batch([
    db
      .prepare(
        `INSERT INTO league_organization_memberships
         (id, organization_id, user_id, role, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, organizationId, userId, role, status),
    auditStatement(db, actorEmail, "create", "organization_membership", id, {
      organizationId,
      userId,
      role,
      status,
    }),
  ]);
  return loadMembership(id);
}

export async function updateManagedMembership(
  input: Record<string, unknown>,
  actorEmail: string,
) {
  rejectKeys(input, ["id", "organizationId", "organization_id", "userId", "user_id"]);
  const membershipId = requiredText(input.membershipId, "membershipId");
  const current = await loadMembership(membershipId);
  if (!current) {
    throw new PlatformManagementError("membership_not_found", "Η ιδιότητα μέλους δεν βρέθηκε.", 404);
  }
  const role = input.role === undefined
    ? current.role
    : enumValue(input.role, MEMBERSHIP_ROLES, "role");
  const status = input.status === undefined
    ? current.status
    : enumValue(input.status, MEMBERSHIP_STATUSES, "status");
  const db = await requireDatabase();
  const statements = [
    db
      .prepare(
        `UPDATE league_organization_memberships
         SET role = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(role, status, membershipId),
    auditStatement(
      db,
      actorEmail,
      "update",
      "organization_membership",
      membershipId,
      {
        organizationId: current.organization_id,
        userId: current.user_id,
        before: { role: current.role, status: current.status },
        after: { role, status },
      },
    ),
  ];
  if (current.status === "active" && status !== "active") {
    statements.push(
      createRevokeSessionsWithoutActiveMembershipsStatement(
        db,
        current.user_id,
        new Date().toISOString(),
      ),
    );
  }
  await db.batch(statements);
  return loadMembership(membershipId);
}

export function platformManagementErrorResponse(error: unknown) {
  if (!(error instanceof PlatformManagementError)) return null;
  return Response.json(
    { code: error.code, error: error.message },
    { status: error.httpStatus },
  );
}

/** Updates only the optional cover reference, preserving identity and both logos. */
export async function updateManagedOrganizationSiteCover(organizationId: string, value: unknown, actorEmail: string) {
  const db = await requireDatabase();
  const current = await loadOrganization(organizationId);
  if (!current) throw new Error("Ο Οργανισμός δεν βρέθηκε.");
  const siteCoverUrl = normalizeOptionalOrganizationSiteCoverUrl(value, organizationId);
  await db.batch([
    db.prepare("UPDATE league_organizations SET site_cover_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(siteCoverUrl, organizationId),
    auditStatement(db, actorEmail, "update_site_cover", "organization", organizationId, {
      before: { siteCoverUrl: current.site_cover_url }, after: { siteCoverUrl },
    }),
  ]);
  return loadOrganization(organizationId);
}
