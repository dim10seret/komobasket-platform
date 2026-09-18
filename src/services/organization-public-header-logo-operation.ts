import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { platformAuthorizationErrorResponse, requireOrganizationAccess } from "@/lib/platform-authorization";
import { platformManagementErrorResponse, updateManagedOrganizationPublicPresentation } from "@/services/platform-management.service";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { platformOperationScope } from "@/lib/platform-operation-scope";

export function platformPublicHeaderLogo(actor: CanonicalAppUser, scopeOrganizationId?: string) {
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
    const objectKey = `organization-logos/${organizationId}/public-header/${filename}`;
    const bytes = await file.arrayBuffer();
    const env = await getKomoBasketCloudflareEnv();
    let logoUrl: string;
    if (env?.NEWS_IMAGES) {
      await env.NEWS_IMAGES.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
      logoUrl = `/api/organization/logos/${objectKey}`;
    } else {
      const directory = path.join(process.cwd(), "public", "uploads", "organization-logos", organizationId, "public-header");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, filename), Buffer.from(bytes));
      logoUrl = `/uploads/organization-logos/${encodeURIComponent(organizationId)}/public-header/${filename}`;
    }
    const organization = await updateManagedOrganizationPublicPresentation(organizationId, { publicHeaderLogoUrl: logoUrl }, actor.email);
    return Response.json({ organization, logoUrl });
  } catch (error) {
    return platformAuthorizationErrorResponse(error) ?? platformManagementErrorResponse(error)
      ?? Response.json({ error: error instanceof Error ? error.message : "Το upload απέτυχε." }, { status: 400 });
  }
}


 return POST;
}
