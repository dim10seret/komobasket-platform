import type { NewsArticle } from "@/types/news";

export const legacyNewsArticles: NewsArticle[] = [
  {
    id: "legacy-stratos-mylonas-cup",
    slug: "kypello-stratos-mylonas",
    title: "Το Κύπελλο μετονομάζεται σε «Κύπελλο Στράτος Μυλωνάς»",
    excerpt:
      "Από τη σεζόν 2025-26, το Κύπελλο του KomoBasket φέρει τιμητικά το όνομα του φίλου μας Στράτου Μυλωνά.",
    content: `Το φετινό Κύπελλο είναι αφιερωμένο στη μνήμη του φίλου μας Στράτου Μυλωνά, ενός ανθρώπου που ήταν πάντα δίπλα στον αθλητισμό.

Τον γνωρίσαμε μέσα από την ομάδα «Παλαίμαχοι Αίας» και η παρουσία του άφησε το δικό της ξεχωριστό αποτύπωμα στην αθλητική μας παρέα.

Από τη σεζόν 2025-26, η διοργάνωση θα φέρει τιμητικά το όνομά του: «Κύπελλο Στράτος Μυλωνάς».

Με αυτόν τον τρόπο κρατάμε ζωντανή τη μνήμη του και τιμούμε έναν φίλο που υπήρξε κομμάτι της ιστορίας μας.`,
    season: "2025-26",
    category: "Ανακοίνωση",
    coverImageUrl: null,
    attachments: [],
    status: "published",
    publishedAt: "2026-07-01T12:00:00.000Z",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  },
];

export function getLegacyNewsArticle(slug: string) {
  return legacyNewsArticles.find((article) => article.slug === slug) ?? null;
}
