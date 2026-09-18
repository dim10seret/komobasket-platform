"use client";

import { usePlatformContext, PlatformButton, PlatformForm, PlatformFileInput } from "@/components/admin/platform/shared/platform-context";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Globe2, Upload } from "lucide-react";
import { buttonClass, inputClass } from "./shared/admin-core";

type Role = "super_admin" | "admin" | "viewer";
type PublicSettings = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  public_header_logo_url: string | null;
  public_header_link_url: string | null;
  publication_status: "unpublished" | "published";
};

async function readPayload(response: Response) {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error || "Η ενέργεια απέτυχε."));
  return payload;
}

export default function OrganizationPublicPageManagement({ organizationId, role }: { organizationId: string; role: Role }) {
  const { request: fetch, url: platformUrl } = usePlatformContext();
  const [organization, setOrganization] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const canManage = role !== "viewer";
  const canPublish = role === "super_admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await readPayload(await fetch(`/api/admin/organization-public-settings?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" }));
      setOrganization(payload.organization as PublicSettings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης δημόσιας σελίδας.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !canManage) return;
    const form = new FormData(event.currentTarget);
    const input: Record<string, unknown> = {
      organizationId,
      publicHeaderLinkUrl: form.get("publicHeaderLinkUrl"),
    };
    if (canPublish) {
      input.slug = form.get("slug");
      input.publicationStatus = form.get("publicationStatus");
    }
    setBusy(true); setError(""); setNotice("");
    try {
      await readPayload(await fetch("/api/admin/organization-public-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }));
      await load();
      setNotice("Οι ρυθμίσεις δημόσιας σελίδας αποθηκεύτηκαν.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η αποθήκευση απέτυχε.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = new FormData();
      body.set("organizationId", organizationId);
      body.set("file", file);
      await readPayload(await fetch("/api/admin/organization-public-header-logo", { method: "POST", body }));
      await load();
      setNotice("Το public header logo ενημερώθηκε.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Το upload απέτυχε.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="rounded-2xl bg-white p-8 text-center text-zinc-500">Φόρτωση δημόσιας σελίδας…</div>;
  if (!organization) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-700">{error || "Ο Οργανισμός δεν είναι διαθέσιμος."}</div>;

  return <div className="space-y-6">
    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-zinc-950 text-orange-500">
          {organization.logo_url ? <img src={organization.logo_url} alt="" className="size-14 object-contain" /> : <Globe2 size={26} />}
        </span>
        <div><p className="text-xs font-black uppercase tracking-[.2em] text-orange-600">Δημόσια Σελίδα</p><h2 className="mt-1 text-2xl font-black text-zinc-950">{organization.name}</h2><p className="mt-1 break-all font-mono text-xs text-zinc-500">{organization.id}</p></div>
      </div>
      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</p>}
      {notice && <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</p>}
      <PlatformForm onSubmit={(event) => void save(event)} className="mt-6 grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-black text-zinc-700">Slug<input name="slug" className={inputClass} defaultValue={organization.slug} readOnly={!canPublish} aria-readonly={!canPublish} />{!canPublish && <span className="text-xs font-medium text-zinc-500">Μόνο ο Super Admin μπορεί να αλλάξει το slug.</span>}</label>
        <label className="grid gap-2 text-sm font-black text-zinc-700">Κατάσταση δημοσίευσης<select name="publicationStatus" className={inputClass} defaultValue={organization.publication_status} disabled={!canPublish}><option value="unpublished">Unpublished</option><option value="published">Published</option></select>{!canPublish && <span className="text-xs font-medium text-zinc-500">Μόνο ο Super Admin μπορεί να δημοσιεύσει το microsite.</span>}</label>
        <div className="sm:col-span-2"><p className="text-sm font-black text-zinc-700">Canonical Organization logo</p><div className="mt-2 flex min-h-24 items-center rounded-2xl border border-zinc-200 bg-zinc-50 p-4">{organization.logo_url ? <img src={organization.logo_url} alt={`Canonical λογότυπο ${organization.name}`} className="max-h-16 max-w-40 object-contain" /> : <span className="text-sm text-zinc-500">Δεν έχει οριστεί canonical logo.</span>}</div><p className="mt-2 text-xs text-zinc-500">Read-only σε αυτή την ενότητα. Είναι ανεξάρτητο από το public header logo.</p></div>
        {canManage && <div className="flex flex-wrap items-center gap-3 sm:col-span-2">{organization.public_header_logo_url && <img src={organization.public_header_logo_url} alt="Τρέχον public header logo" className="h-16 max-w-48 rounded-xl border border-zinc-200 bg-zinc-50 object-contain p-2" />}<PlatformButton type="button" className="inline-flex items-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 font-black text-orange-700 hover:bg-orange-100" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={17} /> Upload header logo</PlatformButton><PlatformFileInput ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></div>}
        <label className="grid gap-2 text-sm font-black text-zinc-700 sm:col-span-2">Σύνδεσμος λογοτύπου (προαιρετικό)<input name="publicHeaderLinkUrl" type="url" className={inputClass} defaultValue={organization.public_header_link_url ?? ""} readOnly={!canManage} placeholder="https://..." /><span className="text-xs font-medium text-zinc-500">Αν συμπληρωθεί, το λογότυπο θα είναι clickable και θα ανοίγει αυτόν τον σύνδεσμο. Επιτρέπονται μόνο http και https.</span></label>
        {canManage && <PlatformButton mutation type="submit" className={`${buttonClass} sm:col-span-2`} disabled={busy}>{busy ? "Αποθήκευση…" : "Αποθήκευση δημόσιας σελίδας"}</PlatformButton>}
        {!canManage && <p className="rounded-xl bg-zinc-50 p-4 text-sm font-bold text-zinc-600 sm:col-span-2">Έχετε πρόσβαση μόνο για προβολή.</p>}
        {organization.publication_status === "published" && <a href={`/${encodeURIComponent(organization.slug)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-black text-orange-700 sm:col-span-2">Άνοιγμα δημόσιας σελίδας <ExternalLink size={15} /></a>}
      </PlatformForm>
    </section>
  </div>;
}
