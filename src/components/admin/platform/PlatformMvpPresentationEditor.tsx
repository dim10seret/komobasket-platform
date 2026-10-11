"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { PlatformButton, usePlatformContext } from "./shared/platform-context";

type Candidate = { player_id: string; player_name: string; team_name: string;
  points: number; rebounds: number; assists: number; efficiency: number };
type Contest = { id: string; competition_name: string; phase_name: string; winner_player_id: string | null;
  candidates: Candidate[]; photoUrl: string | null; photo_caption: string | null; body_text: string | null;
  sponsor_name: string | null; gift_description: string | null; presentationRevision: string };

const field = "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950";
const action = "rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50";

export default function PlatformMvpPresentationEditor({ contest, organizationId, scopeLabel, canManage, onSaved }: {
  contest: Contest; organizationId: string; scopeLabel: string; canManage: boolean; onSaved: () => Promise<boolean>;
}) {
  const api = usePlatformContext();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [caption, setCaption] = useState(contest.photo_caption ?? "");
  const [body, setBody] = useState(contest.body_text ?? "");
  const [sponsor, setSponsor] = useState(contest.sponsor_name ?? "");
  const [gift, setGift] = useState(contest.gift_description ?? "");
  const winner = contest.candidates.find((candidate) => candidate.player_id === contest.winner_player_id);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving || conflict) return;
    setSaving(true); setError(""); setNotice("");
    try {
      if (photo && photo.size > 5 * 1024 * 1024) throw new Error("Η φωτογραφία πρέπει να είναι έως 5 MB.");
      const form = new FormData();
      form.set("organizationId", organizationId); form.set("contestId", contest.id);
      form.set("presentationRevision", contest.presentationRevision);
      form.set("photoCaption", caption); form.set("bodyText", body);
      form.set("sponsorName", sponsor); form.set("giftDescription", gift);
      if (photo) form.set("photo", photo);
      if (removePhoto) form.set("removePhoto", "true");
      const response = await api.request("/api/admin/mvp", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (result.error === "PRESENTATION_CONFLICT") {
          setConflict(true);
          throw new Error("Η παρουσίαση του MVP τροποποιήθηκε από άλλον διαχειριστή. Ανανέωσε τα στοιχεία πριν αποθηκεύσεις ξανά.");
        }
        throw new Error(result.error ?? "Η παρουσίαση δεν αποθηκεύτηκε.");
      }
      setPhoto(null); setRemovePhoto(false); setEditing(false);
      await onSaved();
      setNotice("Η παρουσίαση MVP αποθηκεύτηκε.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Η παρουσίαση δεν αποθηκεύτηκε."); }
    finally { setSaving(false); }
  }

  async function refreshAfterConflict() {
    if (!window.confirm("Η ανανέωση θα απορρίψει τις μη αποθηκευμένες αλλαγές σου. Να συνεχίσουμε;")) return;
    setSaving(true);
    try {
      if (!await onSaved()) throw new Error("Η ανανέωση απέτυχε. Οι αλλαγές σου παραμένουν στη φόρμα.");
      setError(""); setConflict(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Η ανανέωση απέτυχε."); }
    finally { setSaving(false); }
  }

  return <article className="mt-3 space-y-3 rounded-xl border border-zinc-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-black">{contest.competition_name} · {contest.phase_name} · {scopeLabel}</p>
        <p className="mt-1 text-sm">{winner?.player_name ?? "—"} · {winner?.team_name ?? "—"}</p>
        {winner && <p className="text-xs text-zinc-600">{winner.points} PTS · {winner.rebounds} REB · {winner.assists} AST · {winner.efficiency} EFF</p>}
      </div>
      {canManage && <PlatformButton mutation type="button" className={action} onClick={() => { setError(""); setNotice(""); setEditing((value) => !value); }}>
        {editing ? "Κλείσιμο" : "Επεξεργασία παρουσίασης"}</PlatformButton>}
    </div>
    {!editing && <div className="space-y-1 text-sm text-zinc-700">
      {contest.photoUrl && <Image unoptimized src={contest.photoUrl} alt={contest.photo_caption || `MVP ${winner?.player_name ?? ""}`}
        width={640} height={400} className="max-h-72 w-auto max-w-full rounded-xl object-contain" />}
      {contest.photo_caption && <p>{contest.photo_caption}</p>}
      {contest.body_text && <p className="whitespace-pre-wrap">{contest.body_text}</p>}
      {contest.sponsor_name && <p>Χορηγός: {contest.sponsor_name}</p>}
      {contest.gift_description && <p>Δώρο: {contest.gift_description}</p>}
    </div>}
    {editing && canManage && <form className="grid gap-3 border-t border-zinc-200 pt-3" onSubmit={(event) => void save(event)}>
      <h5 className="font-black">ΠΑΡΟΥΣΙΑΣΗ MVP</h5>
      <label className="text-sm font-bold">Φωτογραφία<input className={field} type="file" accept="image/jpeg,image/png,image/webp,image/avif"
        onChange={(event) => { setPhoto(event.target.files?.[0] ?? null); setRemovePhoto(false); }} /></label>
      {contest.photoUrl && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removePhoto}
        onChange={(event) => { setRemovePhoto(event.target.checked); if (event.target.checked) setPhoto(null); }} />Αφαίρεση υπάρχουσας φωτογραφίας</label>}
      <label className="text-sm font-bold">Λεζάντα<input className={field} maxLength={200} value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
      <label className="text-sm font-bold">Περιγραφή<textarea className={field} rows={5} maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <label className="text-sm font-bold">Χορηγός<input className={field} maxLength={160} value={sponsor} onChange={(event) => setSponsor(event.target.value)} /></label>
      <label className="text-sm font-bold">Δώρο<input className={field} maxLength={500} value={gift} onChange={(event) => setGift(event.target.value)} /></label>
      <PlatformButton mutation type="submit" className={action} disabled={saving || conflict || Boolean(photo && removePhoto)}>{saving ? "Αποθήκευση…" : "Αποθήκευση"}</PlatformButton>
    </form>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {conflict && <PlatformButton mutation type="button" className={action} disabled={saving}
      onClick={() => void refreshAfterConflict()}>Ανανέωση στοιχείων</PlatformButton>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
  </article>;
}
