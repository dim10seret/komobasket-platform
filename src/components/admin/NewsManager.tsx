"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  FilePenLine,
  FileText,
  ImagePlus,
  LoaderCircle,
  Paperclip,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createNewsSlug } from "@/lib/news-slug";
import type {
  NewsArticle,
  NewsAttachment,
  NewsStatus,
} from "@/types/news";

type FormState = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  season: string;
  category: string;
  status: NewsStatus;
};

const emptyForm: FormState = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  season: "",
  category: "Ανακοίνωση",
  status: "draft",
};

type PendingAttachment = {
  id: string;
  file: File;
  name: string;
};

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export default function NewsManager() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadArticles = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/news", { cache: "no-store" });
      const data = (await response.json()) as {
        articles?: NewsArticle[];
        error?: string;
      };

      if (!response.ok) throw new Error(data.error || "Αποτυχία φόρτωσης.");
      setArticles(data.articles ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Δεν ήταν δυνατή η φόρτωση των ανακοινώσεων.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // The initial request intentionally synchronizes this client-only manager
    // with the server-side news store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadArticles();
  }, [loadArticles]);

  function startNewArticle() {
    setEditingId(null);
    setForm(emptyForm);
    setImage(null);
    setPendingAttachments([]);
    setSlugTouched(false);
    setMessage("");
    setError("");
  }

  function editArticle(article: NewsArticle) {
    setEditingId(article.id);
    setForm({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      content: article.content,
      season: article.season ?? "",
      category: article.category,
      status: article.status,
    });
    setImage(null);
    setPendingAttachments([]);
    setSlugTouched(true);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");
    setError("");

    try {
      const endpoint = editingId ? `/api/admin/news/${editingId}` : "/api/admin/news";
      const response = await fetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as {
        article?: NewsArticle;
        error?: string;
      };

      if (!response.ok || !data.article) {
        throw new Error(data.error || "Η ανακοίνωση δεν αποθηκεύτηκε.");
      }

      let savedArticle = data.article;
      if (image) {
        const imageData = new FormData();
        imageData.append("image", image);
        const imageResponse = await fetch(
          `/api/admin/news/${savedArticle.id}/image`,
          { method: "POST", body: imageData },
        );
        const imageResult = (await imageResponse.json()) as {
          article?: NewsArticle;
          error?: string;
        };

        if (!imageResponse.ok || !imageResult.article) {
          throw new Error(
            imageResult.error ||
              "Η ανακοίνωση αποθηκεύτηκε, αλλά η εικόνα δεν ανέβηκε.",
          );
        }
        savedArticle = imageResult.article;
      }

      for (const pending of pendingAttachments) {
        const attachmentData = new FormData();
        attachmentData.append("file", pending.file);
        attachmentData.append("name", pending.name);
        const attachmentResponse = await fetch(
          `/api/admin/news/${savedArticle.id}/attachments`,
          { method: "POST", body: attachmentData },
        );
        const attachmentResult = (await attachmentResponse.json()) as {
          attachment?: NewsAttachment;
          error?: string;
        };
        if (!attachmentResponse.ok || !attachmentResult.attachment) {
          throw new Error(
            attachmentResult.error ||
              "Η ανακοίνωση αποθηκεύτηκε, αλλά ένα συνημμένο δεν ανέβηκε.",
          );
        }
      }

      setEditingId(savedArticle.id);
      setImage(null);
      setPendingAttachments([]);
      setMessage(
        savedArticle.status === "published"
          ? "Η ανακοίνωση δημοσιεύτηκε και εμφανίζεται στα Νέα."
          : "Το πρόχειρο αποθηκεύτηκε.",
      );
      await loadArticles();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Η ανακοίνωση δεν αποθηκεύτηκε.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function addPendingAttachments(files: FileList | null) {
    if (!files) return;

    const selected = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name.replace(/\.[^.]+$/, ""),
    }));
    const currentCount =
      articles.find((article) => article.id === editingId)?.attachments.length ??
      0;

    if (currentCount + pendingAttachments.length + selected.length > 10) {
      setError("Κάθε ανακοίνωση μπορεί να έχει έως 10 συνημμένα.");
      return;
    }

    setError("");
    setPendingAttachments((current) => [...current, ...selected]);
  }

  async function renameAttachment(attachment: NewsAttachment) {
    const name = window.prompt(
      "Όνομα που θα εμφανίζεται στη δημοσίευση:",
      attachment.name,
    )?.trim();
    if (!name || name === attachment.name) return;

    const response = await fetch(
      `/api/admin/news/${attachment.articleId}/attachments/${attachment.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error || "Η μετονομασία απέτυχε.");
      return;
    }
    setMessage("Το όνομα του συνημμένου ενημερώθηκε.");
    await loadArticles();
  }

  async function moveAttachment(
    attachment: NewsAttachment,
    direction: -1 | 1,
  ) {
    const article = articles.find((candidate) => candidate.id === attachment.articleId);
    if (!article) return;
    const sorted = [...article.attachments].sort(
      (first, second) => first.position - second.position,
    );
    const currentIndex = sorted.findIndex((item) => item.id === attachment.id);
    const target = sorted[currentIndex + direction];
    if (!target) return;

    const updates = [
      [attachment, target.position],
      [target, attachment.position],
    ] as const;
    await Promise.all(
      updates.map(([item, position]) =>
        fetch(
          `/api/admin/news/${item.articleId}/attachments/${item.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position }),
          },
        ),
      ),
    );
    await loadArticles();
  }

  async function removeAttachment(attachment: NewsAttachment) {
    if (
      !window.confirm(`Να διαγραφεί το συνημμένο «${attachment.name}»;`)
    ) {
      return;
    }

    const response = await fetch(
      `/api/admin/news/${attachment.articleId}/attachments/${attachment.id}`,
      { method: "DELETE" },
    );
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error || "Το συνημμένο δεν διαγράφηκε.");
      return;
    }
    setMessage("Το συνημμένο διαγράφηκε.");
    await loadArticles();
  }

  const editingArticle = articles.find((article) => article.id === editingId);

  async function removeArticle(article: NewsArticle) {
    const confirmed = window.confirm(
      `Να διαγραφεί οριστικά η ανακοίνωση «${article.title}»;`,
    );
    if (!confirmed) return;

    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/news/${article.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Η διαγραφή απέτυχε.");

      if (editingId === article.id) startNewArticle();
      setMessage("Η ανακοίνωση διαγράφηκε.");
      await loadArticles();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Η ανακοίνωση δεν διαγράφηκε.",
      );
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
      <form
        onSubmit={submitArticle}
        className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-orange-600">
              {editingId ? "Επεξεργασία" : "Νέα ανακοίνωση"}
            </p>
            <h2 className="mt-2 text-3xl font-black text-zinc-950">
              {editingId ? "Ενημέρωση ανακοίνωσης" : "Δημιουργία ανακοίνωσης"}
            </h2>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={startNewArticle}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 font-bold text-zinc-700 transition hover:border-orange-500 hover:text-orange-600"
            >
              <Plus size={18} />
              Νέα
            </button>
          )}
        </div>

        <div className="grid gap-6">
          <label className="grid gap-2 font-bold text-zinc-800">
            Τίτλος
            <input
              required
              value={form.title}
              onChange={(event) => {
                const title = event.target.value;
                setForm((current) => ({
                  ...current,
                  title,
                  slug: slugTouched ? current.slug : createNewsSlug(title),
                }));
              }}
              className="rounded-xl border border-zinc-300 px-4 py-3 font-normal outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              placeholder="π.χ. Ξεκινά η νέα σεζόν του KomoBasket League"
            />
          </label>

          <div className="grid gap-6 md:grid-cols-2">
            <label className="grid gap-2 font-bold text-zinc-800">
              Σεζόν
              <input
                value={form.season}
                onChange={(event) =>
                  setForm((current) => ({ ...current, season: event.target.value }))
                }
                className="rounded-xl border border-zinc-300 px-4 py-3 font-normal outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                placeholder="2026-27"
              />
            </label>

            <label className="grid gap-2 font-bold text-zinc-800">
              Κατηγορία
              <input
                required
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                className="rounded-xl border border-zinc-300 px-4 py-3 font-normal outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                placeholder="Ανακοίνωση"
              />
            </label>
          </div>

          <label className="grid gap-2 font-bold text-zinc-800">
            Σύντομη περιγραφή
            <textarea
              required
              rows={3}
              value={form.excerpt}
              onChange={(event) =>
                setForm((current) => ({ ...current, excerpt: event.target.value }))
              }
              className="resize-y rounded-xl border border-zinc-300 px-4 py-3 font-normal leading-7 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              placeholder="Το κείμενο που θα φαίνεται στην κάρτα της ανακοίνωσης."
            />
          </label>

          <label className="grid gap-2 font-bold text-zinc-800">
            Κυρίως κείμενο
            <textarea
              required
              rows={12}
              value={form.content}
              onChange={(event) =>
                setForm((current) => ({ ...current, content: event.target.value }))
              }
              className="resize-y rounded-xl border border-zinc-300 px-4 py-3 font-normal leading-8 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              placeholder={"Γράψε το κείμενο της ανακοίνωσης.\n\nΆφησε μία κενή γραμμή για νέα παράγραφο."}
            />
          </label>

          <label className="grid gap-2 font-bold text-zinc-800">
            Σύνδεσμος ανακοίνωσης
            <div className="flex overflow-hidden rounded-xl border border-zinc-300 focus-within:border-orange-500 focus-within:ring-4 focus-within:ring-orange-100">
              <span className="hidden items-center bg-zinc-100 px-4 text-sm font-semibold text-zinc-500 sm:flex">
                /news/
              </span>
              <input
                required
                value={form.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setForm((current) => ({
                    ...current,
                    slug: createNewsSlug(event.target.value),
                  }));
                }}
                className="min-w-0 flex-1 px-4 py-3 font-normal outline-none"
              />
            </div>
          </label>

          <div className="grid gap-6 md:grid-cols-2">
            <label className="grid gap-2 font-bold text-zinc-800">
              Κατάσταση
              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as NewsStatus,
                  }))
                }
                className="rounded-xl border border-zinc-300 bg-white px-4 py-3 font-normal outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              >
                <option value="draft">Πρόχειρο — δεν φαίνεται στο site</option>
                <option value="published">Δημοσιευμένο — εμφανίζεται στα Νέα</option>
              </select>
            </label>

            <label className="grid gap-2 font-bold text-zinc-800">
              Κεντρική εικόνα (προαιρετική)
              <span className="relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-400 px-4 py-3 font-normal text-zinc-600 transition hover:border-orange-500 hover:text-orange-600">
                <ImagePlus size={20} />
                <span className="truncate">
                  {image?.name || "Επιλογή εικόνας έως 5 MB"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => setImage(event.target.files?.[0] ?? null)}
                />
              </span>
            </label>
          </div>

          <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-black text-zinc-900">
                  <Paperclip size={20} className="text-orange-600" />
                  Συνημμένα αρχεία
                </h3>
                <p className="mt-1 text-sm font-normal leading-6 text-zinc-500">
                  PDF, Word ή Excel, έως 15 MB το καθένα και έως 10 αρχεία.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-orange-600">
                <Plus size={17} />
                Προσθήκη αρχείων
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    addPendingAttachments(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>

            {editingArticle?.attachments.length ? (
              <div className="mt-5 grid gap-3">
                {[...editingArticle.attachments]
                  .sort((first, second) => first.position - second.position)
                  .map((attachment, index, sorted) => (
                    <div
                      key={attachment.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3"
                    >
                      <FileText size={22} className="shrink-0 text-orange-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-zinc-900">
                          {attachment.name}
                        </p>
                        <p className="text-xs font-normal text-zinc-500">
                          {attachment.originalName} · {formatFileSize(attachment.size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => void moveAttachment(attachment, -1)}
                          className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-25"
                          aria-label="Μετακίνηση πάνω"
                        >
                          <ArrowUp size={17} />
                        </button>
                        <button
                          type="button"
                          disabled={index === sorted.length - 1}
                          onClick={() => void moveAttachment(attachment, 1)}
                          className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-25"
                          aria-label="Μετακίνηση κάτω"
                        >
                          <ArrowDown size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void renameAttachment(attachment)}
                          className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-orange-600"
                          aria-label="Μετονομασία"
                        >
                          <FilePenLine size={17} />
                        </button>
                        <a
                          href={`/api/admin/news/${attachment.articleId}/attachments/${attachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-orange-600"
                          aria-label="Άνοιγμα αρχείου"
                        >
                          <Download size={17} />
                        </a>
                        <button
                          type="button"
                          onClick={() => void removeAttachment(attachment)}
                          className="rounded-lg p-2 text-red-500 transition hover:bg-red-50"
                          aria-label="Διαγραφή συνημμένου"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}

            {pendingAttachments.length ? (
              <div className="mt-5 grid gap-3">
                <p className="text-sm font-black uppercase tracking-wide text-orange-600">
                  Θα ανέβουν με την αποθήκευση
                </p>
                {pendingAttachments.map((pending) => (
                  <div
                    key={pending.id}
                    className="grid gap-3 rounded-xl border border-dashed border-orange-300 bg-orange-50 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                  >
                    <FileText size={22} className="text-orange-600" />
                    <label className="grid min-w-0 gap-1 text-xs font-bold text-zinc-600">
                      Εμφανιζόμενο όνομα
                      <input
                        value={pending.name}
                        onChange={(event) =>
                          setPendingAttachments((current) =>
                            current.map((item) =>
                              item.id === pending.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          )
                        }
                        className="min-w-0 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-normal text-zinc-900 outline-none focus:border-orange-500"
                      />
                      <span className="truncate font-normal text-zinc-500">
                        {pending.file.name} · {formatFileSize(pending.file.size)}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((current) =>
                          current.filter((item) => item.id !== pending.id),
                        )
                      }
                      className="justify-self-start rounded-lg p-2 text-red-500 transition hover:bg-red-100 sm:justify-self-end"
                      aria-label="Αφαίρεση από τη λίστα"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {!editingArticle?.attachments.length &&
              !pendingAttachments.length && (
                <div className="mt-5 rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm font-normal text-zinc-500">
                  Δεν έχουν προστεθεί συνημμένα.
                </div>
              )}
          </section>
        </div>

        {(message || error) && (
          <div
            className={`mt-6 rounded-xl px-4 py-3 font-semibold ${
              error
                ? "border border-red-200 bg-red-50 text-red-700"
                : "border border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
            role="status"
          >
            {error || message}
          </div>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 py-4 text-lg font-black text-white transition hover:bg-orange-700 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        >
          {isSaving ? (
            <LoaderCircle className="animate-spin" size={21} />
          ) : (
            <Save size={21} />
          )}
          {editingId ? "Αποθήκευση αλλαγών" : "Αποθήκευση ανακοίνωσης"}
        </button>
      </form>

      <aside className="self-start rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm xl:sticky xl:top-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-orange-600">
              Αρχείο
            </p>
            <h2 className="mt-1 text-2xl font-black text-zinc-950">
              Ανακοινώσεις
            </h2>
          </div>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-bold text-zinc-600">
            {articles.length}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <LoaderCircle className="animate-spin" size={28} />
          </div>
        ) : articles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 px-5 py-10 text-center text-zinc-500">
            Δεν υπάρχουν ακόμη νέες ανακοινώσεις.
          </div>
        ) : (
          <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
            {articles.map((article) => (
              <article
                key={article.id}
                className={`rounded-2xl border p-4 transition ${
                  editingId === article.id
                    ? "border-orange-400 bg-orange-50"
                    : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black uppercase tracking-wide ${
                        article.status === "published"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {article.status === "published" ? "Δημοσιευμένο" : "Πρόχειρο"}
                    </span>
                    <h3 className="mt-3 line-clamp-2 font-black leading-6 text-zinc-900">
                      {article.title}
                    </h3>
                    <p className="mt-2 text-sm text-zinc-500">
                      {article.season ? `Σεζόν ${article.season} · ` : ""}
                      {new Intl.DateTimeFormat("el-GR", {
                        dateStyle: "medium",
                      }).format(new Date(article.updatedAt))}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => editArticle(article)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-bold text-white transition hover:bg-orange-600"
                  >
                    <FilePenLine size={15} />
                    Επεξεργασία
                  </button>
                  {article.status === "published" && (
                    <Link
                      href={`/news/${article.slug}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-bold text-zinc-700 transition hover:border-orange-500 hover:text-orange-600"
                    >
                      <ExternalLink size={15} />
                      Προβολή
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeArticle(article)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50"
                    aria-label={`Διαγραφή: ${article.title}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
