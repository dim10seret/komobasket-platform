import { requireAdmin } from "@/lib/admin-auth";
import { newsApiError, parseNewsArticleInput } from "@/lib/news-api";
import {
  createNewsArticle,
  listAllNewsArticles,
} from "@/services/news.service";

export async function GET(request: Request) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const articles = await listAllNewsArticles();
    return Response.json({ articles });
  } catch (error) {
    return newsApiError(error);
  }
}

export async function POST(request: Request) {
  const authorization = requireAdmin(request);
  if (authorization.response) return authorization.response;

  try {
    const input = parseNewsArticleInput(await request.json());
    const article = await createNewsArticle(input, authorization.identity.email);
    return Response.json({ article }, { status: 201 });
  } catch (error) {
    return newsApiError(error);
  }
}
