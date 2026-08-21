import "server-only";

import type { AdminIdentity } from "@/lib/admin-auth";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

type AppUserRow = {
  id: string;
  email: string;
  normalized_email: string;
  display_name: string | null;
  status: "active" | "disabled";
  is_super_admin: number;
};

export type CanonicalAppUser = {
  userId: string;
  email: string;
  displayName: string | null;
  isSuperAdmin: boolean;
  isLocal: boolean;
};

export const DEFAULT_PLATFORM_ORGANIZATION_ID = "organization_komobasket";

export type AccessibleOrganization = {
  organizationId: string;
  slug: string;
  name: string;
  role: "super_admin" | "admin" | "viewer";
};

export type PlatformReadContext = {
  organizationId: string;
  organization: AccessibleOrganization;
  accessibleOrganizations: AccessibleOrganization[];
};

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function toCanonicalUser(row: AppUserRow, isLocal: boolean): CanonicalAppUser {
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    isSuperAdmin: row.is_super_admin === 1,
    isLocal,
  };
}

export async function resolveCanonicalAppUser(
  identity: AdminIdentity,
): Promise<CanonicalAppUser> {
  const env = await getKomoBasketCloudflareEnv();
  const db = env?.NEWS_DB;
  if (!db) {
    throw new Error("Η canonical βάση χρηστών δεν είναι διαθέσιμη.");
  }

  const normalizedEmail = normalizeEmail(identity.email);
  if (!normalizedEmail) {
    throw new Error("Η ταυτότητα διαχειριστή δεν περιέχει έγκυρο email.");
  }

  const loadUser = () =>
    db
      .prepare(
        `SELECT id, email, normalized_email, display_name, status, is_super_admin
         FROM league_app_users
         WHERE normalized_email = ?`,
      )
      .bind(normalizedEmail)
      .first<AppUserRow>();

  let user = await loadUser();
  if (!user) {
    const configuredAdminEmail = normalizeEmail(
      process.env.ADMIN_EMAIL ?? env?.ADMIN_EMAIL,
    );
    const mayBootstrap =
      identity.isLocal ||
      (configuredAdminEmail.length > 0 && configuredAdminEmail === normalizedEmail);

    if (!mayBootstrap) {
      throw new Error("Ο πιστοποιημένος χρήστης δεν έχει καταχωριστεί στην εφαρμογή.");
    }

    await db
      .prepare(
        `INSERT INTO league_app_users (
           id, email, normalized_email, status, is_super_admin
         ) VALUES (?, ?, ?, 'active', 1)
         ON CONFLICT(normalized_email) DO NOTHING`,
      )
      .bind(`app_user_${crypto.randomUUID()}`, normalizedEmail, normalizedEmail)
      .run();

    user = await loadUser();
  }

  if (!user) {
    throw new Error("Αποτυχία επίλυσης του canonical χρήστη εφαρμογής.");
  }
  if (user.status !== "active") {
    throw new Error("Ο canonical χρήστης εφαρμογής είναι ανενεργός.");
  }

  return toCanonicalUser(user, identity.isLocal);
}

export async function listAccessibleOrganizations(
  user: CanonicalAppUser,
): Promise<AccessibleOrganization[]> {
  const env = await getKomoBasketCloudflareEnv();
  const db = env?.NEWS_DB;
  if (!db) {
    throw new Error("Η canonical βάση Οργανισμών δεν είναι διαθέσιμη.");
  }

  if (user.isSuperAdmin) {
    const result = await db
      .prepare(
        `SELECT id, slug, name
         FROM league_organizations
         WHERE status='active'
         ORDER BY name, id`,
      )
      .all<{ id: string; slug: string; name: string }>();
    return (result.results ?? []).map((organization) => ({
      organizationId: organization.id,
      slug: organization.slug,
      name: organization.name,
      role: "super_admin" as const,
    }));
  }

  const result = await db
    .prepare(
      `SELECT o.id, o.slug, o.name, m.role
       FROM league_organization_memberships m
       JOIN league_organizations o ON o.id=m.organization_id
       WHERE m.user_id=? AND m.status='active' AND o.status='active'
       ORDER BY o.name, o.id`,
    )
    .bind(user.userId)
    .all<{ id: string; slug: string; name: string; role: "admin" | "viewer" }>();

  return (result.results ?? []).map((organization) => ({
    organizationId: organization.id,
    slug: organization.slug,
    name: organization.name,
    role: organization.role,
  }));
}

export async function resolvePlatformReadContext(
  user: CanonicalAppUser,
): Promise<PlatformReadContext> {
  const accessibleOrganizations = await listAccessibleOrganizations(user);
  const organization = accessibleOrganizations.find(
    (candidate) => candidate.organizationId === DEFAULT_PLATFORM_ORGANIZATION_ID,
  );
  if (!organization) {
    throw new Error("Δεν υπάρχει πρόσβαση στον επιλεγμένο Οργανισμό της Πλατφόρμας.");
  }

  return {
    organizationId: organization.organizationId,
    organization,
    accessibleOrganizations,
  };
}
