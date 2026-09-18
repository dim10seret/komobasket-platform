"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { buttonClass, inputClass } from "./platform/shared/admin-core";

type Status = "active" | "inactive";
type Supporter = {
  id: string;
  name: string;
  logo_url: string;
  description: string | null;
  website_url: string | null;
  display_order: number;
  status: Status;
};
type OrganizationOption = { id: string; name: string };

const KOMOBASKET_ORGANIZATION_ID = "organization_komobasket";
const initialForm = { name: "", logoUrl: "", description: "", websiteUrl: "", displayOrder: "1", status: "active" as Status };

export default function SupportersManager({ organizationId, organizationName, readOnly = false, embedded = false }: {
  organizationId?: string;
  organizationName?: string;
  readOnly?: boolean;
  embedded?: boolean;
} = {}) {
  const [supporters, setSupporters] = useState<Supporter[]>([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [organizationOptions, setOrganizationOptions] = useState<OrganizationOption[]>([{ id: KOMOBASKET_ORGANIZATION_ID, name: "KomoBasket" }]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(KOMOBASKET_ORGANIZATION_ID);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const effectiveOrganizationId = organizationId ?? selectedOrganizationId;
  const effectiveOrganizationName = organizationName ?? organizationOptions.find((organization) => organization.id === effectiveOrganizationId)?.name ?? "τον επιλεγμένο Οργανισμό";

  async function load() {
    setLoading(true);
    try {
      const query = `?organizationId=${encodeURIComponent(effectiveOrganizationId)}`;
      const response = await fetch(`/api/admin/supporters${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Αποτυχία φόρτωσης.");
      setSupporters(Array.isArray(payload.supporters) ? payload.supporters : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [effectiveOrganizationId]);
  useEffect(() => {
    if (organizationId) return;
    void fetch("/api/admin/platform/organizations", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Αποτυχία φόρτωσης Οργανισμών.");
        const organizations = Array.isArray(payload.organizations) ? payload.organizations as OrganizationOption[] : [];
        setOrganizationOptions(organizations.some((organization) => organization.id === KOMOBASKET_ORGANIZATION_ID) ? organizations : [{ id: KOMOBASKET_ORGANIZATION_ID, name: "KomoBasket" }, ...organizations]);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης Οργανισμών."));
  }, [organizationId]);

  function resetForm() {
    setEditingId(null);
    setForm(initialForm);
    setLogoFileName("");
    setLogoPreviewUrl("");
  }

  function edit(supporter: Supporter) {
    setEditingId(supporter.id);
    setForm({
      name: supporter.name,
      logoUrl: supporter.logo_url,
      description: supporter.description ?? "",
      websiteUrl: supporter.website_url ?? "",
      displayOrder: String(supporter.display_order),
      status: supporter.status,
    });
    setLogoFileName("");
    setLogoPreviewUrl("");
    setNotice("");
    setError("");
  }

  async function upload(file: File) {
    setLogoFileName(file.name);
    setLogoPreviewUrl(URL.createObjectURL(file));
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("organizationId", effectiveOrganizationId);
      const response = await fetch("/api/admin/supporters/logo", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Το upload απέτυχε.");
      setForm((current) => ({ ...current, logoUrl: String(payload.logoUrl ?? "") }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Το upload απέτυχε.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/supporters", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, id: editingId, organizationId: effectiveOrganizationId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποθήκευση απέτυχε.");
      resetForm();
      setNotice("Ο υποστηρικτής αποθηκεύτηκε.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η αποθήκευση απέτυχε.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(supporter: Supporter) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/supporters", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: supporter.id, organizationId: effectiveOrganizationId, status: supporter.status === "active" ? "inactive" : "active" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η ενημέρωση απέτυχε.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η ενημέρωση απέτυχε.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(supporter: Supporter) {
    if (!window.confirm(`Να διαγραφεί ο υποστηρικτής «${supporter.name}»;`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/supporters", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: supporter.id, organizationId: effectiveOrganizationId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η διαγραφή απέτυχε.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η διαγραφή απέτυχε.");
    } finally {
      setBusy(false);
    }
  }

  const Root = embedded ? "section" : "main";
  return <Root className={embedded ? "" : "mx-auto max-w-[1200px] px-4 py-8 sm:px-7"}>
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[.22em] text-orange-600">KomoBasket Platform · Super Admin</p>
        <h2 className="mt-2 text-3xl font-black text-zinc-950">Υποστηρικτές &amp; Συνεργάτες</h2>
        <p className="mt-2 text-zinc-600">Κεντρική διαχείριση περιεχομένου για {effectiveOrganizationName}.</p>
      </div>
      {!readOnly && <button type="button" className={buttonClass} onClick={() => { resetForm(); setNotice(""); }}>+ Νέος Υποστηρικτής</button>}
    </div>
    {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</p>}
    {notice && <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</p>}
    {!organizationId && <section className="mb-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><label className="grid max-w-md gap-2 text-sm font-black text-zinc-700">Οργανισμός<select className={inputClass} value={selectedOrganizationId} onChange={(event) => { resetForm(); setNotice(""); setError(""); setSelectedOrganizationId(event.target.value); }}>{organizationOptions.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select><span className="text-xs font-medium text-zinc-500">Η επιλογή εφαρμόζεται στη δημιουργία και στο φίλτρο υπαρχόντων υποστηρικτών.</span></label></section>}
    {!readOnly && <form onSubmit={save} className="mb-8 grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-2">
      <h3 className="text-xl font-black sm:col-span-2">{editingId ? "Επεξεργασία υποστηρικτή" : "Νέος υποστηρικτής"}</h3>
      <label className="grid gap-1 text-sm font-bold">Όνομα *<input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-bold">Λογότυπο *<input className={inputClass} value={form.logoUrl} onChange={(event) => setForm({ ...form, logoUrl: event.target.value })} required /></label>
      <div className="grid gap-2 text-sm font-bold sm:col-span-2">
        <span>Λογότυπο</span>
        <div className="flex flex-wrap items-center gap-3">
          {(logoPreviewUrl || form.logoUrl) && <img src={logoPreviewUrl || form.logoUrl} alt="Τρέχον λογότυπο" className="h-16 w-24 rounded-xl border border-zinc-200 bg-zinc-50 object-contain p-2" />}
          <button type="button" className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-2.5 font-black text-orange-700 transition hover:bg-orange-100" onClick={() => logoInputRef.current?.click()} disabled={busy}>{editingId ? "Αλλαγή λογοτύπου" : "Προσθήκη λογοτύπου"}</button>
          <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
          {logoFileName && <span className="text-sm font-semibold text-zinc-600">{logoFileName}</span>}
        </div>
        <input className="sr-only" value={form.logoUrl} readOnly required aria-label="Λογότυπο URL" tabIndex={-1} />
      </div>
      <label className="grid gap-1 text-sm font-bold sm:col-span-2">Κείμενο<textarea className={`${inputClass} min-h-28`} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label className="grid gap-1 text-sm font-bold">Ιστοσελίδα / URL<input className={inputClass} type="url" value={form.websiteUrl} onChange={(event) => setForm({ ...form, websiteUrl: event.target.value })} /></label>
      <label className="grid gap-1 text-sm font-bold">Σειρά εμφάνισης *<input className={inputClass} type="number" min="1" value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: event.target.value })} required /></label>
      <label className="grid gap-1 text-sm font-bold">Κατάσταση<select className={inputClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Status })}><option value="active">Ενεργός</option><option value="inactive">Ανενεργός</option></select></label>
      <div className="flex gap-3 sm:col-span-2"><button className={buttonClass} disabled={busy}>{editingId ? "Αποθήκευση αλλαγών" : "Δημιουργία"}</button>{editingId && <button type="button" className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black" onClick={resetForm}>Άκυρο</button>}</div>
    </form>}
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h3 className="text-xl font-black">Υπάρχοντες υποστηρικτές</h3>
      {loading ? <p className="mt-4 text-zinc-500">Φόρτωση…</p> : <div className="mt-5 grid gap-4">{supporters.map((supporter) => <article key={supporter.id} className="grid gap-4 rounded-2xl border border-zinc-200 p-4 md:grid-cols-[120px_1fr_auto]">
        <div className="flex h-24 items-center justify-center rounded-xl bg-zinc-50 p-2"><img src={supporter.logo_url} alt={`Λογότυπο ${supporter.name}`} className="max-h-full max-w-full object-contain" /></div>
        <div><h4 className="font-black text-zinc-950">{supporter.name}</h4><p className="mt-1 text-sm text-zinc-600">Σειρά {supporter.display_order} · {supporter.status === "active" ? "Ενεργός" : "Ανενεργός"}</p><p className="mt-2 line-clamp-2 text-sm text-zinc-600">{supporter.description || "—"}</p></div>
        {!readOnly && <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch"><button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-black" onClick={() => edit(supporter)}>Επεξεργασία</button><button type="button" className="rounded-lg border border-orange-300 px-3 py-2 text-sm font-black text-orange-700" onClick={() => void toggle(supporter)} disabled={busy}>{supporter.status === "active" ? "Απενεργοποίηση" : "Ενεργοποίηση"}</button><button type="button" className="rounded-lg border border-red-200 px-3 py-2 text-sm font-black text-red-700" onClick={() => void remove(supporter)} disabled={busy}>Διαγραφή</button></div>}
      </article>)}</div>}
    </section>
  </Root>;
}
