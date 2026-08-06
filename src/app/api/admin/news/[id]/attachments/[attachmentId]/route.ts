import { requireAdmin } from "@/lib/admin-auth";
import { newsApiError } from "@/lib/news-api";
import { deleteNewsAsset, readNewsAsset } from "@/lib/news-assets";
import {
  deleteNewsAttachment,
  getStoredNewsAttachment,
  updateNewsAttachment,
} from "@/services/news.service";

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

function contentDisposition(filename: string, inline: boolean) {
  const safeAscii = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\\r\n]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function getRouteAttachment(context: RouteContext) {
  const { id, attachmentId } = await context.params;
  const attachment = await getStoredNewsAttachment(attachmentId);
  if (!attachment || attachment.articleId !== id) {
    throw new Error("ATTACHMENT_NOT_FOUND");
  }
  return attachment;
}

export async function GET(request: Request, context: RouteContext) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const attachment = await getRouteAttachment(context);
    const asset = await readNewsAsset(attachment.storageKey);
    if (!asset) return new Response("Not found", { status: 404 });

    const headers = new Headers({
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.size),
      "Content-Disposition": contentDisposition(
        attachment.originalName,
        attachment.contentType === "application/pdf",
      ),
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    });
    if (asset.etag) headers.set("ETag", asset.etag);
    return new Response(asset.body, { headers });
  } catch (error) {
    return newsApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const currentAttachment = await getRouteAttachment(context);
    const body = (await request.json()) as {
      name?: unknown;
      position?: unknown;
    };
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 160) : undefined;
    const position =
      typeof body.position === "number" ? body.position : undefined;
    if (!name && position === undefined) throw new Error("INVALID_ATTACHMENT");

    const attachment = await updateNewsAttachment(currentAttachment.id, {
      name,
      position,
    });
    return Response.json({ attachment });
  } catch (error) {
    return newsApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const currentAttachment = await getRouteAttachment(context);
    const attachment = await deleteNewsAttachment(currentAttachment.id);
    await deleteNewsAsset(attachment.storageKey);
    return Response.json({ ok: true });
  } catch (error) {
    return newsApiError(error);
  }
}
