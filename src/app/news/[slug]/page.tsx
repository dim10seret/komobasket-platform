import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { notFound } from "next/navigation";
import Header from "@/components/layout/Header";
import { getPublishedNewsArticle } from "@/services/news.service";

export const dynamic = "force-dynamic";

const siteUrl = "https://komobasket.gr";
const defaultArticleImage =
  "https://komobasket.gr/assets/komobasket-og-cover.jpg";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function renderTextWithLinks(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    const isUrl = /^https?:\/\/[^\s]+$/.test(part);

    if (isUrl) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-orange-600 underline decoration-orange-300 underline-offset-4 transition hover:text-orange-700 hover:decoration-orange-600"
        >
          {part}
        </a>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function getAbsoluteImageUrl(imageUrl: string | null) {
  if (!imageUrl) {
    return defaultArticleImage;
  }

  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  return `${siteUrl}${imageUrl}`;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedNewsArticle(slug);

  if (!article) {
    return {
      title: "Η ανακοίνωση δεν βρέθηκε | KomoBasket",
      description: "Η ανακοίνωση που αναζητάτε δεν είναι διαθέσιμη.",
    };
  }

  const articleUrl = `${siteUrl}/news/${article.slug}`;
  const imageUrl = getAbsoluteImageUrl(article.coverImageUrl);

  return {
    title: `${article.title} | KomoBasket`,
    description: article.excerpt,

    alternates: {
      canonical: articleUrl,
    },

    openGraph: {
      type: "article",
      locale: "el_GR",
      url: articleUrl,
      siteName: "KomoBasket",
      title: article.title,
      description: article.excerpt,
      publishedTime: article.publishedAt ?? undefined,
      modifiedTime: article.updatedAt,
      images: [
        {
          url: imageUrl,
          alt: article.title,
        },
      ],
    },

    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.excerpt,
      images: [imageUrl],
    },
  };
}

export default async function NewsArticlePage({
  params,
}: PageProps) {
  const { slug } = await params;
  const article = await getPublishedNewsArticle(slug);

  if (!article) {
    notFound();
  }

  const paragraphs = article.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const attachments = [...article.attachments].sort(
    (first, second) => first.position - second.position,
  );

  const articleUrl = `${siteUrl}/news/${article.slug}`;
  const articleImage = getAbsoluteImageUrl(article.coverImageUrl);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "@id": `${articleUrl}#article`,

    headline: article.title,
    description: article.excerpt,

    image: [articleImage],

    datePublished:
      article.publishedAt ?? article.createdAt,

    dateModified: article.updatedAt,

    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": articleUrl,
    },

    isPartOf: {
      "@id": `${siteUrl}/#website`,
    },

    author: {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "KomoBasket",
      url: siteUrl,
    },

    publisher: {
      "@type": "SportsOrganization",
      "@id": `${siteUrl}/#organization`,
      name: "KomoBasket",
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: defaultArticleImage,
      },
    },

    articleSection: article.category,

    inLanguage: "el-GR",

    url: articleUrl,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleJsonLd).replace(
            /</g,
            "\\u003c",
          ),
        }}
      />

      <Header />

      <main className="min-h-[70vh] bg-zinc-100 py-12 sm:py-16">
        <article className="mx-auto max-w-5xl px-6">
          <Link
            href="/news"
            className="mb-7 inline-flex items-center gap-2 font-bold text-zinc-600 transition hover:text-orange-600"
          >
            <ArrowLeft size={18} />
            Όλα τα Νέα
          </Link>

          <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-lg">
            {article.coverImageUrl && (
              <div className="relative aspect-video bg-zinc-900">
                <Image
                  src={article.coverImageUrl}
                  alt={article.title}
                  fill
                  priority
                  unoptimized
                  sizes="(max-width: 1024px) 100vw, 1024px"
                  className="object-cover"
                />
              </div>
            )}

            <header className="bg-zinc-950 px-7 py-9 text-white sm:px-10 sm:py-12">
              <div className="flex flex-wrap items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-orange-400">
                <span>{article.category}</span>

                {article.season && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span>Σεζόν {article.season}</span>
                  </>
                )}
              </div>

              <h1 className="mt-4 max-w-4xl text-3xl font-black leading-tight sm:text-5xl">
                {article.title}
              </h1>

              <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-300">
                {article.excerpt}
              </p>
            </header>

            <div className="space-y-6 px-7 py-9 text-lg leading-9 text-zinc-700 sm:px-10 sm:py-12">
              {paragraphs.map((paragraph, index) => (
                <p
                  key={`${article.id}-${index}`}
                  className={
                    paragraph.includes("«Κύπελλο Στράτος Μυλωνάς»")
                      ? "border-l-4 border-orange-500 pl-5 font-bold text-zinc-900"
                      : undefined
                  }
                >
                  {renderTextWithLinks(paragraph)}
                </p>
              ))}
            </div>

            {attachments.length > 0 && (
              <section className="border-t border-zinc-200 bg-zinc-50 px-7 py-9 sm:px-10 sm:py-10">
                <div className="mb-5">
                  <p className="text-sm font-black uppercase tracking-[0.16em] text-orange-600">
                    Έγγραφα
                  </p>

                  <h2 className="mt-1 text-2xl font-black text-zinc-950">
                    Συνημμένα αρχεία
                  </h2>
                </div>

                <div className="grid gap-3">
                  {attachments.map((attachment) => {
                    const isSpreadsheet =
                      attachment.contentType.includes("excel") ||
                      attachment.contentType.includes("spreadsheet");

                    const AttachmentIcon = isSpreadsheet
                      ? FileSpreadsheet
                      : FileText;

                    return (
                      <a
                        key={attachment.id}
                        href={attachment.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 transition hover:border-orange-400 hover:shadow-md"
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                          <AttachmentIcon size={25} />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block font-black text-zinc-900 group-hover:text-orange-600">
                            {attachment.name}
                          </span>

                          <span className="mt-1 block text-sm text-zinc-500">
                            {attachment.contentType ===
                            "application/pdf"
                              ? "Προβολή PDF"
                              : "Λήψη αρχείου"}
                          </span>
                        </span>

                        <Download
                          size={22}
                          className="shrink-0 text-zinc-400 group-hover:text-orange-600"
                        />
                      </a>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </article>
      </main>
    </>
  );
}