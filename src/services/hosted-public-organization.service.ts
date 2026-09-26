import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { safeOrganizationPublicHeaderLogoUrl, safePublicHttpUrl, safeOrganizationSiteCoverUrl } from "@/lib/hosted-public-url";
import { isReservedOrganizationSlug } from "@/lib/organization-slug";

const CENTRAL_KOMOBASKET_ORGANIZATION_ID = "organization_komobasket";

type HostedOrganizationRow = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  public_header_logo_url: string | null;
  public_header_link_url: string | null;
  site_cover_url: string | null;
  status: "active" | "suspended" | "archived";
  publication_status: "unpublished" | "published";
};

export type HostedPublicOrganization = {
  organizationId: string;
  slug: string;
  name: string;
  canonicalLogoUrl: string | null;
  publicHeaderLogoUrl: string | null;
  publicHeaderLinkUrl: string | null;
  siteCoverUrl?: string | null;
};

function normalizeHostedSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  if (isReservedOrganizationSlug(slug)) return null;
  return slug;
}

export const readHostedPublicOrganization = cache(async (
  requestedSlug: string,
): Promise<HostedPublicOrganization | null> => {
  const slug = normalizeHostedSlug(requestedSlug);
  if (!slug) return null;

  const env = await getKomoBasketCloudflareEnv();
  const db = env?.NEWS_DB;
  if (!db) throw new Error("Η δημόσια βάση Οργανισμών δεν είναι διαθέσιμη.");

  const row = await db.prepare(
    `SELECT id, slug, name, logo_url, public_header_logo_url, public_header_link_url, site_cover_url, status, publication_status
     FROM league_organizations
     WHERE slug = ?
     LIMIT 1`,
  ).bind(slug).first<HostedOrganizationRow>();

  if (
    !row ||
    row.id === CENTRAL_KOMOBASKET_ORGANIZATION_ID ||
    row.slug === "komobasket" ||
    row.status !== "active" ||
    row.publication_status !== "published"
  ) {
    return null;
  }

  return {
    organizationId: row.id,
    slug: row.slug,
    name: row.name,
    canonicalLogoUrl: row.logo_url,
    publicHeaderLogoUrl: safeOrganizationPublicHeaderLogoUrl(row.public_header_logo_url, row.id),
    siteCoverUrl: safeOrganizationSiteCoverUrl(row.site_cover_url, row.id),
    publicHeaderLinkUrl: safePublicHttpUrl(row.public_header_link_url),
  };
});

export async function resolveHostedPublicOrganization(slug: string) {
  const organization = await readHostedPublicOrganization(slug);
  if (!organization) notFound();
  return organization;
}
