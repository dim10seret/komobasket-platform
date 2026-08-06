import { requireAdmin } from "@/lib/admin-auth";
import { newsApiError, parseNewsArticlePatch } from "@/lib/news-api";
import {
  deleteNewsArticle,
  updateNewsArticle,
} from "@/services/news.service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const { id } = await context.params;
    const patch = parseNewsArticlePatch(await request.json());
    const article = await updateNewsArticle(id, patch);
    return Response.json({ article });
  } catch (error) {
    return newsApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const { id } = await context.params;
    await deleteNewsArticle(id);
    return Response.json({ ok: true });
  } catch (error) {
    return newsApiError(error);
  }
}
