import "server-only";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

type OrganizationStatus = "active" | "suspended" | "archived";
type AppUserStatus = "active" | "disabled";
type MembershipRole = "admin" | "viewer";
type MembershipStatus = "active" | "invited" | "revoked";

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
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

function normalizeSlug(value: unknown) {
  const slug = requiredText(value, "slug").toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new PlatformManagementError(
      "invalid_slug",
      "Το slug επιτρέπεται να περιέχει πεζά λατινικά, αριθμούς και παύλες.",
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
      `SELECT id, slug, name, status, created_at, updated_at
       FROM league_organizations WHERE id = ?`,
    )
    .bind(id)
    .first<OrganizationRow>();
}

async function loadUser(id: string) {
  const db = await requireDatabase();
  return db
    .prepare(
      `SELECT id, email, normalized_email, display_name, status,
              is_super_admin, created_at, updated_at
       FROM league_app_users WHERE id = ?`,
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
        `SELECT id, slug, name, status, created_at, updated_at
         FROM league_organizations ORDER BY name, id`,
      )
      .all<OrganizationRow>();
    return (result.results ?? []).map((row) => ({ ...row, role: "super_admin" as const }));
  }

  const result = await db
    .prepare(
      `SELECT o.id, o.slug, o.name, o.status, o.created_at, o.updated_at, m.role
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
      `SELECT id, email, normalized_email, display_name, status,
              is_super_admin, created_at, updated_at
       FROM league_app_users ORDER BY normalized_email, id`,
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
  rejectKeys(input, ["id"]);
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
  rejectKeys(input, ["organization_id"]);
  const id = requiredText(input.organizationId, "organizationId");
  const current = await loadOrganization(id);
  if (!current) {
    throw new PlatformManagementError("organization_not_found", "Ο Οργανισμός δεν βρέθηκε.", 404);
  }
  const name = input.name === undefined ? current.name : requiredText(input.name, "name");
  const slug = input.slug === undefined ? current.slug : normalizeSlug(input.slug);
  const status = input.status === undefined
    ? current.status
    : enumValue(input.status, ORGANIZATION_STATUSES, "status");
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
         SET name = ?, slug = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(name, slug, status, id),
    auditStatement(db, actorEmail, "update", "organization", id, {
      before: { name: current.name, slug: current.slug, status: current.status },
      after: { name, slug, status },
    }),
  ]);
  return loadOrganization(id);
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
  await db.batch([
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
  ]);
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
  await db.batch([
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
  ]);
  return loadMembership(membershipId);
}

export function platformManagementErrorResponse(error: unknown) {
  if (!(error instanceof PlatformManagementError)) return null;
  return Response.json(
    { code: error.code, error: error.message },
    { status: error.httpStatus },
  );
}
