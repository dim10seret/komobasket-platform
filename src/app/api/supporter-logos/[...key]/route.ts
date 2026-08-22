import { readFile } from "node:fs/promises";
import path from "node:path";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  const objectKey = key.join("/");
  if (!objectKey.startsWith("supporter-logos/") || objectKey.includes("..")) return new Response("Not found", { status: 404 });
  const env = await getKomoBasketCloudflareEnv();
  if (env?.NEWS_IMAGES) {
    const object = await env.NEWS_IMAGES.get(objectKey);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
  }
  try {
    const file = await readFile(path.join(process.cwd(), "public", "uploads", ...key));
    return new Response(file, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
