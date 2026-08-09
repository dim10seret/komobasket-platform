import type { NewsArticle } from "@/types/news";

export const legacyNewsArticles: NewsArticle[] = [];

export function getLegacyNewsArticle(slug: string) {
  return legacyNewsArticles.find((article) => article.slug === slug) ?? null;
}