const RECIPIENT_EMAIL = "komobasketleague@gmail.com";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_DEVELOPMENT_SECRET =
  "1x0000000000000000000000000000000AA";
const ALLOWED_TURNSTILE_HOSTNAMES = new Set([
  "komobasket.gr",
  "www.komobasket.gr",
]);

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function json(message: string, status: number) {
  return Response.json({ message }, { status });
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

function getClientAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(address: string) {
  const now = Date.now();
  const current = rateLimitStore.get(address);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(address, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

async function validateTurnstile(token: string, remoteAddress: string) {
  const secret =
    process.env.NODE_ENV === "development"
      ? TURNSTILE_DEVELOPMENT_SECRET
      : process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    console.error("Contact form is missing TURNSTILE_SECRET_KEY.");
    return { configured: false, valid: false };
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: remoteAddress === "unknown" ? undefined : remoteAddress,
        idempotency_key: crypto.randomUUID(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const result = (await response.json()) as TurnstileResult;
    const hostnameIsValid =
      process.env.NODE_ENV === "development" ||
      (typeof result.hostname === "string" &&
        ALLOWED_TURNSTILE_HOSTNAMES.has(result.hostname));

    if (
      !response.ok ||
      !result.success ||
      result.action !== "contact" ||
      !hostnameIsValid
    ) {
      console.warn("Turnstile rejected a contact form submission.", {
        status: response.status,
        hostname: result.hostname,
        action: result.action,
        errors: result["error-codes"],
      });
      return { configured: true, valid: false };
    }

    return { configured: true, valid: true };
  } catch (error) {
    console.error("Turnstile validation failed.", error);
    return { configured: true, valid: false, unavailable: true };
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 20_000) {
    return json("Το μήνυμα είναι μεγαλύτερο από το επιτρεπόμενο όριο.", 413);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return json("Τα στοιχεία της φόρμας δεν είναι έγκυρα.", 400);
  }

  if (!payload || typeof payload !== "object") {
    return json("Τα στοιχεία της φόρμας δεν είναι έγκυρα.", 400);
  }

  const data = payload as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const subject = typeof data.subject === "string" ? data.subject.trim() : "";
  const message = typeof data.message === "string" ? data.message.trim() : "";
  const website = typeof data.website === "string" ? data.website.trim() : "";
  const turnstileToken =
    typeof data.turnstileToken === "string"
      ? data.turnstileToken.trim()
      : "";

  // A filled honeypot is treated as a successful submission without sending email.
  if (website) {
    return json("Το μήνυμά σας στάλθηκε με επιτυχία.", 200);
  }

  if (
    name.length < 2 ||
    name.length > 100 ||
    !isEmail(email) ||
    email.length > 254 ||
    subject.length < 3 ||
    subject.length > 150 ||
    message.length < 10 ||
    message.length > 5_000
  ) {
    return json("Ελέγξτε ότι όλα τα πεδία είναι σωστά συμπληρωμένα.", 400);
  }

  if (isRateLimited(getClientAddress(request))) {
    return json("Έχουν γίνει πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγα λεπτά.", 429);
  }

  if (!turnstileToken || turnstileToken.length > 2_048) {
    return json("Η επαλήθευση ασφαλείας δεν ολοκληρώθηκε.", 400);
  }

  const turnstileResult = await validateTurnstile(
    turnstileToken,
    getClientAddress(request),
  );

  if (!turnstileResult.configured) {
    return json("Η υπηρεσία ασφαλείας δεν είναι ακόμη διαθέσιμη.", 503);
  }

  if (!turnstileResult.valid) {
    return json(
      turnstileResult.unavailable
        ? "Η επαλήθευση ασφαλείας δεν είναι προσωρινά διαθέσιμη. Δοκιμάστε ξανά."
        : "Η επαλήθευση ασφαλείας απέτυχε. Παρακαλώ δοκιμάστε ξανά.",
      turnstileResult.unavailable ? 503 : 400,
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.CONTACT_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    console.error("Contact email service is missing RESEND_API_KEY or CONTACT_FROM_EMAIL.");
    return json("Η υπηρεσία αποστολής δεν είναι ακόμη διαθέσιμη. Δοκιμάστε ξανά αργότερα.", 503);
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");

  try {
    const providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [RECIPIENT_EMAIL],
        reply_to: email,
        subject: `[KomoBasket] ${subject}`,
        text: `Νέο μήνυμα από τη φόρμα επικοινωνίας του KomoBasket\n\nΟνοματεπώνυμο: ${name}\nEmail: ${email}\nΘέμα: ${subject}\n\n${message}`,
        html: `
          <div style="font-family:Arial,sans-serif;color:#18181b;line-height:1.6">
            <h2 style="color:#ea580c">Νέο μήνυμα από το KomoBasket</h2>
            <p><strong>Ονοματεπώνυμο:</strong> ${safeName}</p>
            <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
            <p><strong>Θέμα:</strong> ${safeSubject}</p>
            <hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0" />
            <p>${safeMessage}</p>
          </div>
        `,
      }),
      cache: "no-store",
    });

    if (!providerResponse.ok) {
      console.error("Resend rejected a contact email request.", {
        status: providerResponse.status,
        response: await providerResponse.text(),
      });
      return json("Το μήνυμα δεν στάλθηκε. Δοκιμάστε ξανά σε λίγο.", 502);
    }

    return json("Το μήνυμά σας στάλθηκε με επιτυχία.", 200);
  } catch (error) {
    console.error("Contact email delivery failed.", error);
    return json("Το μήνυμα δεν στάλθηκε. Δοκιμάστε ξανά σε λίγο.", 502);
  }
}
