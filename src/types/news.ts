export type NewsStatus = "draft" | "published";

export type NewsAttachment = {
  id: string;
  articleId: string;
  name: string;
  originalName: string;
  downloadUrl: string;
  contentType: string;
  size: number;
  position: number;
  createdAt: string;
};

export type NewsArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  season: string | null;
  category: string;
  coverImageUrl: string | null;
  attachments: NewsAttachment[];
  status: NewsStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewsArticleInput = {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  season?: string | null;
  category?: string;
  status: NewsStatus;
};

export type NewsArticlePatch = Partial<NewsArticleInput>;
