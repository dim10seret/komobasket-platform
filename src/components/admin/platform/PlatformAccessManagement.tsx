"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, UserPlus, Users } from "lucide-react";

type ManagedOrganization = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "archived";
  logo_url: string | null;
  publication_status: "unpublished" | "published";
  published_at: string | null;
};

type ManagedUser = {
  id: string;
  email: string;
  display_name: string | null;
  status: "active" | "disabled";
  is_super_admin: number;
};

type ManagedMembership = {
  id: string;
  organization_id: string;
  organization_name: string;
  user_id: string;
  role: "admin" | "viewer";
  status: "active" | "invited" | "revoked";
};

const roleLabels = { admin: "Διαχειριστής", viewer: "Προβολή" } as const;
const membershipStatusLabels = {
  active: "Ενεργή πρόσβαση",
  invited: "Σε αναμονή",
  revoked: "Ανακληθείσα",
} as const;

async function managementRequest(
  resource: "users" | "memberships",
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
) {
  const response = await fetch(`/api/admin/platform/${resource}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Η ενέργεια απέτυχε.");
  return payload;
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
      <div className="mb-6 flex items-start justify-between gap-4">
        <h3 className="text-2xl font-black text-zinc-950">{title}</h3>
        <button type="button" onClick={onClose} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-black text-zinc-600 hover:border-zinc-400">Κλείσιμο</button>
      </div>
      {children}
    </div>
  </div>;
}

export function PlatformAccessManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [memberships, setMemberships] = useState<ManagedMembership[]>([]);
  const [organizations, setOrganizations] = useState<ManagedOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [accessUser, setAccessUser] = useState<ManagedUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersResponse, membershipsResponse, organizationsResponse] = await Promise.all([
        fetch("/api/admin/platform/users", { cache: "no-store" }),
        fetch("/api/admin/platform/memberships", { cache: "no-store" }),
        fetch("/api/admin/platform/organizations", { cache: "no-store" }),
      ]);
      const [usersPayload, membershipsPayload, organizationsPayload] = await Promise.all([
        usersResponse.json(), membershipsResponse.json(), organizationsResponse.json(),
      ]);
      if (!usersResponse.ok) throw new Error(usersPayload.error || "Αποτυχία φόρτωσης χρηστών.");
      if (!membershipsResponse.ok) throw new Error(membershipsPayload.error || "Αποτυχία φόρτωσης προσβάσεων.");
      if (!organizationsResponse.ok) throw new Error(organizationsPayload.error || "Αποτυχία φόρτωσης Οργανισμών.");
      setUsers(Array.isArray(usersPayload.users) ? usersPayload.users : []);
      setMemberships(Array.isArray(membershipsPayload.memberships) ? membershipsPayload.memberships : []);
      setOrganizations(Array.isArray(organizationsPayload.organizations) ? organizationsPayload.organizations : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeOrganizations = useMemo(
    () => organizations.filter((organization) => organization.status === "active"),
    [organizations],
  );

  async function runMutation(key: string, action: () => Promise<unknown>, successMessage: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η ενέργεια απέτυχε.");
    } finally {
      setBusy("");
    }
  }

  async function uploadOrganizationLogo(organizationId: string, file: File) {
    await runMutation(`logo-${organizationId}`, async () => {
      const formData = new FormData();
      formData.set("organizationId", organizationId);
      formData.set("file", file);
      const response = await fetch("/api/admin/organization-logo", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποθήκευση λογοτύπου απέτυχε.");
    }, "Το λογότυπο ενημερώθηκε.");
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    await runMutation("create-user", async () => {
      await managementRequest("users", "POST", {
        email: String(values.email ?? "").trim(),
        displayName: String(values.displayName ?? "").trim(),
        status: "active",
      });
      setShowAddUser(false);
      form.reset();
    }, "Ο χρήστης δημιουργήθηκε χωρίς αυτόματη πρόσβαση σε Οργανισμό.");
  }

  async function createMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessUser) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await runMutation(`access-${accessUser.id}`, async () => {
      await managementRequest("memberships", "POST", {
        userId: accessUser.id,
        organizationId: String(values.organizationId ?? ""),
        role: String(values.role ?? "viewer"),
        status: "active",
      });
      setAccessUser(null);
    }, "Η πρόσβαση προστέθηκε.");
  }

  async function updateUserStatus(user: ManagedUser) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    if (nextStatus === "disabled" && !window.confirm(`Να απενεργοποιηθεί ο χρήστης ${user.email};`)) return;
    await runMutation(`user-${user.id}`, () => managementRequest("users", "PATCH", {
      userId: user.id,
      status: nextStatus,
    }), nextStatus === "active" ? "Ο χρήστης επανενεργοποιήθηκε." : "Ο χρήστης απενεργοποιήθηκε.");
  }

  async function updateMembership(
    membership: ManagedMembership,
    change: { role?: "admin" | "viewer"; status?: "active" | "revoked" },
  ) {
    if (change.status === "revoked" && !window.confirm(`Να ανακληθεί η πρόσβαση στον Οργανισμό ${membership.organization_name};`)) return;
    await runMutation(`membership-${membership.id}`, () => managementRequest("memberships", "PATCH", {
      membershipId: membership.id,
      ...change,
    }), change.role
      ? "Ο ρόλος ενημερώθηκε."
      : change.status === "active" ? "Η πρόσβαση επανενεργοποιήθηκε." : "Η πρόσβαση ανακλήθηκε.");
  }

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-7 sm:py-10">
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link href="/admin/platform" className="text-sm font-black text-orange-700 hover:text-orange-800">← Οργανισμοί</Link>
        <p className="mt-5 text-xs font-black uppercase tracking-[.22em] text-orange-600">Super Admin</p>
        <h2 className="mt-2 text-3xl font-black text-zinc-950 sm:text-4xl">Χρήστες &amp; Δικαιώματα</h2>
        <p className="mt-3 max-w-2xl leading-7 text-zinc-600">Διαχείριση χρηστών και πρόσβασης στους Οργανισμούς της πλατφόρμας.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)} className="rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-black text-zinc-800 disabled:opacity-50">Ανανέωση</button>
        <button type="button" onClick={() => setShowAddUser(true)} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-black text-white hover:bg-orange-700"><UserPlus size={18} />+ Προσθήκη χρήστη</button>
      </div>
    </div>

    {notice && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</div>}
    {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div>}
    {!loading && <section className="mb-8 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
      <h3 className="text-2xl font-black text-zinc-950">Ταυτότητα Οργανισμών</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-600">Διαχείριση λογοτύπου και προβολή της κατάστασης μελλοντικής δημόσιας παρουσίας.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {organizations.map((organization) => <article key={organization.id} className="flex items-center gap-4 rounded-2xl border border-zinc-200 p-4">
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-100 text-xs font-black text-zinc-500">
            {organization.logo_url ? <Image src={organization.logo_url} alt={`Λογότυπο ${organization.name}`} width={56} height={56} className="size-14 object-contain" /> : "LOGO"}
          </span>
          <div className="min-w-0 flex-1"><p className="truncate font-black text-zinc-950">{organization.name}</p><p className="text-xs text-zinc-500">/{organization.slug}</p><p className="mt-1 text-xs font-black text-amber-700">{organization.publication_status === "published" ? "Δημοσιευμένος" : "Μη δημοσιευμένος"}</p></div>
          <label className="cursor-pointer rounded-xl border border-zinc-300 px-3 py-2 text-xs font-black text-zinc-700 hover:border-orange-400">
            {busy === `logo-${organization.id}` ? "Μεταφόρτωση…" : "Αλλαγή λογοτύπου"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadOrganizationLogo(organization.id, file); event.currentTarget.value = ""; }} />
          </label>
        </article>)}
      </div>
      <p className="mt-4 text-xs text-zinc-500">Η δημόσια σελίδα Οργανισμού δεν ενεργοποιείται σε αυτό το στάδιο.</p>
    </section>}
    {loading ? <div className="rounded-3xl border border-zinc-200 bg-white p-8 text-center text-zinc-500">Φόρτωση χρηστών…</div> : (
      <section className="space-y-5" aria-label="Χρήστες">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-orange-500"><Users size={20} /></span>
          <div><h3 className="text-2xl font-black text-zinc-950">Χρήστες</h3><p className="text-sm text-zinc-500">{users.length} συνολικά</p></div>
        </div>
        {users.map((user) => {
          const userMemberships = memberships.filter((membership) => membership.user_id === user.id);
          const assignedOrganizations = new Set(userMemberships.map((membership) => membership.organization_id));
          const availableOrganizations = activeOrganizations.filter((organization) => !assignedOrganizations.has(organization.id));
          const isSuperAdmin = user.is_super_admin === 1;
          return <article key={user.id} className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="break-words text-xl font-black text-zinc-950">{user.display_name || "Χωρίς όνομα εμφάνισης"}</h4>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${user.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{user.status === "active" ? "Ενεργός" : "Ανενεργός"}</span>
                  {isSuperAdmin && <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">Super Admin</span>}
                </div>
                <p className="mt-2 break-all text-sm font-semibold text-zinc-600">{user.email}</p>
              </div>
              {!isSuperAdmin && <button type="button" disabled={busy === `user-${user.id}`} onClick={() => void updateUserStatus(user)} className={`rounded-xl border px-4 py-2.5 text-sm font-black disabled:opacity-50 ${user.status === "active" ? "border-red-200 text-red-700 hover:bg-red-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>{user.status === "active" ? "Απενεργοποίηση χρήστη" : "Επανενεργοποίηση χρήστη"}</button>}
            </div>

            {isSuperAdmin ? (
              <div className="mt-5 flex items-start gap-3 rounded-2xl bg-orange-50 p-4 text-orange-900">
                <ShieldCheck className="mt-0.5 shrink-0" size={20} />
                <div><p className="font-black">Καθολική πρόσβαση</p><p className="mt-1 text-sm leading-6">Ο Super Admin διαχειρίζεται όλους τους ενεργούς Οργανισμούς χωρίς ιδιότητα μέλους.</p></div>
              </div>
            ) : (
              <div className="mt-6 border-t border-zinc-100 pt-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-black text-zinc-900">Πρόσβαση σε Οργανισμούς</p>
                  <button type="button" disabled={availableOrganizations.length === 0} onClick={() => setAccessUser(user)} className="rounded-xl border border-orange-200 px-3 py-2 text-sm font-black text-orange-700 disabled:cursor-not-allowed disabled:opacity-40">+ Προσθήκη πρόσβασης</button>
                </div>
                {userMemberships.length === 0 ? <p className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-500">Δεν έχει πρόσβαση σε Οργανισμό.</p> : (
                  <div className="grid gap-3">
                    {userMemberships.map((membership) => <div key={membership.id} className="grid gap-3 rounded-2xl border border-zinc-200 p-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-center">
                      <div className="min-w-0"><p className="break-words font-black text-zinc-950">{membership.organization_name}</p><p className={`mt-1 text-sm font-bold ${membership.status === "active" ? "text-emerald-700" : "text-zinc-500"}`}>{membershipStatusLabels[membership.status]}</p></div>
                      <label className="text-xs font-black uppercase tracking-wide text-zinc-500">Ρόλος
                        <select value={membership.role} disabled={busy === `membership-${membership.id}`} onChange={(event) => void updateMembership(membership, { role: event.target.value as "admin" | "viewer" })} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm font-bold normal-case tracking-normal text-zinc-900">
                          <option value="admin">Διαχειριστής</option><option value="viewer">Προβολή</option>
                        </select>
                      </label>
                      <button type="button" disabled={busy === `membership-${membership.id}`} onClick={() => void updateMembership(membership, { status: membership.status === "active" ? "revoked" : "active" })} className={`rounded-xl border px-3 py-2.5 text-sm font-black disabled:opacity-50 ${membership.status === "active" ? "border-red-200 text-red-700" : "border-emerald-200 text-emerald-700"}`}>{membership.status === "active" ? "Ανάκληση πρόσβασης" : "Επανενεργοποίηση"}</button>
                    </div>)}
                  </div>
                )}
              </div>
            )}
          </article>;
        })}
      </section>
    )}

    {showAddUser && <Modal title="Προσθήκη χρήστη" onClose={() => setShowAddUser(false)}>
      <form onSubmit={(event) => void createUser(event)} className="space-y-4">
        <label className="block text-sm font-black text-zinc-700">Email *<input name="email" type="email" required autoFocus className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-semibold" /></label>
        <label className="block text-sm font-black text-zinc-700">Όνομα εμφάνισης (προαιρετικό)<input name="displayName" className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-semibold" /></label>
        <p className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">Ο νέος χρήστης θα είναι ενεργός, χωρίς αυτόματη πρόσβαση σε Οργανισμό.</p>
        <button type="submit" disabled={busy === "create-user"} className="w-full rounded-xl bg-orange-600 px-4 py-3 font-black text-white disabled:opacity-50">Δημιουργία χρήστη</button>
      </form>
    </Modal>}

    {accessUser && <Modal title="Προσθήκη πρόσβασης" onClose={() => setAccessUser(null)}>
      <form onSubmit={(event) => void createMembership(event)} className="space-y-4">
        <div className="rounded-2xl bg-zinc-50 p-4"><p className="font-black text-zinc-950">{accessUser.display_name || accessUser.email}</p><p className="mt-1 break-all text-sm text-zinc-600">{accessUser.email}</p></div>
        <label className="block text-sm font-black text-zinc-700">Οργανισμός<select name="organizationId" required className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 font-semibold"><option value="">Επιλέξτε Οργανισμό</option>{activeOrganizations.filter((organization) => !memberships.some((membership) => membership.user_id === accessUser.id && membership.organization_id === organization.id)).map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
        <label className="block text-sm font-black text-zinc-700">Ρόλος<select name="role" defaultValue="viewer" className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 font-semibold"><option value="admin">Διαχειριστής</option><option value="viewer">Προβολή</option></select></label>
        <button type="submit" disabled={busy === `access-${accessUser.id}`} className="w-full rounded-xl bg-orange-600 px-4 py-3 font-black text-white disabled:opacity-50">Προσθήκη πρόσβασης</button>
      </form>
    </Modal>}
  </main>;
}
