import path from "node:path";
import { promises as fs } from "node:fs";
import {
  resolvePlatformReadContext,
} from "@/lib/app-user-identity";
import {
  platformAuthorizationErrorResponse,
  requireOrganizationAccess,
  requireTeamAccess,
} from "@/lib/platform-authorization";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { updateLeagueEntity } from "@/services/league-admin.service";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { platformOperationScope } from "@/lib/platform-operation-scope";

export function platformTeamLogo(actor: CanonicalAppUser, scopeOrganizationId?: string) {
 const { requireOrganizationAccess, requireTeamAccess } = platformOperationScope(scopeOrganizationId);
const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

async function POST(request: Request) {
try {
    const formData = await request.formData();
    const file = formData.get("logo");
    const teamId = String(formData.get("teamId") ?? "").trim();
    const user = actor;

    if (!(file instanceof File)) {
      return Response.json(
        { error: "Δεν επιλέχθηκε εικόνα." },
        { status: 400 },
      );
    }

    const extension = allowedImageTypes.get(file.type);
    if (!extension || file.size > MAX_IMAGE_SIZE) {
      return Response.json(
        {
          error:
            "Η εικόνα πρέπει να είναι JPG, PNG, WebP ή AVIF έως 5 MB.",
        },
        { status: 400 },
      );
    }

    if (teamId) {
      await requireTeamAccess(user, teamId, "manage");
    } else {
      const requestedOrganizationId = String(
        formData.get("organizationId") ?? "",
      ).trim();
      const organizationId = requestedOrganizationId
        || (await resolvePlatformReadContext(user)).organizationId;
      await requireOrganizationAccess(user, organizationId, "manage");
    }

    const safeTeamId = teamId || "pending-team";
    const filename = `${crypto.randomUUID()}.${extension}`;
    const objectKey = `team-logos/${safeTeamId}/${filename}`;
    const bytes = await file.arrayBuffer();
    const env = await getKomoBasketCloudflareEnv();
    let logoUrl: string;

    if (env?.NEWS_IMAGES) {
      await env.NEWS_IMAGES.put(objectKey, bytes, {
        httpMetadata: {
          contentType: file.type,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
      logoUrl = `/api/team/logos/${objectKey}`;
    } else if (process.env.NODE_ENV !== "production") {
      const uploadDirectory = path.join(
        process.cwd(),
        "public",
        "uploads",
        "logos",
        safeTeamId,
      );
      await fs.mkdir(uploadDirectory, { recursive: true });
      await fs.writeFile(
        path.join(uploadDirectory, filename),
        Buffer.from(bytes),
      );
      logoUrl = `/uploads/logos/${safeTeamId}/${filename}`;
    } else {
      throw new Error("TEAM_LOGO_STORAGE_NOT_CONFIGURED");
    }

    if (teamId) {
      await updateLeagueEntity(
        "teams",
        { id: teamId, logoUrl },
        actor.email,
        scopeOrganizationId,
      );
    }

    return Response.json({ id: teamId || null, logoUrl });
  } catch (error) {
    const authorizationResponse = platformAuthorizationErrorResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}


 return POST;
}
