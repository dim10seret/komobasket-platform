import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { NewsArticle } from "@/types/news";

const DEFAULT_FACEBOOK_GRAPH_VERSION = "v26.0";
const DEFAULT_KOMOBASKET_PUBLIC_URL = "https://komobasket.gr";

export type FacebookPublishResult = {
  success: boolean;
  postId?: string;
  error?: string;
};

async function getFacebookConfig() {
  const env = await getKomoBasketCloudflareEnv();

  const pageId =
    env?.FACEBOOK_PAGE_ID ?? process.env.FACEBOOK_PAGE_ID;

  const accessToken =
    env?.FACEBOOK_ACCESS_TOKEN ?? process.env.FACEBOOK_ACCESS_TOKEN;

  const graphVersion =
    env?.FACEBOOK_GRAPH_VERSION ??
    process.env.FACEBOOK_GRAPH_VERSION ??
    DEFAULT_FACEBOOK_GRAPH_VERSION;

  const publicUrl =
    env?.KOMOBASKET_PUBLIC_URL ??
    process.env.KOMOBASKET_PUBLIC_URL ??
    DEFAULT_KOMOBASKET_PUBLIC_URL;

  if (!pageId || !accessToken) {
    return null;
  }

  return {
    pageId,
    accessToken,
    graphVersion,
    publicUrl,
  };
}

function buildArticleUrl(article: NewsArticle, publicUrl: string) {
  const normalizedPublicUrl = publicUrl.replace(/\/+$/, "");

  return `${normalizedPublicUrl}/news/${article.slug}`;
}

function buildFacebookPreview(article: NewsArticle) {
  const normalizedContent = article.content
    .replace(/\s+/g, " ")
    .trim();

  const maxLength = 300;

  if (normalizedContent.length <= maxLength) {
    return normalizedContent;
  }

  const shortened = normalizedContent.slice(0, maxLength);

  const lastSentenceEnd = Math.max(
    shortened.lastIndexOf("."),
    shortened.lastIndexOf("!"),
    shortened.lastIndexOf("?"),
  );

  if (lastSentenceEnd >= 140) {
    return shortened.slice(0, lastSentenceEnd + 1).trim();
  }

  const lastSpace = shortened.lastIndexOf(" ");

  return `${shortened
    .slice(0, lastSpace > 0 ? lastSpace : maxLength)
    .trim()}...`;
}

function buildFacebookMessage(
  article: NewsArticle,
  articleUrl: string,
) {
  const preview = buildFacebookPreview(article);

  return [
    `🏀 ${article.title}`,
    "",
    preview,
    "",
    "📖 Διαβάστε περισσότερα:",
    articleUrl,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function publishNewsArticleToFacebook(
  article: NewsArticle,
): Promise<FacebookPublishResult> {
  console.log("[Facebook] publishNewsArticleToFacebook() called");

  if (article.status !== "published") {
    return {
      success: false,
      error: "ARTICLE_NOT_PUBLISHED",
    };
  }

  const config = await getFacebookConfig();

  console.log("[Facebook] Config loaded:", {
    hasConfig: !!config,
    pageId: config?.pageId,
    hasAccessToken: !!config?.accessToken,
    graphVersion: config?.graphVersion,
    publicUrl: config?.publicUrl,
  });

  if (!config) {
    console.warn(
      "[Facebook] FACEBOOK_PAGE_ID or FACEBOOK_ACCESS_TOKEN is missing.",
    );

    return {
      success: false,
      error: "FACEBOOK_NOT_CONFIGURED",
    };
  }

  const articleUrl = buildArticleUrl(
    article,
    config.publicUrl,
  );

  const message = buildFacebookMessage(
    article,
    articleUrl,
  );

  try {
    console.log(
      `[Facebook] Starting publication for article: ${article.slug}`,
    );

    const response = await fetch(
      `https://graph.facebook.com/${config.graphVersion}/${config.pageId}/feed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          message,
          link: articleUrl,
          access_token: config.accessToken,
        }),
      },
    );

    const result = (await response.json()) as {
      id?: string;
      error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
      };
    };

    if (!response.ok || !result.id) {
      const errorMessage =
        result.error?.message ||
        `Facebook API returned HTTP ${response.status}`;

      console.error("[Facebook] Publication failed:", {
        status: response.status,
        message: errorMessage,
        type: result.error?.type,
        code: result.error?.code,
        subcode: result.error?.error_subcode,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }

    console.log(
      `[Facebook] Article published successfully: ${result.id}`,
    );

    return {
      success: true,
      postId: result.id,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "UNKNOWN_FACEBOOK_ERROR";

    console.error(
      "[Facebook] Publication error:",
      errorMessage,
    );

    return {
      success: false,
      error: errorMessage,
    };
  }
}