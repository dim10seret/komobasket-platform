import { promises as fs } from "node:fs";
import path from "node:path";
import { requirePlatformSuperAdminRequest } from "@/lib/admin-auth";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { newsApiError } from "@/lib/news-api";
import { setNewsArticleCoverImage } from "@/services/news.service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export async function POST(request: Request, context: RouteContext) {
  const authorization = await requirePlatformSuperAdminRequest(request);
  if (authorization.response) return authorization.response;

  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return Response.json({ error: "Δεν επιλέχθηκε εικόνα." }, { status: 400 });
    }

    const extension = allowedImageTypes.get(file.type);
    if (!extension || file.size > MAX_IMAGE_SIZE) {
      return Response.json(
        { error: "Η εικόνα πρέπει να είναι JPG, PNG, WebP ή AVIF έως 5 MB." },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const objectKey = `news/${id}/${crypto.randomUUID()}.${extension}`;
    const env = await getKomoBasketCloudflareEnv();
    let imageUrl: string;

    if (env?.NEWS_IMAGES) {
      await env.NEWS_IMAGES.put(objectKey, bytes, {
        httpMetadata: {
          contentType: file.type,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
      imageUrl = `/api/news/images/${objectKey}`;
    } else if (process.env.NODE_ENV !== "production") {
      const uploadDirectory = path.join(process.cwd(), "public", "uploads", "news", id);
      await fs.mkdir(uploadDirectory, { recursive: true });
      const filename = `${crypto.randomUUID()}.${extension}`;
      await fs.writeFile(path.join(uploadDirectory, filename), Buffer.from(bytes));
      imageUrl = `/uploads/news/${id}/${filename}`;
    } else {
      throw new Error("NEWS_STORAGE_NOT_CONFIGURED");
    }

    const article = await setNewsArticleCoverImage(id, imageUrl);
    return Response.json({ article });
  } catch (error) {
    return newsApiError(error);
  }
}
