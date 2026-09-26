import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { platformAuthorizationErrorResponse, requireOrganizationAccess } from "@/lib/platform-authorization";
import { platformManagementErrorResponse, updateManagedOrganizationPublicPresentation, updateManagedOrganizationSiteCover } from "@/services/platform-management.service";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { platformOperationScope } from "@/lib/platform-operation-scope";

function platformOrganizationImageUpload(actor: CanonicalAppUser, scopeOrganizationId: string | undefined, assetKind: "public-header" | "site-cover") {
 const { requireOrganizationAccess, requireTeamAccess } = platformOperationScope(scopeOrganizationId);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"]]);

async function POST(request: Request) {
  try {
const user = actor;
    const formData = await request.formData();
    const organizationId = String(formData.get("organizationId") ?? "").trim();
    const file = formData.get("file");
    if (!organizationId || !(file instanceof File)) return Response.json({ error: "Απαιτούνται Οργανισμός και αρχείο λογοτύπου." }, { status: 400 });
    await requireOrganizationAccess(user, organizationId, "manage");
    const extension = ALLOWED_TYPES.get(file.type);
    if (!extension || file.size <= 0 || file.size > MAX_FILE_SIZE) return Response.json({ error: "Το λογότυπο πρέπει να είναι JPG, PNG, WEBP ή AVIF έως 5MB." }, { status: 400 });

    const filename = `${randomUUID()}.${extension}`;
    const objectKey = `organization-logos/${organizationId}/${assetKind}/${filename}`;
    const bytes = await file.arrayBuffer();
    const env = await getKomoBasketCloudflareEnv();
    let logoUrl: string;
    if (env?.NEWS_IMAGES) {
      await env.NEWS_IMAGES.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
      logoUrl = `/api/organization/logos/${objectKey}`;
    } else {
      const directory = path.join(process.cwd(), "public", "uploads", "organization-logos", organizationId, assetKind);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, filename), Buffer.from(bytes));
      logoUrl = `/uploads/organization-logos/${encodeURIComponent(organizationId)}/${assetKind}/${filename}`;
    }
    const organization = assetKind === "site-cover"
        ? await updateManagedOrganizationSiteCover(organizationId, logoUrl, actor.email)
        : await updateManagedOrganizationPublicPresentation(organizationId, { publicHeaderLogoUrl: logoUrl }, actor.email);
    return Response.json(assetKind === "site-cover" ? { organization, siteCoverUrl: logoUrl } : { organization, logoUrl });
  } catch (error) {
    return platformAuthorizationErrorResponse(error) ?? platformManagementErrorResponse(error)
      ?? Response.json({ error: error instanceof Error ? error.message : "Το upload απέτυχε." }, { status: 400 });
  }
}


 return POST;
}

export function platformPublicHeaderLogo(actor: CanonicalAppUser, scopeOrganizationId?: string) {
  return platformOrganizationImageUpload(actor, scopeOrganizationId, "public-header");
}
export function platformSiteCover(actor: CanonicalAppUser, scopeOrganizationId?: string) {
  const { requireOrganizationAccess } = platformOperationScope(scopeOrganizationId);
  return {
    POST: platformOrganizationImageUpload(actor, scopeOrganizationId, "site-cover"),
    async DELETE(request: Request) {
      try {
        const input = await request.json();
        const organizationId = String(input.organizationId ?? "").trim();
        if (!organizationId) return Response.json({ error: "Απαιτείται Οργανισμός." }, { status: 400 });
        await requireOrganizationAccess(actor, organizationId, "manage");
        // Existing branding retention: clear the reference, never delete shared/default assets.
        const organization = await updateManagedOrganizationSiteCover(organizationId, null, actor.email);
        return Response.json({ organization, siteCoverUrl: null });
      } catch (error) {
        return platformAuthorizationErrorResponse(error) ?? platformManagementErrorResponse(error)
          ?? Response.json({ error: "Η αφαίρεση Site cover απέτυχε." }, { status: 400 });
      }
    },
  };
}
