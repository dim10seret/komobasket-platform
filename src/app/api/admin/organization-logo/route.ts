import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import {
  platformAuthorizationErrorResponse,
  requirePlatformSuperAdmin,
} from "@/lib/platform-authorization";
import {
  listManagedOrganizations,
  platformManagementErrorResponse,
  updateManagedOrganizationLogo,
} from "@/services/platform-management.service";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

export async function POST(request: Request) {
  try {
    const authorization = requireAdmin(request);
    if (authorization.response) return authorization.response;
    const user = await resolveCanonicalAppUser(authorization.identity);
    await requirePlatformSuperAdmin(user);

    const formData = await request.formData();
    const organizationId = String(formData.get("organizationId") ?? "").trim();
    const file = formData.get("file");
    if (!organizationId || !(file instanceof File)) {
      return Response.json({ error: "Απαιτούνται Οργανισμός και αρχείο λογοτύπου." }, { status: 400 });
    }
    const extension = ALLOWED_TYPES.get(file.type);
    if (!extension || file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return Response.json({ error: "Το λογότυπο πρέπει να είναι JPG, PNG, WEBP ή AVIF έως 5MB." }, { status: 400 });
    }

    const organizations = await listManagedOrganizations(user);
    if (!organizations.some((organization) => organization.id === organizationId)) {
      return Response.json({ error: "Ο Οργανισμός δεν είναι διαθέσιμος." }, { status: 404 });
    }

    const filename = `${randomUUID()}.${extension}`;
    const objectKey = `organization-logos/${organizationId}/${filename}`;
    const bytes = await file.arrayBuffer();
    const env = await getKomoBasketCloudflareEnv();
    let logoUrl: string;
    if (env?.NEWS_IMAGES) {
      await env.NEWS_IMAGES.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
      logoUrl = `/api/organization/logos/${objectKey}`;
    } else {
      const outputDirectory = path.join(process.cwd(), "public", "uploads", "organization-logos", organizationId);
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(path.join(outputDirectory, filename), Buffer.from(bytes));
      logoUrl = `/uploads/organization-logos/${organizationId}/${filename}`;
    }

    const organization = await updateManagedOrganizationLogo(
      organizationId,
      logoUrl,
      authorization.identity.email,
    );
    return Response.json({ organization, logoUrl });
  } catch (error) {
    return platformAuthorizationErrorResponse(error)
      ?? platformManagementErrorResponse(error)
      ?? Response.json({ error: error instanceof Error ? error.message : "Η αποθήκευση λογοτύπου απέτυχε." }, { status: 400 });
  }
}
