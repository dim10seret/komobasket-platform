"use client";

import Script from "next/script";
import { FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

const TURNSTILE_SITE_KEY =
  process.env.NODE_ENV === "development"
    ? "1x00000000000000000000AA"
    : process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type TurnstileOptions = {
  sitekey: string;
  action: string;
  theme: "light";
  size: "flexible";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export default function ContactContent({ hero, hostedOrganizationName }: { hero?: ReactNode; hostedOrganizationName?: string }) {
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [isTurnstileLoaded, setIsTurnstileLoaded] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  const renderTurnstile = useCallback(() => {
    if (
      !TURNSTILE_SITE_KEY ||
      !turnstileContainerRef.current ||
      !window.turnstile ||
      turnstileWidgetIdRef.current
    ) {
      return;
    }

    try {
      turnstileWidgetIdRef.current = window.turnstile.render(
        turnstileContainerRef.current,
        {
          sitekey: TURNSTILE_SITE_KEY,
          action: "contact",
          theme: "light",
          size: "flexible",
          callback: (token) => {
            setTurnstileToken(token);
            setTurnstileError("");
          },
          "expired-callback": () => {
            setTurnstileToken("");
            setTurnstileError("Η επαλήθευση έληξε. Παρακαλώ δοκιμάστε ξανά.");
          },
          "error-callback": () => {
            setTurnstileToken("");
            setTurnstileError("Η επαλήθευση δεν ολοκληρώθηκε. Παρακαλώ δοκιμάστε ξανά.");
          },
        },
      );
      setIsTurnstileLoaded(true);
    } catch {
      setTurnstileError("Η προστασία της φόρμας δεν φορτώθηκε σωστά. Ανανεώστε τη σελίδα.");
    }
  }, []);

  const resetTurnstile = useCallback(() => {
    setTurnstileToken("");
    if (turnstileWidgetIdRef.current && window.turnstile) {
      window.turnstile.reset(turnstileWidgetIdRef.current);
    }
  }, []);

  useEffect(() => {
    const retryInterval = window.setInterval(() => {
      if (window.turnstile) {
        setIsTurnstileLoaded(true);
        renderTurnstile();
      }
    }, 300);

    const loadingTimeout = window.setTimeout(() => {
      if (!window.turnstile) {
        setTurnstileError(
          "Η επαλήθευση ασφαλείας δεν φορτώθηκε. Ελέγξτε μήπως την εμποδίζει κάποια προστασία του browser και ανανεώστε τη σελίδα.",
        );
      }
    }, 8_000);

    return () => {
      window.clearInterval(retryInterval);
      window.clearTimeout(loadingTimeout);
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [renderTurnstile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!turnstileToken) {
      setIsError(true);
      setStatus("Παρακαλώ ολοκληρώστε πρώτα την επαλήθευση ασφαλείας.");
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    const website = String(form.get("website") ?? "").trim();

    setStatus("");
    setIsError(false);
    setIsSending(true);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          subject,
          message,
          website,
          turnstileToken,
        }),
      });
      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(result.message || "Το μήνυμα δεν στάλθηκε. Δοκιμάστε ξανά.");
      }

      formElement.reset();
      setStatus(result.message || "Το μήνυμά σας στάλθηκε με επιτυχία.");
    } catch (error) {
      setIsError(true);
      setStatus(error instanceof Error ? error.message : "Το μήνυμα δεν στάλθηκε. Δοκιμάστε ξανά.");
    } finally {
      setIsSending(false);
      resetTurnstile();
    }
  }

  return (
    <>
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => {
          setIsTurnstileLoaded(true);
          renderTurnstile();
        }}
        onError={() => {
          setTurnstileToken("");
          setTurnstileError(
            "Η προστασία της φόρμας δεν φορτώθηκε. Ελέγξτε μήπως την εμποδίζει κάποια προστασία του browser και ανανεώστε τη σελίδα.",
          );
        }}
      />
      <main className="bg-zinc-100 pb-20">
        {hero ?? <section className="bg-zinc-950 py-20 text-white">
          <div className="mx-auto max-w-7xl px-6 text-center">
            <p className="font-bold uppercase tracking-[0.2em] text-orange-500">KomoBasket</p>
            <h1 className="mt-4 text-5xl font-black">Επικοινωνία</h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
              Για πληροφορίες, υποστήριξη ή συνεργασία, συμπληρώστε τη φόρμα παρακάτω.
            </p>
          </div>
        </section>}

        <section className="mx-auto max-w-3xl px-6 py-16">
          <div role="note" className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 text-zinc-800 shadow-sm">
            <p className="font-bold">{hostedOrganizationName ? "Επικοινωνία με το KomoBasket Platform" : "Επικοινωνήστε μαζί μας"}</p>
            <p className="mt-1 text-sm leading-6">
              {hostedOrganizationName
                ? "Για θέματα υποστήριξης, φιλοξενίας διοργανώσεων ή γενική επικοινωνία με το KomoBasket Platform, συμπληρώστε τη φόρμα παρακάτω."
                : "Συμπληρώστε τη φόρμα και η ομάδα μας θα επικοινωνήσει μαζί σας το συντομότερο δυνατό."}
            </p>
            {hostedOrganizationName && (
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-700">
                {`Το μήνυμά σας θα σταλεί στην κεντρική ομάδα του KomoBasket Platform και όχι απευθείας στον οργανισμό ${hostedOrganizationName}.`}
              </p>
            )}
          </div>
          <form onSubmit={handleSubmit} className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-lg md:p-10">
            <div className="absolute -left-[10000px]" aria-hidden="true">
              <label htmlFor="website">Ιστοσελίδα</label>
              <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label htmlFor="name" className="mb-2 block font-bold text-zinc-800">Ονοματεπώνυμο</label>
                <input id="name" name="name" type="text" required autoComplete="name" className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100" />
              </div>
              <div>
                <label htmlFor="email" className="mb-2 block font-bold text-zinc-800">Email</label>
                <input id="email" name="email" type="email" required autoComplete="email" className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100" />
              </div>
            </div>

            <div className="mt-6">
              <label htmlFor="subject" className="mb-2 block font-bold text-zinc-800">Θέμα</label>
              <input id="subject" name="subject" type="text" required className="w-full rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100" />
            </div>

            <div className="mt-6">
              <label htmlFor="message" className="mb-2 block font-bold text-zinc-800">Μήνυμα</label>
              <textarea id="message" name="message" required rows={7} className="w-full resize-y rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100" />
            </div>

            <div className="mt-7">
              <div ref={turnstileContainerRef} className="mx-auto min-h-[65px] w-full max-w-[420px]" />
              {!TURNSTILE_SITE_KEY && (
                <p role="alert" className="mt-3 text-center text-sm font-semibold text-red-700">
                  Η προστασία της φόρμας δεν έχει ρυθμιστεί ακόμη.
                </p>
              )}
              {turnstileError && (
                <p role="alert" className="mt-3 text-center text-sm font-semibold text-red-700">
                  {turnstileError}
                </p>
              )}
              {!turnstileError && !turnstileToken && (
                <p className="mt-3 text-center text-sm text-zinc-500">
                  {isTurnstileLoaded
                    ? "Περιμένετε να ολοκληρωθεί η επαλήθευση ασφαλείας."
                    : "Φόρτωση επαλήθευσης ασφαλείας…"}
                </p>
              )}
              {turnstileToken && (
                <p className="mt-3 text-center text-sm font-semibold text-green-700">
                  Η επαλήθευση ασφαλείας ολοκληρώθηκε.
                </p>
              )}
            </div>

            <button type="submit" disabled={isSending} className="mt-7 w-full rounded-xl bg-orange-600 px-6 py-4 text-lg font-bold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-400">
              {isSending ? "Αποστολή..." : "Αποστολή μηνύματος"}
            </button>

            {status && (
              <p role={isError ? "alert" : "status"} className={`mt-4 rounded-xl px-4 py-3 text-center text-sm font-semibold ${isError ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
                {status}
              </p>
            )}
          </form>
        </section>
      </main>
    </>
  );
}
