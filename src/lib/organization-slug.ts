export const RESERVED_ORGANIZATION_SLUGS = new Set([
  "admin",
  "api",
  "competitions",
  "contact",
  "gallery",
  "history",
  "identity",
  "komobasket",
  "news",
  "players",
  "results",
  "schedule",
  "standings",
  "stats",
  "statistics",
  "supporters",
  "teams",
  "videos",
  "widget",
  "_next",
  "assets",
  "images",
  "logos",
  "favicon.ico",
  "icon.png",
  "robots.txt",
  "sitemap.xml",
]);

export function isReservedOrganizationSlug(slug: string) {
  return RESERVED_ORGANIZATION_SLUGS.has(slug.trim().toLowerCase());
}
