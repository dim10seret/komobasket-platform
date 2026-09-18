"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OrganizationUserIdentity } from "@/types/organization-user";
import styles from "./UserPortal.module.css";
import OrganizationPlatform from "./OrganizationPlatform";

type AuthResponse = Partial<OrganizationUserIdentity> & { csrfToken?: string; error?: string };
const unavailable = "Η σύνδεση δεν είναι προσωρινά διαθέσιμη. Δοκιμάστε αργότερα.";

export default function UserPortal({ initialIdentity, organizationId }: {
  initialIdentity: OrganizationUserIdentity | null; organizationId?: string;
}) {
  const [identity, setIdentity] = useState(initialIdentity);
  const [csrf, setCsrf] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/user/auth/me", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const value: AuthResponse = await response.json();
        setCsrf(value.csrfToken ?? "");
        if (response.ok && value.user && value.memberships) setIdentity({ user: value.user, memberships: value.memberships });
        else if (response.status === 401 || response.status === 403) {
          setIdentity(null);
          if (response.status === 403) setError(value.error ?? unavailable);
        } else setError(value.error ?? unavailable);
      }).catch(() => { if (!controller.signal.aborted) setError(unavailable); });
    return () => controller.abort();
  }, []);

  async function mutate(action: "login" | "logout", body: Record<string, string>) {
    if (inFlight.current || !csrf) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/user/auth/${action}`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Kb-User-Csrf": csrf },
        body: JSON.stringify(body),
      });
      const value: AuthResponse = await response.json();
      if (!response.ok) { setError(value.error ?? unavailable); return; }
      window.location.assign("/user");
    } catch {
      setError(unavailable);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate("login", { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
  }

  const selected = organizationId ? identity?.memberships.find((item) => item.organizationId === organizationId) : null;
  if (identity && selected) return <OrganizationPlatform key={selected.organizationId} identity={identity} membership={selected} csrf={csrf} onLogout={()=>void mutate("logout", {})} logoutBusy={busy} authError={error} />;
  return <main className={styles.screen}>
    <section className={styles.panel} aria-labelledby="user-title">
      <a className={styles.brand} href="/">KomoBasket <span>Platform</span></a>
      {!identity ? <>
        <h1 id="user-title">Είσοδος Χρήστη</h1>
        <form onSubmit={login} className={styles.form}>
          <label htmlFor="user-email">Email</label>
          <input id="user-email" name="email" type="email" autoComplete="username" maxLength={320} required disabled={busy} />
          <label htmlFor="user-password">Κωδικός</label>
          <input id="user-password" name="password" type="password" autoComplete="current-password" maxLength={128} required disabled={busy} />
          <button className={styles.primary} type="submit" disabled={busy || !csrf}>{busy ? "Σύνδεση…" : "Σύνδεση"}</button>
        </form>
      </> : <>
        <h1 id="user-title">{`Καλώς ήρθατε, ${identity.user.displayName ?? identity.user.email}`}</h1>
        {organizationId ? <p role="alert">Δεν υπάρχει ενεργή πρόσβαση σε οργανισμό.</p> : <>
          <p>{identity.memberships.length > 1 ? "Επιλέξτε Οργανισμό" : "Οργανισμός"}</p>
          <div className={styles.organizations}>{identity.memberships.map((item) => <article className={styles.organization} key={item.organizationId}>
            <div className={styles.organizationName}>{item.logoUrl && <img className={styles.logo} src={item.logoUrl} alt="" />}<strong>{item.organizationName}</strong></div>
            <p className={styles.role}>Ρόλος: {item.role === "admin" ? "Διαχειριστής" : "Προβολή"}</p>
            <a className={styles.primary} href={`/user/${encodeURIComponent(item.organizationId)}`}>Είσοδος στον Οργανισμό</a>
          </article>)}</div>
        </>}
        <button className={styles.secondary} disabled={busy || !csrf} onClick={() => void mutate("logout", {})}>{busy ? "Αποσύνδεση…" : "Αποσύνδεση"}</button>
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  </main>;
}
