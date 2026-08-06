import { readNewsAsset } from "@/lib/news-assets";
import { getPublishedNewsAttachment } from "@/services/news.service";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

function contentDisposition(filename: string, inline: boolean) {
  const safeAscii = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\\r\n]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { attachmentId } = await context.params;
  const attachment = await getPublishedNewsAttachment(attachmentId);
  if (!attachment) return new Response("Not found", { status: 404 });

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
}
