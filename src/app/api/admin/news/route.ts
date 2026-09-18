import { requirePlatformSuperAdminRequest } from "@/lib/admin-auth";
import { newsApiError, parseNewsArticleInput } from "@/lib/news-api";
import {
  createNewsArticle,
  listAllNewsArticles,
} from "@/services/news.service";

export async function GET(request: Request) {
  const authorization = await requirePlatformSuperAdminRequest(request);

  if (authorization.response) {
    return authorization.response;
  }

  try {
    const articles = await listAllNewsArticles();

    return Response.json({ articles });
  } catch (error) {
    return newsApiError(error);
  }
}

export async function POST(request: Request) {
  const authorization = await requirePlatformSuperAdminRequest(request);

  if (authorization.response) {
    return authorization.response;
  }

  try {
    const input = parseNewsArticleInput(await request.json());

    console.log("[API] About to call createNewsArticle", {
      status: input.status,
      title: input.title,
    });

    const article = await createNewsArticle(
      input,
      authorization.identity.email,
    );

    console.log("[API] createNewsArticle finished", {
      id: article.id,
      status: article.status,
      slug: article.slug,
    });

    return Response.json(
      { article },
      { status: 201 },
    );
  } catch (error) {
    console.error("[API] POST /api/admin/news failed", error);

    return newsApiError(error);
  }
}