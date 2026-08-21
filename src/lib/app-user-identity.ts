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
