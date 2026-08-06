import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Newspaper } from "lucide-react";
import Header from "@/components/layout/Header";
import { listPublishedNewsArticles } from "@/services/news.service";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const articles = await listPublishedNewsArticles();

  return (
    <>
      <Header />

      <main className="min-h-[70vh] bg-zinc-100 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-10">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">
              KomoBasket · Ενημέρωση
            </p>
            <h1 className="mt-3 text-5xl font-black text-zinc-900">Νέα</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-600">
              Ανακοινώσεις, νέα των διοργανώσεων και όλες οι ιστορίες του
              KomoBasket.
            </p>
          </div>

          {articles.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-300 bg-white px-8 py-20 text-center">
              <Newspaper className="mx-auto text-orange-500" size={44} />
              <h2 className="mt-5 text-2xl font-black text-zinc-900">
                Δεν υπάρχουν ακόμη ανακοινώσεις
              </h2>
              <p className="mt-2 text-zinc-600">
                Οι νέες δημοσιεύσεις του KomoBasket θα εμφανίζονται εδώ.
              </p>
            </div>
          ) : (
            <div className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">
              {articles.map((article, index) => (
                <article
                  key={article.id}
                  className={`group overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl ${
                    index === 0 ? "md:col-span-2 xl:col-span-2" : ""
                  }`}
                >
                  {article.coverImageUrl ? (
                    <div
                      className={`relative overflow-hidden bg-zinc-900 ${
                        index === 0 ? "aspect-[16/7]" : "aspect-[16/9]"
                      }`}
                    >
                      <Image
                        src={article.coverImageUrl}
                        alt=""
                        fill
                        sizes={
                          index === 0
                            ? "(max-width: 768px) 100vw, 66vw"
                            : "(max-width: 768px) 100vw, 33vw"
                        }
                        className="object-cover transition duration-500 group-hover:scale-105"
                      />
                    </div>
                  ) : (
                    <div
                      className={`relative overflow-hidden bg-zinc-950 ${
                        index === 0 ? "min-h-48" : "min-h-40"
                      }`}
                    >
                      <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full border-[28px] border-orange-600/30" />
                      <div className="absolute bottom-6 left-7 text-sm font-black uppercase tracking-[0.2em] text-orange-500">
                        KomoBasket
                      </div>
                    </div>
                  )}

                  <div className="p-7 sm:p-8">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-orange-600">
                      <span>{article.category}</span>
                      {article.season && (
                        <>
                          <span className="text-zinc-300">·</span>
                          <span>Σεζόν {article.season}</span>
                        </>
                      )}
                    </div>
                    <h2
                      className={`mt-4 font-black leading-tight text-zinc-950 ${
                        index === 0 ? "text-3xl sm:text-4xl" : "text-2xl"
                      }`}
                    >
                      {article.title}
                    </h2>
                    <p className="mt-4 line-clamp-3 text-base leading-7 text-zinc-600">
                      {article.excerpt}
                    </p>
                    <Link
                      href={`/news/${article.slug}`}
                      className="mt-6 inline-flex items-center gap-2 font-black text-zinc-900 transition group-hover:text-orange-600"
                    >
                      Διαβάστε περισσότερα
                      <ArrowRight size={18} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
