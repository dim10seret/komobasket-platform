import type { NewsArticleInput, NewsArticlePatch, NewsStatus } from "@/types/news";

function isNewsStatus(value: unknown): value is NewsStatus {
  return value === "draft" || value === "published";
}

function getRequiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MISSING_${field.toUpperCase()}`);
  }
  return value.trim();
}

export function parseNewsArticleInput(value: unknown): NewsArticleInput {
  if (!value || typeof value !== "object") {
    throw new Error("INVALID_BODY");
  }

  const body = value as Record<string, unknown>;
  if (!isNewsStatus(body.status)) {
    throw new Error("INVALID_STATUS");
  }

  return {
    title: getRequiredText(body.title, "title"),
    slug:
      typeof body.slug === "string" && body.slug.trim()
        ? body.slug.trim()
        : getRequiredText(body.title, "title"),
    excerpt: getRequiredText(body.excerpt, "excerpt"),
    content: getRequiredText(body.content, "content"),
    season: typeof body.season === "string" ? body.season : null,
    category: typeof body.category === "string" ? body.category : "Ανακοίνωση",
    status: body.status,
  };
}

export function parseNewsArticlePatch(value: unknown): NewsArticlePatch {
  if (!value || typeof value !== "object") {
    throw new Error("INVALID_BODY");
  }

  const body = value as Record<string, unknown>;
  const patch: NewsArticlePatch = {};

  if ("title" in body) patch.title = getRequiredText(body.title, "title");
  if ("slug" in body) patch.slug = getRequiredText(body.slug, "slug");
  if ("excerpt" in body) patch.excerpt = getRequiredText(body.excerpt, "excerpt");
  if ("content" in body) patch.content = getRequiredText(body.content, "content");
  if ("season" in body) {
    patch.season = typeof body.season === "string" ? body.season : null;
  }
  if ("category" in body) {
    patch.category = getRequiredText(body.category, "category");
  }
  if ("status" in body) {
    if (!isNewsStatus(body.status)) throw new Error("INVALID_STATUS");
    patch.status = body.status;
  }

  return patch;
}

export function newsApiError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";

  if (code === "ARTICLE_NOT_FOUND") {
    return Response.json({ error: "Η ανακοίνωση δεν βρέθηκε." }, { status: 404 });
  }
  if (code === "ATTACHMENT_NOT_FOUND") {
    return Response.json({ error: "Το συνημμένο δεν βρέθηκε." }, { status: 404 });
  }
  if (code === "TOO_MANY_ATTACHMENTS") {
    return Response.json(
      { error: "Κάθε ανακοίνωση μπορεί να έχει έως 10 συνημμένα." },
      { status: 400 },
    );
  }
  if (code === "DUPLICATE_SLUG") {
    return Response.json(
      { error: "Υπάρχει ήδη ανακοίνωση με τον ίδιο σύνδεσμο." },
      { status: 409 },
    );
  }
  if (code === "NEWS_STORAGE_NOT_CONFIGURED") {
    return Response.json(
      { error: "Η αποθήκευση ανακοινώσεων δεν έχει ακόμη συνδεθεί στη φιλοξενία." },
      { status: 503 },
    );
  }
  if (
    code.startsWith("MISSING_") ||
    code === "INVALID_BODY" ||
    code === "INVALID_STATUS" ||
    code === "INVALID_SLUG" ||
    code === "INVALID_ATTACHMENT"
  ) {
    return Response.json(
      { error: "Συμπλήρωσε όλα τα υποχρεωτικά πεδία της ανακοίνωσης." },
      { status: 400 },
    );
  }

  console.error("News API error:", error);
  return Response.json(
    { error: "Παρουσιάστηκε προσωρινό πρόβλημα. Δοκίμασε ξανά." },
    { status: 500 },
  );
}
