import { promises as fs } from "node:fs";
import path from "node:path";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";

const localAssetsDirectory = path.join(
  process.cwd(),
  "data",
  "news-uploaded-files",
);

function getSafeLocalPath(storageKey: string) {
  const normalized = storageKey.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("INVALID_ATTACHMENT_PATH");
  }

  return path.join(localAssetsDirectory, ...normalized.split("/"));
}

export async function storeNewsAsset(
  storageKey: string,
  bytes: ArrayBuffer,
  contentType: string,
) {
  const env = await getKomoBasketCloudflareEnv();
  if (env?.NEWS_IMAGES) {
    await env.NEWS_IMAGES.put(storageKey, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: "private, max-age=0, must-revalidate",
      },
    });
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const filePath = getSafeLocalPath(storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(bytes));
    return;
  }

  throw new Error("NEWS_STORAGE_NOT_CONFIGURED");
}

export async function readNewsAsset(storageKey: string) {
  const env = await getKomoBasketCloudflareEnv();
  if (env?.NEWS_IMAGES) {
    const object = await env.NEWS_IMAGES.get(storageKey);
    if (!object) return null;
    return {
      body: object.body as BodyInit,
      etag: object.httpEtag,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const bytes = await fs.readFile(getSafeLocalPath(storageKey));
      return { body: bytes as BodyInit, etag: null };
    } catch {
      return null;
    }
  }

  return null;
}

export async function deleteNewsAsset(storageKey: string) {
  const env = await getKomoBasketCloudflareEnv();
  if (env?.NEWS_IMAGES) {
    await env.NEWS_IMAGES.delete(storageKey);
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      await fs.unlink(getSafeLocalPath(storageKey));
    } catch {
      // The metadata can still be removed when an old file is already missing.
    }
  }
}
