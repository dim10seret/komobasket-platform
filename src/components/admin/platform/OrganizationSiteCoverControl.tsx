"use client";

import { useId, useRef, useState } from "react";
import { usePlatformContext } from "./shared/platform-context";

type Props = {
  organizationId: string;
  siteCoverUrl: string | null;
  canManage?: boolean;
  disabled?: boolean;
  onChange: (url: string | null) => void;
};

export default function OrganizationSiteCoverControl({ organizationId, siteCoverUrl, canManage = true, disabled = false, onChange }: Props) {
  const platform = usePlatformContext();
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = canManage && platform.canManage;

  async function save(file?: File) {
    if (!editable || disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("organizationId", organizationId);
      if (file) form.set("file", file);
      const response = await platform.request("/api/admin/organization-site-cover", file
        ? { method: "POST", body: form }
        : { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Η ενημέρωση Site cover απέτυχε.");
      if (result.siteCoverUrl !== null && typeof result.siteCoverUrl !== "string") throw new Error("Μη έγκυρη απάντηση Site cover.");
      onChange(result.siteCoverUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Η ενημέρωση Site cover απέτυχε.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      pending.current = false;
      setBusy(false);
    }
  }

  return <section className="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-4 sm:col-span-2" aria-label="Site cover">
    <label htmlFor={editable ? inputId : undefined} className="block text-sm font-bold">Site cover</label>
    <p className="text-sm text-zinc-600">Προαιρετικό. Αν δεν οριστεί εικόνα, θα χρησιμοποιηθεί η προεπιλεγμένη εικόνα εξωφύλλου.</p>
    {siteCoverUrl
      ? <img src={siteCoverUrl} alt="Προεπισκόπηση Site cover" className="h-36 w-full rounded-lg object-cover object-center" />
      : <p className="text-sm font-semibold text-zinc-600">Χρησιμοποιείται η προεπιλεγμένη εικόνα</p>}
    {editable && <div className="flex min-w-0 flex-wrap items-center gap-3">
      <input id={inputId} ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={disabled || busy}
        className="w-full min-w-0 text-sm" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void save(file); }} />
      <p className="text-xs text-zinc-500">JPG, PNG, WEBP ή AVIF έως 5MB. Η εικόνα αποθηκεύεται με την επιλογή της.</p>
      {siteCoverUrl && <button type="button" disabled={disabled || busy} onClick={() => void save()}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-bold disabled:opacity-50">Αφαίρεση Site cover</button>}
    </div>}
    {busy && <p role="status" className="text-sm">Αποθήκευση Site cover...</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
