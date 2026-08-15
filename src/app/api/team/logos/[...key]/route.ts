import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

type RouteContext = {
  params: Promise<{ key: string[] }>;
};

function getImageContentType(key: string) {
  const normalizedKey = key.toLowerCase();

  if (normalizedKey.endsWith(".jpg") || normalizedKey.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalizedKey.endsWith(".png")) return "image/png";
  if (normalizedKey.endsWith(".webp")) return "image/webp";
  if (normalizedKey.endsWith(".avif")) return "image/avif";

  return "application/octet-stream";
}

export async function GET(_request: Request, context: RouteContext) {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_IMAGES) {
    return new Response("Not found", { status: 404 });
  }

  const { key } = await context.params;
  const storageKey = key.join("/");

  if (!storageKey.startsWith("team-logos/")) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.NEWS_IMAGES.get(storageKey);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        object.httpMetadata?.contentType || getImageContentType(storageKey),
      "Cache-Control":
        object.httpMetadata?.cacheControl ||
        "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
