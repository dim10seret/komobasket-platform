export function normalizeOptionalPublicHttpUrl(
  value: unknown,
  label: string,
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`Το πεδίο «${label}» πρέπει να είναι έγκυρο URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Το πεδίο «${label}» πρέπει να χρησιμοποιεί http ή https.`);
  }
  return parsed.toString();
}

export function safePublicHttpUrl(value: unknown) {
  try {
    return normalizeOptionalPublicHttpUrl(value, "URL");
  } catch {
    return null;
  }
}

function ownedOrganizationAssetPrefixes(organizationId: string) {
  const segment = encodeURIComponent(organizationId);
  return [
    `/api/organization/logos/organization-logos/${segment}/public-header/`,
    `/uploads/organization-logos/${segment}/public-header/`,
  ];
}

export function normalizeOptionalOrganizationPublicHeaderLogoUrl(
  value: unknown,
  organizationId: string,
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.startsWith("/")) {
    if (!ownedOrganizationAssetPrefixes(organizationId).some((prefix) => text.startsWith(prefix))) {
      throw new Error("Το public header logo δεν ανήκει στον επιλεγμένο Οργανισμό.");
    }
    return text;
  }
  return normalizeOptionalPublicHttpUrl(text, "Public header logo URL");
}

export function safeOrganizationPublicHeaderLogoUrl(value: unknown, organizationId: string) {
  try {
    return normalizeOptionalOrganizationPublicHeaderLogoUrl(value, organizationId);
  } catch {
    return null;
  }
}

/** Covers accept only generated assets owned by this organization, never arbitrary URLs. */
export function normalizeOptionalOrganizationSiteCoverUrl(value: unknown, organizationId: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Μη έγκυρο Site cover.");
  const url = value.trim();
  if (!url) return null;
  const segment = encodeURIComponent(organizationId);
  const prefixes = [
    "/api/organization/logos/organization-logos/" + segment + "/site-cover/",
    "/uploads/organization-logos/" + segment + "/site-cover/",
  ];
  const prefix = prefixes.find((candidate) => url.startsWith(candidate));
  if (!prefix || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:jpg|png|webp|avif)$/i.test(url.slice(prefix.length))) {
    throw new Error("Το Site cover πρέπει να είναι ανεβασμένη εικόνα αυτού του Οργανισμού.");
  }
  return url;
}
export function safeOrganizationSiteCoverUrl(value: unknown, organizationId: string): string | null {
  try { return normalizeOptionalOrganizationSiteCoverUrl(value, organizationId); }
  catch { return null; }
}
