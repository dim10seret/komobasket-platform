import { readFile } from "node:fs/promises";
import path from "node:path";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

const CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const objectKey = key.join("/");
  if (!objectKey.startsWith("organization-logos/") || objectKey.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const env = await getKomoBasketCloudflareEnv();
  if (env?.NEWS_IMAGES) {
    const object = await env.NEWS_IMAGES.get(objectKey);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      },
    });
  }

  try {
    const filePath = path.join(process.cwd(), "public", "uploads", ...key);
    const extension = objectKey.split(".").pop()?.toLowerCase() ?? "";
    return new Response(await readFile(filePath), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
