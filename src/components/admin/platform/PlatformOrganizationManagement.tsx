"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { Building2, Pencil, Plus } from "lucide-react";

type OrganizationStatus = "active" | "suspended" | "archived";

type ManagedOrganization = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  logo_url: string | null;
  publication_status: "unpublished" | "published";
  published_at: string | null;
};

const statusLabels: Record<OrganizationStatus, string> = {
  active: "Ενεργός",
  suspended: "Σε αναστολή",
  archived: "Αρχειοθετημένος",
};

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <h2 className="text-xl font-black text-zinc-950">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1 text-sm font-black text-zinc-500 hover:bg-zinc-100">Κλείσιμο</button>
      </div>
      {children}
    </div>
  </div>;
}

async function readPayload(response: Response) {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error || "Η ενέργεια απέτυχε."));
  return payload;
}

async function uploadLogo(organizationId: string, file: File) {
  const body = new FormData();
  body.set("organizationId", organizationId);
  body.set("file", file);
  return readPayload(await fetch("/api/admin/organization-logo", { method: "POST", body }));
}

export function PlatformOrganizationManagement({ initialCreate = false }: { initialCreate?: boolean }) {
  const [organizations, setOrganizations] = useState<ManagedOrganization[]>([]);
  const [editing, setEditing] = useState<ManagedOrganization | null>(null);
  const [deleting, setDeleting] = useState<ManagedOrganization | null>(null);
  const [showCreate, setShowCreate] = useState(initialCreate);
  const [deleteToken, setDeleteToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await readPayload(await fetch("/api/admin/platform/organizations", { cache: "no-store" }));
      setOrganizations(Array.isArray(payload.organizations) ? payload.organizations as ManagedOrganization[] : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης Οργανισμών.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);

  const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("create"); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const logo = form.get("logo");
    try {
      const payload = await readPayload(await fetch("/api/admin/platform/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") }),
      }));
      const organization = payload.organization as ManagedOrganization;
      let logoFailed = false;
      if (logo instanceof File && logo.size > 0) {
        try { await uploadLogo(organization.id, logo); } catch { logoFailed = true; }
      }
      setShowCreate(false);
      await loadOrganizations();
      setNotice(logoFailed
        ? "Ο Οργανισμός δημιουργήθηκε, αλλά το λογότυπο δεν αποθηκεύτηκε. Μπορείτε να το προσθέσετε αργότερα."
        : "Ο Οργανισμός δημιουργήθηκε επιτυχώς.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η δημιουργία απέτυχε.");
    } finally { setBusy(""); }
  };

  const updateOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(`edit-${editing.id}`); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const logo = form.get("logo");
    try {
      await readPayload(await fetch("/api/admin/platform/organizations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: editing.id, name: form.get("name"), slug: form.get("slug"), status: form.get("status") }),
      }));
      let logoFailed = false;
      if (logo instanceof File && logo.size > 0) {
        try { await uploadLogo(editing.id, logo); } catch { logoFailed = true; }
      }
      setEditing(null);
      await loadOrganizations();
      setNotice(logoFailed
        ? "Οι αλλαγές αποθηκεύτηκαν, αλλά το νέο λογότυπο δεν αποθηκεύτηκε. Δοκιμάστε ξανά."
        : "Οι αλλαγές του Οργανισμού αποθηκεύτηκαν.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η ενημέρωση απέτυχε.");
    } finally { setBusy(""); }
  };

  const deleteOrganization = async () => {
    if (!deleting || deleteToken !== "ΔΙΑΓΡΑΦΗ") return;
    setBusy(`delete-${deleting.id}`); setError(""); setNotice("");
    try {
      await readPayload(await fetch("/api/admin/platform/organizations", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: deleting.id }),
      }));
      setDeleting(null); setDeleteToken("");
      await loadOrganizations();
      setNotice("Ο κενός Οργανισμός διαγράφηκε.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η διαγραφή απέτυχε.");
    } finally { setBusy(""); }
  };

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-7">
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div>
        <Link href="/admin/platform" className="text-sm font-black text-orange-700 hover:text-orange-800">← Επιλογή Οργανισμού</Link>
        <h1 className="mt-2 text-3xl font-black text-zinc-950">Διαχείριση Οργανισμών</h1>
        <p className="mt-2 text-zinc-600">Ταυτότητα, λειτουργική κατάσταση και λογότυπο κάθε Οργανισμού.</p>
      </div>
      <button type="button" onClick={() => { setShowCreate(true); setError(""); setNotice(""); }} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-3 font-black text-white hover:bg-orange-700"><Plus size={18} /> Νέος Οργανισμός</button>
    </div>

    {notice && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</div>}
    {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div>}
    {loading ? <p className="py-10 text-center text-zinc-500">Φόρτωση Οργανισμών…</p> : <div className="grid gap-5 md:grid-cols-2">
      {organizations.map((organization) => <article key={organization.id} className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-zinc-100 text-zinc-500">
            {organization.logo_url ? <Image src={organization.logo_url} alt={`Λογότυπο ${organization.name}`} width={64} height={64} className="size-16 object-contain" /> : <Building2 size={28} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-xl font-black text-zinc-950">{organization.name}</h2>
            <p className="mt-1 break-all text-sm font-bold text-zinc-500">/{organization.slug}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-black ${organization.status === "active" ? "bg-emerald-50 text-emerald-700" : organization.status === "suspended" ? "bg-amber-50 text-amber-700" : "bg-zinc-100 text-zinc-600"}`}>{statusLabels[organization.status]}</span>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-black text-zinc-600">{organization.publication_status === "published" ? "Δημοσιευμένος" : "Μη δημοσιευμένος"}</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={() => { setEditing(organization); setError(""); setNotice(""); }} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-3 font-black text-zinc-900 hover:border-orange-400 hover:text-orange-700"><Pencil size={17} /> Επεξεργασία</button>
      </article>)}
    </div>}

    {showCreate && <Modal title="Νέος Οργανισμός" onClose={() => setShowCreate(false)}>
      <form onSubmit={(event) => void createOrganization(event)} className="space-y-4">
        <label className="block text-sm font-black text-zinc-700">Όνομα Οργανισμού *<input name="name" required autoFocus className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-semibold" /></label>
        <label className="block text-sm font-black text-zinc-700">Slug *<input name="slug" required placeholder="my-league" className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-semibold" /><span className="mt-2 block text-xs font-medium leading-5 text-zinc-500">Προορίζεται για μελλοντική δημόσια διεύθυνση, π.χ. komobasket.gr/my-league. Δεν υπάρχει ακόμη δημόσια σελίδα Οργανισμού.</span></label>
        <label className="block text-sm font-black text-zinc-700">Λογότυπο (προαιρετικό)<input name="logo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="mt-2 block w-full text-sm font-semibold text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-black" /></label>
        <p className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">Ο Οργανισμός δημιουργείται ενεργός και μη δημοσιευμένος, χωρίς αυτόματες ομάδες, διοργανώσεις, χρήστες ή προσβάσεις.</p>
        <button type="submit" disabled={Boolean(busy)} className="w-full rounded-xl bg-orange-600 px-4 py-3 font-black text-white disabled:opacity-50">{busy === "create" ? "Δημιουργία…" : "Δημιουργία Οργανισμού"}</button>
      </form>
    </Modal>}

    {editing && <Modal title={`Επεξεργασία — ${editing.name}`} onClose={() => setEditing(null)}>
      <form onSubmit={(event) => void updateOrganization(event)} className="space-y-4">
        <div className="rounded-2xl bg-zinc-50 p-4 text-sm"><span className="font-black text-zinc-700">Canonical ID</span><p className="mt-1 break-all font-mono text-xs text-zinc-600">{editing.id}</p></div>
        <label className="block text-sm font-black text-zinc-700">Όνομα<input name="name" required defaultValue={editing.name} className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-semibold" /></label>
        <label className="block text-sm font-black text-zinc-700">Slug<input name="slug" required defaultValue={editing.slug} className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-semibold" /><span className="mt-2 block text-xs font-medium leading-5 text-amber-700">Μελλοντικοί δημόσιοι σύνδεσμοι μπορεί να εξαρτώνται από το slug. Δεν διατηρείται ιστορικό ανακατευθύνσεων.</span></label>
        <label className="block text-sm font-black text-zinc-700">Λειτουργική κατάσταση<select name="status" defaultValue={editing.status} className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 font-semibold"><option value="active">Ενεργός</option><option value="suspended">Σε αναστολή</option><option value="archived">Αρχειοθετημένος</option></select></label>
        <label className="block text-sm font-black text-zinc-700">Αλλαγή λογοτύπου<input name="logo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="mt-2 block w-full text-sm font-semibold text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-black" /></label>
        <button type="submit" disabled={Boolean(busy)} className="w-full rounded-xl bg-orange-600 px-4 py-3 font-black text-white disabled:opacity-50">Αποθήκευση αλλαγών</button>
        <div className="border-t border-zinc-200 pt-4">
          <p className="text-sm leading-6 text-zinc-600">Η αρχειοθέτηση είναι η ασφαλής επιλογή κύκλου ζωής. Διαγραφή επιτρέπεται μόνο όταν δεν υπάρχουν διοργανώσεις, ομάδες, παίκτες, staff ή memberships.</p>
          <button type="button" onClick={() => { setDeleting(editing); setEditing(null); setDeleteToken(""); }} className="mt-3 w-full rounded-xl border border-red-200 px-4 py-3 font-black text-red-700 hover:bg-red-50">Διαγραφή Οργανισμού</button>
        </div>
      </form>
    </Modal>}

    {deleting && <Modal title="Διαγραφή Οργανισμού" onClose={() => { setDeleting(null); setDeleteToken(""); }}>
      <div className="space-y-4">
        <p className="leading-7 text-zinc-700">Να διαγραφεί ο Οργανισμός <strong>«{deleting.name}»</strong>; Η ενέργεια επιτρέπεται μόνο εάν είναι εντελώς κενός. Δεν θα διαγραφούν ποτέ ανταγωνιστικά δεδομένα ή memberships με cascade.</p>
        <p className="rounded-2xl bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-800">Για Οργανισμό που περιέχει δεδομένα, επιλέξτε «Αρχειοθετημένος» αντί για διαγραφή.</p>
        <label className="block text-sm font-black text-zinc-700">Πληκτρολογήστε ΔΙΑΓΡΑΦΗ<input value={deleteToken} onChange={(event) => setDeleteToken(event.target.value)} className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-semibold" /></label>
        <button type="button" disabled={deleteToken !== "ΔΙΑΓΡΑΦΗ" || Boolean(busy)} onClick={() => void deleteOrganization()} className="w-full rounded-xl bg-red-600 px-4 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Οριστική διαγραφή κενού Οργανισμού</button>
      </div>
    </Modal>}
  </main>;
}
