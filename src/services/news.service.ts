import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { legacyNewsArticles } from "../../data/news";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { deleteNewsAsset } from "@/lib/news-assets";
import { createNewsSlug } from "@/lib/news-slug";
import type {
  NewsAttachment,
  NewsArticle,
  NewsArticleInput,
  NewsArticlePatch,
  NewsStatus,
} from "@/types/news";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type NewsRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  season: string | null;
  category: string;
  cover_image_url: string | null;
  status: NewsStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type AttachmentRow = {
  id: string;
  article_id: string;
  name: string;
  original_name: string;
  storage_key: string;
  content_type: string;
  size: number;
  position: number;
  created_at: string;
};

export type StoredNewsAttachment = NewsAttachment & {
  storageKey: string;
};

const localNewsFile = path.join(
  process.cwd(),
  "data",
  "news-content.json",
);

const localAttachmentsFile = path.join(
  process.cwd(),
  "data",
  "news-attachments.json",
);

function rowToArticle(
  row: NewsRow,
  attachments: NewsAttachment[] = [],
): NewsArticle {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    season: row.season,
    category: row.category,
    coverImageUrl: row.cover_image_url,
    attachments,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAttachment(
  row: AttachmentRow,
): StoredNewsAttachment {
  return {
    id: row.id,
    articleId: row.article_id,
    name: row.name,
    originalName: row.original_name,
    downloadUrl: `/api/news/attachments/${row.id}`,
    contentType: row.content_type,
    size: row.size,
    position: row.position,
    createdAt: row.created_at,
    storageKey: row.storage_key,
  };
}

async function getDatabase() {
  const env = await getKomoBasketCloudflareEnv();

  return env?.NEWS_DB ?? null;
}

function shouldUseLocalStore() {
  return process.env.NODE_ENV !== "production";
}

async function readLocalArticles(): Promise<NewsArticle[]> {
  try {
    const content = await fs.readFile(
      localNewsFile,
      "utf8",
    );

    const parsed = JSON.parse(
      content,
    ) as NewsArticle[];

    return Array.isArray(parsed)
      ? parsed.map((article) => ({
          ...article,
          attachments:
            article.attachments ?? [],
        }))
      : [];
  } catch {
    return [];
  }
}

async function writeLocalArticles(
  articles: NewsArticle[],
) {
  await fs.writeFile(
    localNewsFile,
    `${JSON.stringify(articles, null, 2)}\n`,
    "utf8",
  );
}

async function readLocalAttachments(): Promise<
  StoredNewsAttachment[]
> {
  try {
    const content = await fs.readFile(
      localAttachmentsFile,
      "utf8",
    );

    const parsed = JSON.parse(
      content,
    ) as StoredNewsAttachment[];

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch {
    return [];
  }
}

async function writeLocalAttachments(
  attachments: StoredNewsAttachment[],
) {
  await fs.writeFile(
    localAttachmentsFile,
    `${JSON.stringify(
      attachments,
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function attachFilesToArticles(
  articles: NewsArticle[],
  attachments: NewsAttachment[],
) {
  return articles.map((article) => ({
    ...article,

    attachments: attachments
      .filter(
        (attachment) =>
          attachment.articleId === article.id,
      )
      .sort(
        (first, second) =>
          first.position - second.position,
      ),
  }));
}

async function listDatabaseAttachments(
  database: D1DatabaseBinding,
) {
  const result = await database
    .prepare(
      `SELECT id, article_id, name, original_name, storage_key,
        content_type, size, position, created_at
       FROM news_attachments
       ORDER BY position ASC, created_at ASC`,
    )
    .all<AttachmentRow>();

  return (result.results ?? []).map(
    rowToAttachment,
  );
}

async function listDatabaseArticles(
  database: D1DatabaseBinding,
) {
  const [articleResult, attachments] =
    await Promise.all([
      database
        .prepare(
          `SELECT id, slug, title, excerpt, content, season, category,
            cover_image_url, status, published_at, created_at, updated_at
           FROM news_articles
           ORDER BY COALESCE(published_at, updated_at) DESC`,
        )
        .all<NewsRow>(),

      listDatabaseAttachments(database),
    ]);

  return attachFilesToArticles(
    (articleResult.results ?? []).map(
      (row) => rowToArticle(row),
    ),
    attachments,
  );
}

export async function listAllNewsArticles() {
  const database = await getDatabase();

  if (database) {
    return listDatabaseArticles(database);
  }

  if (shouldUseLocalStore()) {
    return attachFilesToArticles(
      await readLocalArticles(),
      await readLocalAttachments(),
    );
  }

  throw new Error(
    "NEWS_STORAGE_NOT_CONFIGURED",
  );
}

export async function listPublishedNewsArticles() {
  let dynamicArticles: NewsArticle[] = [];

  try {
    const database = await getDatabase();

    if (database) {
      const result = await database
        .prepare(
          `SELECT id, slug, title, excerpt, content, season, category,
            cover_image_url, status, published_at, created_at, updated_at
           FROM news_articles
           WHERE status = 'published'
           ORDER BY published_at DESC`,
        )
        .all<NewsRow>();

      const attachments =
        await listDatabaseAttachments(
          database,
        );

      dynamicArticles =
        attachFilesToArticles(
          (
            result.results ?? []
          ).map((row) =>
            rowToArticle(row),
          ),
          attachments,
        );
    } else if (
      shouldUseLocalStore()
    ) {
      dynamicArticles = (
        await attachFilesToArticles(
          await readLocalArticles(),
          await readLocalAttachments(),
        )
      ).filter(
        (article) =>
          article.status ===
          "published",
      );
    }
  } catch {
    dynamicArticles = [];
  }

  const dynamicSlugs = new Set(
    dynamicArticles.map(
      (article) => article.slug,
    ),
  );

  return [
    ...dynamicArticles,

    ...legacyNewsArticles.filter(
      (article) =>
        !dynamicSlugs.has(
          article.slug,
        ),
    ),
  ].sort(
    (first, second) =>
      new Date(
        second.publishedAt ??
          second.updatedAt,
      ).getTime() -
      new Date(
        first.publishedAt ??
          first.updatedAt,
      ).getTime(),
  );
}

export async function getPublishedNewsArticle(
  slug: string,
) {
  const articles =
    await listPublishedNewsArticles();

  return (
    articles.find(
      (article) =>
        article.slug === slug,
    ) ?? null
  );
}

export async function createNewsArticle(
  input: NewsArticleInput,
  authorEmail: string,
) {
  const now = new Date().toISOString();

  const slug = createNewsSlug(
    input.slug || input.title,
  );

  if (!slug) {
    throw new Error("INVALID_SLUG");
  }

  const article: NewsArticle = {
    id: crypto.randomUUID(),
    slug,
    title: input.title.trim(),
    excerpt: input.excerpt.trim(),
    content: input.content.trim(),

    season:
      input.season?.trim() || null,

    category:
      input.category?.trim() ||
      "Ανακοίνωση",

    coverImageUrl: null,

    attachments: [],

    status: input.status,

    publishedAt:
      input.status === "published"
        ? now
        : null,

    createdAt: now,
    updatedAt: now,
  };

  const database =
    await getDatabase();

  if (database) {
    await database
      .prepare(
        `INSERT INTO news_articles (
          id,
          slug,
          title,
          excerpt,
          content,
          season,
          category,
          cover_image_url,
          status,
          published_at,
          created_at,
          updated_at,
          author_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        article.id,
        article.slug,
        article.title,
        article.excerpt,
        article.content,
        article.season,
        article.category,
        article.coverImageUrl,
        article.status,
        article.publishedAt,
        article.createdAt,
        article.updatedAt,
        authorEmail,
      )
      .run();

    /*
     * ΣΗΜΑΝΤΙΚΟ:
     *
     * Δεν δημοσιεύουμε πλέον στο Facebook εδώ.
     *
     * Η εικόνα του άρθρου και τα συνημμένα
     * ανεβαίνουν μετά τη δημιουργία του άρθρου.
     *
     * Η δημοσίευση στο Facebook γίνεται
     * στο τέλος της διαδικασίας μέσω:
     *
     * POST /api/admin/news/[id]/facebook
     */

    return article;
  }

  if (!shouldUseLocalStore()) {
    throw new Error(
      "NEWS_STORAGE_NOT_CONFIGURED",
    );
  }

  const articles =
    await readLocalArticles();

  if (
    articles.some(
      (existing) =>
        existing.slug ===
        article.slug,
    )
  ) {
    throw new Error(
      "DUPLICATE_SLUG",
    );
  }

  articles.unshift(article);

  await writeLocalArticles(
    articles,
  );

  return article;
}

export async function updateNewsArticle(
  id: string,
  patch: NewsArticlePatch,
) {
  const articles =
    await listAllNewsArticles();

  const current = articles.find(
    (article) => article.id === id,
  );

  if (!current) {
    throw new Error(
      "ARTICLE_NOT_FOUND",
    );
  }

  const nextStatus =
    patch.status ?? current.status;

  const updated: NewsArticle = {
    ...current,

    slug: createNewsSlug(
      patch.slug ?? current.slug,
    ),

    title:
      patch.title?.trim() ??
      current.title,

    excerpt:
      patch.excerpt?.trim() ??
      current.excerpt,

    content:
      patch.content?.trim() ??
      current.content,

    season:
      patch.season === undefined
        ? current.season
        : patch.season?.trim() ||
          null,

    category:
      patch.category?.trim() ||
      current.category,

    status: nextStatus,

    publishedAt:
      nextStatus === "published"
        ? current.publishedAt ??
          new Date().toISOString()
        : null,

    updatedAt:
      new Date().toISOString(),
  };

  const database =
    await getDatabase();

  if (database) {
    await database
      .prepare(
        `UPDATE news_articles SET
          slug = ?,
          title = ?,
          excerpt = ?,
          content = ?,
          season = ?,
          category = ?,
          status = ?,
          published_at = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        updated.slug,
        updated.title,
        updated.excerpt,
        updated.content,
        updated.season,
        updated.category,
        updated.status,
        updated.publishedAt,
        updated.updatedAt,
        id,
      )
      .run();

    /*
     * Δεν δημοσιεύουμε πλέον
     * στο Facebook από εδώ.
     *
     * Ακόμη και όταν ένα draft
     * γίνεται published, το CMS
     * θα ολοκληρώσει πρώτα:
     *
     * 1. ενημέρωση άρθρου
     * 2. εικόνα
     * 3. συνημμένα
     * 4. Facebook
     */

    return updated;
  }

  const nextArticles =
    articles.map((article) =>
      article.id === id
        ? updated
        : article,
    );

  await writeLocalArticles(
    nextArticles,
  );

  return updated;
}

export async function setNewsArticleCoverImage(
  id: string,
  coverImageUrl: string,
) {
  const articles =
    await listAllNewsArticles();

  const current = articles.find(
    (article) => article.id === id,
  );

  if (!current) {
    throw new Error(
      "ARTICLE_NOT_FOUND",
    );
  }

  const updated = {
    ...current,
    coverImageUrl,
    updatedAt:
      new Date().toISOString(),
  };

  const database =
    await getDatabase();

  if (database) {
    await database
      .prepare(
        `UPDATE news_articles
         SET cover_image_url = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        updated.coverImageUrl,
        updated.updatedAt,
        id,
      )
      .run();
  } else {
    await writeLocalArticles(
      articles.map((article) =>
        article.id === id
          ? updated
          : article,
      ),
    );
  }

  return updated;
}

export async function deleteNewsArticle(
  id: string,
) {
  const database =
    await getDatabase();

  if (database) {
    const attachments = (
      await listDatabaseAttachments(
        database,
      )
    ).filter(
      (attachment) =>
        attachment.articleId === id,
    );

    await Promise.all(
      attachments.map(
        (attachment) =>
          deleteNewsAsset(
            attachment.storageKey,
          ),
      ),
    );

    await database
      .prepare(
        `DELETE FROM news_attachments
         WHERE article_id = ?`,
      )
      .bind(id)
      .run();

    await database
      .prepare(
        `DELETE FROM news_articles
         WHERE id = ?`,
      )
      .bind(id)
      .run();

    return;
  }

  if (!shouldUseLocalStore()) {
    throw new Error(
      "NEWS_STORAGE_NOT_CONFIGURED",
    );
  }

  const articles =
    await readLocalArticles();

  await writeLocalArticles(
    articles.filter(
      (article) =>
        article.id !== id,
    ),
  );

  const attachments =
    await readLocalAttachments();

  await Promise.all(
    attachments
      .filter(
        (attachment) =>
          attachment.articleId ===
          id,
      )
      .map((attachment) =>
        deleteNewsAsset(
          attachment.storageKey,
        ),
      ),
  );

  await writeLocalAttachments(
    attachments.filter(
      (attachment) =>
        attachment.articleId !== id,
    ),
  );
}

export async function createNewsAttachment(
  articleId: string,
  input: {
    name: string;
    originalName: string;
    storageKey: string;
    contentType: string;
    size: number;
  },
) {
  const article = (
    await listAllNewsArticles()
  ).find(
    (candidate) =>
      candidate.id === articleId,
  );

  if (!article) {
    throw new Error(
      "ARTICLE_NOT_FOUND",
    );
  }

  if (
    article.attachments.length >= 10
  ) {
    throw new Error(
      "TOO_MANY_ATTACHMENTS",
    );
  }

  const attachment: StoredNewsAttachment =
    {
      id: crypto.randomUUID(),

      articleId,

      name:
        input.name.trim() ||
        input.originalName,

      originalName:
        input.originalName,

      downloadUrl: "",

      contentType:
        input.contentType,

      size: input.size,

      position:
        article.attachments.length,

      createdAt:
        new Date().toISOString(),

      storageKey:
        input.storageKey,
    };

  attachment.downloadUrl =
    `/api/news/attachments/${attachment.id}`;

  const database =
    await getDatabase();

  if (database) {
    await database
      .prepare(
        `INSERT INTO news_attachments (
          id,
          article_id,
          name,
          original_name,
          storage_key,
          content_type,
          size,
          position,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        attachment.id,
        attachment.articleId,
        attachment.name,
        attachment.originalName,
        attachment.storageKey,
        attachment.contentType,
        attachment.size,
        attachment.position,
        attachment.createdAt,
      )
      .run();
  } else if (
    shouldUseLocalStore()
  ) {
    const attachments =
      await readLocalAttachments();

    attachments.push(
      attachment,
    );

    await writeLocalAttachments(
      attachments,
    );
  } else {
    throw new Error(
      "NEWS_STORAGE_NOT_CONFIGURED",
    );
  }

  return attachment;
}

export async function updateNewsAttachment(
  attachmentId: string,
  patch: {
    name?: string;
    position?: number;
  },
) {
  const attachment =
    await getStoredNewsAttachment(
      attachmentId,
    );

  if (!attachment) {
    throw new Error(
      "ATTACHMENT_NOT_FOUND",
    );
  }

  const updated: StoredNewsAttachment =
    {
      ...attachment,

      name:
        patch.name?.trim() ||
        attachment.name,

      position:
        typeof patch.position ===
          "number" &&
        patch.position >= 0
          ? Math.floor(
              patch.position,
            )
          : attachment.position,
    };

  const database =
    await getDatabase();

  if (database) {
    await database
      .prepare(
        `UPDATE news_attachments
         SET name = ?,
             position = ?
         WHERE id = ?`,
      )
      .bind(
        updated.name,
        updated.position,
        attachmentId,
      )
      .run();
  } else {
    const attachments =
      await readLocalAttachments();

    await writeLocalAttachments(
      attachments.map((item) =>
        item.id === attachmentId
          ? updated
          : item,
      ),
    );
  }

  return updated;
}

export async function getStoredNewsAttachment(
  attachmentId: string,
) {
  const database =
    await getDatabase();

  if (database) {
    const row = await database
      .prepare(
        `SELECT id, article_id, name, original_name, storage_key,
          content_type, size, position, created_at
         FROM news_attachments
         WHERE id = ?`,
      )
      .bind(attachmentId)
      .first<AttachmentRow>();

    return row
      ? rowToAttachment(row)
      : null;
  }

  if (shouldUseLocalStore()) {
    return (
      (
        await readLocalAttachments()
      ).find(
        (attachment) =>
          attachment.id ===
          attachmentId,
      ) ?? null
    );
  }

  return null;
}

export async function getPublishedNewsAttachment(
  attachmentId: string,
) {
  const attachment =
    await getStoredNewsAttachment(
      attachmentId,
    );

  if (!attachment) {
    return null;
  }

  const article = (
    await listPublishedNewsArticles()
  ).find(
    (candidate) =>
      candidate.id ===
      attachment.articleId,
  );

  return article
    ? attachment
    : null;
}

export async function deleteNewsAttachment(
  attachmentId: string,
) {
  const attachment =
    await getStoredNewsAttachment(
      attachmentId,
    );

  if (!attachment) {
    throw new Error(
      "ATTACHMENT_NOT_FOUND",
    );
  }

  const database =
    await getDatabase();

  if (database) {
    await database
      .prepare(
        `DELETE FROM news_attachments
         WHERE id = ?`,
      )
      .bind(attachmentId)
      .run();
  } else {
    const attachments =
      await readLocalAttachments();

    await writeLocalAttachments(
      attachments.filter(
        (item) =>
          item.id !==
          attachmentId,
      ),
    );
  }

  return attachment;
}