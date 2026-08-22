import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export const KOMOBASKET_ORGANIZATION_ID = "organization_komobasket";
export type SupporterStatus = "active" | "inactive";

export type Supporter = {
  id: string;
  organization_id: string;
  name: string;
  logo_url: string;
  description: string | null;
  website_url: string | null;
  display_order: number;
  status: SupporterStatus;
  created_at: string;
  updated_at: string;
};

async function getDb(): Promise<D1DatabaseBinding> {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_DB) throw new Error("Η canonical βάση υποστηρικτών δεν είναι διαθέσιμη.");
  return env.NEWS_DB;
}

export async function listSupporters(
  organizationId = KOMOBASKET_ORGANIZATION_ID,
  activeOnly = false,
): Promise<Supporter[]> {
  const db = await getDb();
  const statusClause = activeOnly ? " AND status = 'active'" : "";
  const result = await db.prepare(
    `SELECT id, organization_id, name, logo_url, description, website_url,
            display_order, status, created_at, updated_at
     FROM league_supporters
     WHERE organization_id = ?${statusClause}
     ORDER BY display_order ASC, name COLLATE NOCASE ASC, id ASC`,
  ).bind(organizationId).all<Supporter>();
  return result.results ?? [];
}

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Το πεδίο «${label}» είναι υποχρεωτικό.`);
  return text;
}

function optionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeWebsiteUrl(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Η ιστοσελίδα πρέπει να είναι έγκυρο URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Η ιστοσελίδα πρέπει να χρησιμοποιεί http ή https.");
  }
  return parsed.toString();
}

function normalizeDisplayOrder(value: unknown): number {
  const order = Number(value);
  if (!Number.isInteger(order) || order < 1) throw new Error("Η σειρά εμφάνισης πρέπει να είναι θετικός ακέραιος.");
  return order;
}

function normalizeStatus(value: unknown): SupporterStatus {
  const status = String(value ?? "active").trim();
  if (status !== "active" && status !== "inactive") throw new Error("Μη έγκυρη κατάσταση υποστηρικτή.");
  return status;
}

function requireLogo(value: unknown): string {
  return requiredText(value, "Λογότυπο");
}

export async function createSupporter(input: Record<string, unknown>): Promise<Supporter> {
  const db = await getDb();
  const id = `supporter_${crypto.randomUUID()}`;
  const name = requiredText(input.name, "Όνομα");
  const logoUrl = requireLogo(input.logoUrl);
  const status = normalizeStatus(input.status);
  await db.prepare(
    `INSERT INTO league_supporters
      (id, organization_id, name, logo_url, description, website_url, display_order, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    KOMOBASKET_ORGANIZATION_ID,
    name,
    logoUrl,
    optionalText(input.description),
    normalizeWebsiteUrl(input.websiteUrl),
    normalizeDisplayOrder(input.displayOrder),
    status,
  ).run();
  const created = await db.prepare("SELECT id, organization_id, name, logo_url, description, website_url, display_order, status, created_at, updated_at FROM league_supporters WHERE id=?").bind(id).first<Supporter>();
  if (!created) throw new Error("Ο υποστηρικτής δεν δημιουργήθηκε.");
  return created;
}

export async function updateSupporter(id: string, input: Record<string, unknown>): Promise<Supporter> {
  const db = await getDb();
  const current = await db.prepare("SELECT * FROM league_supporters WHERE id=? AND organization_id=?").bind(id, KOMOBASKET_ORGANIZATION_ID).first<Supporter>();
  if (!current) throw new Error("Ο υποστηρικτής δεν είναι διαθέσιμος.");
  await db.prepare(
    `UPDATE league_supporters
     SET name=?, logo_url=?, description=?, website_url=?, display_order=?, status=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND organization_id=?`,
  ).bind(
    requiredText(input.name ?? current.name, "Όνομα"),
    requireLogo(input.logoUrl ?? current.logo_url),
    optionalText(input.description ?? current.description),
    normalizeWebsiteUrl(input.websiteUrl ?? current.website_url),
    normalizeDisplayOrder(input.displayOrder ?? current.display_order),
    normalizeStatus(input.status ?? current.status),
    id,
    KOMOBASKET_ORGANIZATION_ID,
  ).run();
  const updated = await db.prepare("SELECT id, organization_id, name, logo_url, description, website_url, display_order, status, created_at, updated_at FROM league_supporters WHERE id=? AND organization_id=?").bind(id, KOMOBASKET_ORGANIZATION_ID).first<Supporter>();
  if (!updated) throw new Error("Ο υποστηρικτής δεν ενημερώθηκε.");
  return updated;
}

export async function deleteSupporter(id: string): Promise<void> {
  const db = await getDb();
  const result = await db.prepare("DELETE FROM league_supporters WHERE id=? AND organization_id=?").bind(id, KOMOBASKET_ORGANIZATION_ID).run() as { meta?: { changes?: number } };
  if (!result.meta?.changes) throw new Error("Ο υποστηρικτής δεν είναι διαθέσιμος.");
}
