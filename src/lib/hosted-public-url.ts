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
