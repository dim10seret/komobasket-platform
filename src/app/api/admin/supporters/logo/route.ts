import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireAdmin } from "@/lib/admin-auth";
import { resolveCanonicalAppUser } from "@/lib/app-user-identity";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { platformAuthorizationErrorResponse, requireOrganizationAccess, requirePlatformSuperAdmin } from "@/lib/platform-authorization";
import { KOMOBASKET_ORGANIZATION_ID } from "@/services/supporters.service";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"]]);

export async function POST(request: Request) {
  try {
    const authorization = await requireAdmin(request);
    if (authorization.response) return authorization.response;
    const user = await resolveCanonicalAppUser(authorization.identity);
    const formData = await request.formData();
    const organizationId = String(formData.get("organizationId") ?? "").trim() || KOMOBASKET_ORGANIZATION_ID;
    await requirePlatformSuperAdmin(user);
    await requireOrganizationAccess(user, organizationId, "manage");
    const file = formData.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Απαιτείται αρχείο λογοτύπου." }, { status: 400 });
    const extension = ALLOWED_TYPES.get(file.type);
    if (!extension || file.size <= 0 || file.size > MAX_FILE_SIZE) return Response.json({ error: "Το λογότυπο πρέπει να είναι JPG, PNG, WEBP ή AVIF έως 5MB." }, { status: 400 });
    const filename = `${randomUUID()}.${extension}`;
    const objectKey = `supporter-logos/${organizationId}/${filename}`;
    const bytes = await file.arrayBuffer();
    const env = await getKomoBasketCloudflareEnv();
    let logoUrl: string;
    if (env?.NEWS_IMAGES) {
      await env.NEWS_IMAGES.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
      logoUrl = `/api/supporter-logos/${objectKey}`;
    } else {
      const directory = path.join(process.cwd(), "public", "uploads", "supporter-logos", organizationId);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, filename), Buffer.from(bytes));
      logoUrl = `/uploads/supporter-logos/${encodeURIComponent(organizationId)}/${filename}`;
    }
    return Response.json({ logoUrl });
  } catch (error) {
    return platformAuthorizationErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Το upload απέτυχε." }, { status: 400 });
  }
}
