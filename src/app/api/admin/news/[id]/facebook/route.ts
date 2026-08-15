import { requireAdmin } from "@/lib/admin-auth";
import { newsApiError } from "@/lib/news-api";
import { publishNewsArticleToFacebook } from "@/services/facebook.service";
import { listAllNewsArticles } from "@/services/news.service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
) {
  const authorization = requireAdmin(request);

  if (authorization.response) {
    return authorization.response;
  }

  try {
    const { id } = await context.params;

    const articles = await listAllNewsArticles();

    const article = articles.find(
      (candidate) => candidate.id === id,
    );

    if (!article) {
      return Response.json(
        { error: "Η ανακοίνωση δεν βρέθηκε." },
        { status: 404 },
      );
    }

    if (article.status !== "published") {
      return Response.json(
        {
          error:
            "Η ανακοίνωση πρέπει να είναι δημοσιευμένη πριν σταλεί στο Facebook.",
        },
        { status: 400 },
      );
    }

    const result =
      await publishNewsArticleToFacebook(article);

    if (!result.success) {
      return Response.json(
        {
          error:
            result.error ||
            "Η δημοσίευση στο Facebook απέτυχε.",
        },
        { status: 502 },
      );
    }

    return Response.json({
      success: true,
      postId: result.postId,
    });
  } catch (error) {
    return newsApiError(error);
  }
}