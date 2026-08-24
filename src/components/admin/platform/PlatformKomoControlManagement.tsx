"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
type Competition = {
    id: string;
    name: string;
    season_name: string;
};
type Settings = Record<string, unknown> | null;
type Scorer = {
    id: string;
    username: string;
    status: "active" | "disabled";
    credential_version: number;
};
type Registry = {
    id: string;
    first_name: string;
    last_name: string;
    organization: string | null;
    active: number;
};
const initial = { game_mode: "SIMPLE", min_players: 5, max_players: 12, starting_players: 5, regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300, tie_allowed: 0, winner_required: 1 };
async function payload(response: Response) { const body = await response.json(); if (!response.ok)
    throw new Error(body.error || "Η ενέργεια απέτυχε."); return body; }
const field = "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 font-semibold";
export function PlatformKomoControlManagement({ organizationId }: {
    organizationId: string;
}) {
    const [tab, setTab] = useState<"settings" | "scorers" | "referees" | "table-officials">("settings"), [competitions, setCompetitions] = useState<Competition[]>([]), [competitionId, setCompetitionId] = useState(""), [settings, setSettings] = useState<Settings>(null), [scorers, setScorers] = useState<Scorer[]>([]), [referees, setReferees] = useState<Registry[]>([]), [officials, setOfficials] = useState<Registry[]>([]), [notice, setNotice] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(""), [loadingCompetitions, setLoadingCompetitions] = useState(true), [editing, setEditing] = useState<{
        kind: "scorers" | "referees" | "table-officials";
        entry: Scorer | Registry;
    } | null>(null);
    const endpoint = useCallback((resource: string, extra = "") => `/api/admin/komocontrol/${resource}?organizationId=${encodeURIComponent(organizationId)}${extra}`, [organizationId]);
    const load = useCallback(async () => { setLoadingCompetitions(true); try {
        setError("");
        const [s, sc, r, o] = await Promise.all([payload(await fetch(endpoint("settings", competitionId ? `&competitionId=${encodeURIComponent(competitionId)}` : ""), { cache: "no-store" })), payload(await fetch(endpoint("scorers"), { cache: "no-store" })), payload(await fetch(endpoint("referees"), { cache: "no-store" })), payload(await fetch(endpoint("table-officials"), { cache: "no-store" }))]);
        setCompetitions(s.competitions || []);
        setSettings(s.settings);
        setScorers(sc.scorers || []);
        setReferees(r.entries || []);
        setOfficials(o.entries || []);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Αποτυχία φόρτωσης KomoControl.");
    } finally {
        setLoadingCompetitions(false);
    } }, [competitionId, endpoint]);
    useEffect(() => { void load(); }, [load]);
    const activeList = useMemo(() => tab === "scorers" ? scorers : tab === "referees" ? referees : officials, [tab, scorers, referees, officials]);
    async function saveSettings(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!competitionId)
        return; setBusy("settings"); setError(""); setNotice(""); try {
        const f = new FormData(event.currentTarget);
        const regulationPeriodMinutes = Number(f.get("regulation_period_seconds"));
        const overtimeMinutes = Number(f.get("overtime_seconds"));
        if (!Number.isInteger(regulationPeriodMinutes) || regulationPeriodMinutes <= 0 || !Number.isInteger(overtimeMinutes) || overtimeMinutes <= 0)
            throw new Error("Οι διάρκειες πρέπει να είναι θετικοί ακέραιοι αριθμοί λεπτών.");
        await payload(await fetch(endpoint("settings"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(f), competitionId, regulation_period_seconds: regulationPeriodMinutes * 60, overtime_seconds: overtimeMinutes * 60, tie_allowed: f.get("tie_allowed") === "on", winner_required: f.get("winner_required") === "on" }) }));
        setNotice("Οι ρυθμίσεις αποθηκεύτηκαν.");
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Αποτυχία αποθήκευσης.");
    }
    finally {
        setBusy("");
    } }
    async function saveEntry(kind: "scorers" | "referees" | "table-officials", event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(kind); setError(""); setNotice(""); try {
        const formElement = event.currentTarget;
        const form = Object.fromEntries(new FormData(formElement).entries());
        const edit = editing?.kind === kind ? editing.entry : null;
        await payload(await fetch(endpoint(kind), { method: edit ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(edit ? kind === "scorers" ? { ...form, id: edit.id } : { ...form, id: edit.id, active: Boolean((edit as Registry).active) } : { ...form, status: kind === "scorers" ? "active" : undefined, active: kind === "scorers" ? undefined : true }) }));
        setEditing(null);
        formElement.reset();
        setNotice(edit ? "Οι αλλαγές αποθηκεύτηκαν." : kind === "scorers" ? "Ο scorer δημιουργήθηκε." : kind === "referees" ? "Ο διαιτητής δημιουργήθηκε." : "Ο κριτής δημιουργήθηκε.");
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Η αποθήκευση απέτυχε.");
    }
    finally {
        setBusy("");
    } }
    async function toggle(kind: "scorers" | "referees" | "table-officials", entry: Scorer | Registry) { setBusy(`${kind}-${entry.id}`); setError(""); setNotice(""); try {
        const body = kind === "scorers" ? { id: entry.id, username: (entry as Scorer).username, status: (entry as Scorer).status === "active" ? "disabled" : "active", password: "" } : { id: entry.id, first_name: (entry as Registry).first_name, last_name: (entry as Registry).last_name, organization: (entry as Registry).organization || "", active: !(entry as Registry).active };
        await payload(await fetch(endpoint(kind), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
        setNotice("Η κατάσταση ενημερώθηκε.");
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Η ενημέρωση απέτυχε.");
    }
    finally {
        setBusy("");
    } }
    const values = { ...initial, ...(settings || {}) } as typeof initial;
    function RegistryPanel({ kind, title, empty }: {
        kind: "scorers" | "referees" | "table-officials";
        title: string;
        empty: string;
    }) { const edit = editing?.kind === kind ? editing.entry : null; const list = kind === "scorers" ? scorers : kind === "referees" ? referees : officials; return <section className="space-y-5"><div className="rounded-2xl border border-zinc-200 bg-white p-5"><h2 className="text-xl font-black text-zinc-950">{edit ? `Επεξεργασία ${title}` : `Νέος ${title}`}</h2><form onSubmit={(e) => void saveEntry(kind, e)} className="mt-4 grid gap-3 md:grid-cols-2">{kind === "scorers" ? <><label className="text-sm font-black text-zinc-700">Username<input name="username" required defaultValue={(edit as Scorer | undefined)?.username} className={field}/></label><label className="text-sm font-black text-zinc-700">{edit ? "Νέος κωδικός (προαιρετικά)" : "Password"}<input name="password" type="password" required={!edit} minLength={8} autoComplete="new-password" className={field}/></label></> : <><label className="text-sm font-black text-zinc-700">Όνομα<input name="first_name" required defaultValue={(edit as Registry | undefined)?.first_name} className={field}/></label><label className="text-sm font-black text-zinc-700">Επώνυμο<input name="last_name" required defaultValue={(edit as Registry | undefined)?.last_name} className={field}/></label><label className="text-sm font-black text-zinc-700 md:col-span-2">Οργανισμός (προαιρετικό)<input name="organization" defaultValue={(edit as Registry | undefined)?.organization || ""} className={field}/></label></>}<div className="md:col-span-2 flex flex-wrap gap-3"><button disabled={Boolean(busy)} className="rounded-xl bg-orange-600 px-4 py-2.5 font-black text-white disabled:opacity-50">{busy === kind ? "Αποθήκευση…" : "Αποθήκευση"}</button>{edit && <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Ακύρωση</button>}</div></form></div><div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">{list.length === 0 ? <p className="p-6 text-zinc-600">{empty}</p> : <div className="divide-y divide-zinc-100">{list.map(entry => { const active = kind === "scorers" ? (entry as Scorer).status === "active" : Boolean((entry as Registry).active); const name = kind === "scorers" ? (entry as Scorer).username : `${(entry as Registry).first_name} ${(entry as Registry).last_name}`; return <div key={entry.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="font-black text-zinc-950">{name}</p>{kind !== "scorers" && <p className="text-sm text-zinc-500">{(entry as Registry).organization || "—"}</p>}</div><span className={`rounded-full px-3 py-1 text-xs font-black ${active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{active ? "Ενεργός" : "Απενεργοποιημένος"}</span><button onClick={() => setEditing({ kind, entry })} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-black">Επεξεργασία</button><button disabled={Boolean(busy)} onClick={() => void toggle(kind, entry)} className="rounded-lg border border-orange-200 px-3 py-2 text-sm font-black text-orange-700">{active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</button></div>; })}</div>}</div></section>; }
    return <section className="space-y-5"><div className="rounded-2xl border border-zinc-200 bg-white p-2"><div className="flex flex-wrap gap-1">{([['settings', 'Ρυθμίσεις'], ['scorers', 'Scorers'], ['referees', 'Διαιτητές'], ['table-officials', 'Κριτές']] as const).map(([id, label]) => <button key={id} onClick={() => { setTab(id); setEditing(null); }} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab === id ? "bg-zinc-950 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}>{label}</button>)}</div></div>{notice && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</p>}{error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</p>}{tab === "settings" && <section className="rounded-2xl border border-zinc-200 bg-white p-5"><h2 className="text-xl font-black text-zinc-950">Ρυθμίσεις KomoControl</h2><p className="mt-1 text-sm text-zinc-600">Οι τιμές αποθηκεύονται μόνο μετά από ρητή επιλογή «Αποθήκευση».</p><label className="mt-5 block text-sm font-black text-zinc-700">Σεζόν · Διοργάνωση<select value={competitionId} onChange={e => setCompetitionId(e.target.value)} disabled={loadingCompetitions} className={field}><option value="">{loadingCompetitions ? "Φόρτωση διοργανώσεων…" : competitions.length ? "Επιλέξτε Διοργάνωση" : "Δεν υπάρχουν διαθέσιμες διοργανώσεις"}</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.season_name} · {c.name}</option>)}</select></label>{competitionId && <form key={`${competitionId}-${JSON.stringify(settings)}`} onSubmit={(e) => void saveSettings(e)} className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-black">Τύπος καταγραφής<select name="game_mode" defaultValue={values.game_mode} className={field}><option value="SIMPLE">Απλό Φύλλο Αγώνα</option><option value="FULL">Full Stats</option></select></label>{[['min_players', 'Ελάχιστοι παίκτες'], ['max_players', 'Μέγιστοι παίκτες'], ['starting_players', 'Παίκτες στο γήπεδο'], ['regulation_periods', 'Κανονικές περίοδοι'], ['regulation_period_seconds', 'Διάρκεια περιόδου (λεπτά)'], ['overtime_seconds', 'Διάρκεια παράτασης (λεπτά)']].map(([name, label]) => <label key={name} className="text-sm font-black">{label}<input name={name} type="number" min="1" required defaultValue={(name === "regulation_period_seconds" ? values.regulation_period_seconds / 60 : name === "overtime_seconds" ? values.overtime_seconds / 60 : values[name as keyof typeof values]) as number} className={field}/></label>)}<label className="flex items-center gap-3 text-sm font-black"><input name="tie_allowed" type="checkbox" defaultChecked={Boolean(values.tie_allowed)}/>Επιτρέπεται ισοπαλία</label><label className="flex items-center gap-3 text-sm font-black"><input name="winner_required" type="checkbox" defaultChecked={Boolean(values.winner_required)}/>Απαιτείται νικητής</label><div className="md:col-span-2"><button disabled={Boolean(busy)} className="rounded-xl bg-orange-600 px-5 py-3 font-black text-white disabled:opacity-50">{busy === "settings" ? "Αποθήκευση…" : "Αποθήκευση"}</button></div></form>}</section>}{tab === "scorers" && <RegistryPanel kind="scorers" title="Scorer" empty="Δεν έχουν δημιουργηθεί ακόμη scorers."/>}{tab === "referees" && <RegistryPanel kind="referees" title="Διαιτητής" empty="Δεν έχουν καταχωρηθεί ακόμη διαιτητές."/>}{tab === "table-officials" && <RegistryPanel kind="table-officials" title="Κριτής" empty="Δεν έχουν καταχωρηθεί ακόμη κριτές."/>}</section>;
}
