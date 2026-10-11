import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { readPublicMvpPhotoWithDb } from "@/services/mvp-publication.service";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, context: { params: Promise<{ contestId: string; filename: string }> }) {
  const env = await getKomoBasketCloudflareEnv();
  if (env?.MVP_PUBLIC_READ_ENABLED !== "enabled") return new Response(null, { status: 404, headers: NO_STORE });
  if (!env.NEWS_DB || !env.NEWS_IMAGES) return new Response(null, { status: 503, headers: NO_STORE });
  const { contestId, filename } = await context.params;
  try {
    const key = await readPublicMvpPhotoWithDb(env.NEWS_DB, contestId, filename);
    if (!key) return new Response(null, { status: 404, headers: NO_STORE });
    const object = await env.NEWS_IMAGES.get(key);
    if (!object) return new Response(null, { status: 404, headers: NO_STORE });
    const contentType = object.httpMetadata?.contentType;
    if (!contentType || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(contentType))
      return new Response(null, { status: 404, headers: NO_STORE });
    return new Response(object.body as BodyInit, { headers: { ...NO_STORE, "Content-Type": contentType } });
  } catch { return new Response(null, { status: 503, headers: NO_STORE }); }
}
