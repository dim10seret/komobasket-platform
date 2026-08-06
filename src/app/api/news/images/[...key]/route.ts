import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

type RouteContext = {
  params: Promise<{ key: string[] }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_IMAGES) {
    return new Response("Not found", { status: 404 });
  }

  const { key } = await context.params;
  const object = await env.NEWS_IMAGES.get(key.join("/"));
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body as BodyInit, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control":
        object.httpMetadata?.cacheControl || "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
}
