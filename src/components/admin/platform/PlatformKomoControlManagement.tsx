"use client";

import { usePlatformContext, PlatformButton, PlatformForm, PlatformFileInput } from "@/components/admin/platform/shared/platform-context";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type NumericGameSettingKey = "min_players" | "max_players" | "starting_players" | "regulation_periods" | "regulation_period_seconds" | "overtime_seconds";
type EffectiveGameSettings = {
    game_mode: "SIMPLE" | "FULL";
    min_players: number;
    max_players: number;
    starting_players: number;
    regulation_periods: number;
    regulation_period_seconds: number;
    overtime_seconds: number;
    tie_allowed: boolean;
    winner_required: boolean;
};
type GameSettingsOverride = {
    game_mode: "SIMPLE" | "FULL" | null;
    min_players: number | null;
    max_players: number | null;
    starting_players: number | null;
    regulation_periods: number | null;
    regulation_period_seconds: number | null;
    overtime_seconds: number | null;
    tie_allowed: boolean | null;
    winner_required: boolean | null;
};
type GameSearchRow = { id: string; scheduled_date: string | null; scheduled_time: string | null; status: string; round_label: string | null; competition_name: string; phase_name: string | null; home_team_name: string; away_team_name: string; package_version: number | null; published_at: string | null };
type GamePreviewGame = { id: string; competitionName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null };
type GamePreviewTeam = { side: "HOME" | "AWAY"; name: string; players: unknown[]; staff: unknown[] };
type GameOfficialIdentity = { id: string; displayName: string };
type GameOfficials = { referees: { a: GameOfficialIdentity | null; b: GameOfficialIdentity | null; c: GameOfficialIdentity | null }; table: { timer: GameOfficialIdentity | null; shotClock: GameOfficialIdentity | null; scoresheet: GameOfficialIdentity | null; commissioner: GameOfficialIdentity | null } };
type GamePreview = { snapshot: { schemaVersion: 1; game: GamePreviewGame; settings: EffectiveGameSettings; officials: GameOfficials; teams: GamePreviewTeam[] }; hash: string; changed: boolean; defaults: EffectiveGameSettings; effective: EffectiveGameSettings; override: GameSettingsOverride | null; current: { package_version?: number; published_at?: string } | null; history: Array<{ package_version?: number; status?: string; published_at?: string; superseded_at?: string }> };
const initial: EffectiveGameSettings = { game_mode: "FULL", min_players: 5, max_players: 12, starting_players: 5, regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300, tie_allowed: false, winner_required: true };
export type ResultPolicySelection = "REQUIRE_WINNER" | "ALLOW_TIE";
export function resultPolicySelection(settings: { tie_allowed: boolean; winner_required: boolean }): ResultPolicySelection {
    return settings.tie_allowed && !settings.winner_required ? "ALLOW_TIE" : "REQUIRE_WINNER";
}
export function resultPolicyFields(value: FormDataEntryValue | null): { tie_allowed: boolean; winner_required: boolean } {
    const tieAllowed = value === "ALLOW_TIE";
    return { tie_allowed: tieAllowed, winner_required: !tieAllowed };
}
function ResultPolicyFieldset({ settings }: { settings: { tie_allowed: boolean; winner_required: boolean } }) {
    const selected = resultPolicySelection(settings);
    return <fieldset className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:col-span-2"><legend className="px-1 text-sm font-black text-zinc-800">Αποτέλεσμα αγώνα</legend><div className="mt-1 flex flex-wrap gap-x-6 gap-y-2"><label className="flex items-center gap-3 font-black"><input name="result_policy" type="radio" value="REQUIRE_WINNER" required defaultChecked={selected === "REQUIRE_WINNER"} className="accent-orange-600"/>Απαιτείται νικητής</label><label className="flex items-center gap-3 font-black"><input name="result_policy" type="radio" value="ALLOW_TIE" required defaultChecked={selected === "ALLOW_TIE"} className="accent-orange-600"/>Επιτρέπεται ισοπαλία</label></div></fieldset>;
}
function GameOfficialsFields({ values, referees, tableOfficials, fieldClass }: { values: GameOfficials; referees: Registry[]; tableOfficials: Registry[]; fieldClass: string }) {
    const options = (entries: Registry[], selected: GameOfficialIdentity | null) => entries.filter((entry) => Boolean(entry.active) || entry.id === selected?.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.first_name} {entry.last_name}</option>);
    const select = (name: string, label: string, entries: Registry[], selected: GameOfficialIdentity | null) => <label className="text-sm font-black">{label}<select name={name} defaultValue={selected?.id ?? ""} className={fieldClass}><option value="">— Κανένας —</option>{options(entries, selected)}</select></label>;
    return <><fieldset className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:col-span-2 md:grid-cols-3"><legend className="px-1 text-sm font-black text-zinc-800">Διαιτητές</legend>{select("referee_a_id", "Διαιτητής Α", referees, values.referees.a)}{select("referee_b_id", "Διαιτητής Β", referees, values.referees.b)}{select("referee_c_id", "Διαιτητής Γ", referees, values.referees.c)}</fieldset><fieldset className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 md:col-span-2 md:grid-cols-2"><legend className="px-1 text-sm font-black text-zinc-800">Τραπέζι Γραμματείας</legend>{select("table_timer_id", "Χρονόμετρο", tableOfficials, values.table.timer)}{select("table_shot_clock_id", "24''", tableOfficials, values.table.shotClock)}{select("table_scoresheet_id", "Φύλλο Αγώνα", tableOfficials, values.table.scoresheet)}{select("table_commissioner_id", "Κομισάριος", tableOfficials, values.table.commissioner)}</fieldset></>;
}
const numericGameSettingLabels: ReadonlyArray<readonly [NumericGameSettingKey, string]> = [["min_players", "Ελάχιστοι παίκτες"], ["max_players", "Μέγιστοι παίκτες"], ["starting_players", "Παίκτες στο γήπεδο"], ["regulation_periods", "Κανονικές περίοδοι"]];
function localDateValue() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
function displayDateValue(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : ""; }
function canonicalDateValue(value: string) {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const [, dayText, monthText, yearText] = match;
    const day = Number(dayText), month = Number(monthText), year = Number(yearText);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return `${yearText}-${monthText}-${dayText}`;
}
function normalizeDateTyping(value: string) { const digits = value.replace(/\D/g, "").slice(0, 8); return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("/"); }
function OperatorDateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    const pickerRef = useRef<HTMLInputElement>(null);
    const canonical = canonicalDateValue(value) ?? "";
    return <label className="text-sm font-black text-zinc-700">{label}<div className="mt-1 flex gap-2"><input type="text" inputMode="numeric" autoComplete="off" placeholder="DD/MM/YYYY" value={value} onChange={(event) => onChange(normalizeDateTyping(event.target.value))} className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 font-semibold"/><input ref={pickerRef} type="date" value={canonical} onChange={(event) => onChange(displayDateValue(event.target.value))} tabIndex={-1} className="sr-only"/><PlatformButton type="button" onClick={() => { try { pickerRef.current?.showPicker(); } catch { pickerRef.current?.focus(); } }} className="rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-black">Ημερολόγιο</PlatformButton></div></label>;
}
async function payload(response: Response) { const body = await response.json(); if (!response.ok)
    throw new Error(body.error || "Η ενέργεια απέτυχε."); return body; }
const field = "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 font-semibold";
type BulkPublishSummary = { results: Array<{ gameId: string; label: string; outcome: "published" | "unchanged" | "failed"; packageVersion: number | null; reason: string | null }>; published: number; unchanged: number; failed: number };
type KomoControlTab = "settings" | "scorers" | "referees" | "table-officials" | "games";
const komoControlTabs = [["settings", "Ρυθμίσεις"], ["scorers", "Scorers"], ["referees", "Διαιτητές"], ["table-officials", "Κριτές"], ["games", "Αγώνες"]] as const;
export function visibleKomoControlTabs(isSuperAdmin: boolean) {
    return komoControlTabs.filter(([id]) => isSuperAdmin || id !== "scorers");
}
export function PlatformKomoControlManagement({ organizationId, isSuperAdmin }: {
    organizationId: string;
    isSuperAdmin: boolean;
}) {
  const { request: fetch, url: platformUrl } = usePlatformContext();
    const [tab, setTab] = useState<KomoControlTab>("settings"), [competitions, setCompetitions] = useState<Competition[]>([]), [competitionId, setCompetitionId] = useState(""), [settings, setSettings] = useState<Settings>(null), [scorers, setScorers] = useState<Scorer[]>([]), [referees, setReferees] = useState<Registry[]>([]), [officials, setOfficials] = useState<Registry[]>([]), [notice, setNotice] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(""), [loadingCompetitions, setLoadingCompetitions] = useState(true), [fromDateText, setFromDateText] = useState(() => displayDateValue(localDateValue())), [toDateText, setToDateText] = useState(() => displayDateValue(localDateValue())), [gameCompetitionId, setGameCompetitionId] = useState(""), [games, setGames] = useState<GameSearchRow[]>([]), [loadingGames, setLoadingGames] = useState(false), [hasSearched, setHasSearched] = useState(false), [selectedGameIds, setSelectedGameIds] = useState<string[]>([]), [selectedGameId, setSelectedGameId] = useState(""), [preview, setPreview] = useState<GamePreview | null>(null), [loadingPreview, setLoadingPreview] = useState(false), [bulkSummary, setBulkSummary] = useState<BulkPublishSummary | null>(null), [editing, setEditing] = useState<{
        kind: "scorers" | "referees" | "table-officials";
        entry: Scorer | Registry;
    } | null>(null);
    const endpoint = useCallback((resource: string, extra = "") => `/api/admin/komocontrol/${resource}?organizationId=${encodeURIComponent(organizationId)}${extra}`, [organizationId]);
    const load = useCallback(async () => { setLoadingCompetitions(true); try {
        setError("");
        const scorerRequest = isSuperAdmin ? payload(await fetch(endpoint("scorers"), { cache: "no-store" })) : Promise.resolve({ scorers: [] });
        const [s, sc, r, o] = await Promise.all([payload(await fetch(endpoint("settings", competitionId ? `&competitionId=${encodeURIComponent(competitionId)}` : ""), { cache: "no-store" })), scorerRequest, payload(await fetch(endpoint("referees"), { cache: "no-store" })), payload(await fetch(endpoint("table-officials"), { cache: "no-store" }))]);
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
    } }, [competitionId, endpoint, isSuperAdmin]);
    useEffect(() => { void load(); }, [load]);
    const activeList = useMemo(() => tab === "scorers" ? scorers : tab === "referees" ? referees : officials, [tab, scorers, referees, officials]);
    async function saveSettings(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!competitionId)
        return; setBusy("settings"); setError(""); setNotice(""); try {
        const f = new FormData(event.currentTarget);
        const regulationPeriodMinutes = Number(f.get("regulation_period_seconds"));
        const overtimeMinutes = Number(f.get("overtime_seconds"));
        if (!Number.isInteger(regulationPeriodMinutes) || regulationPeriodMinutes <= 0 || !Number.isInteger(overtimeMinutes) || overtimeMinutes <= 0)
            throw new Error("Οι διάρκειες πρέπει να είναι θετικοί ακέραιοι αριθμοί λεπτών.");
        await payload(await fetch(endpoint("settings"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(f), competitionId, regulation_period_seconds: regulationPeriodMinutes * 60, overtime_seconds: overtimeMinutes * 60, ...resultPolicyFields(f.get("result_policy")) }) }));
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
    async function refreshGames() { const fromDate = canonicalDateValue(fromDateText), toDate = canonicalDateValue(toDateText); if (!fromDate || !toDate) return; const competitionFilter = gameCompetitionId ? `&competitionId=${encodeURIComponent(gameCompetitionId)}` : ""; const result = await payload(await fetch(endpoint("games", `&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}${competitionFilter}`), { cache: "no-store" })); setGames(result.games || []); }
    async function searchGames(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const fromDate = canonicalDateValue(fromDateText), toDate = canonicalDateValue(toDateText); if (!fromDate || !toDate) { setError("Συμπληρώστε έγκυρες ημερομηνίες σε μορφή ΗΗ/ΜΜ/ΕΕΕΕ."); return; } if (fromDate > toDate) { setError("Η ημερομηνία «Από» πρέπει να είναι πριν ή ίδια με την ημερομηνία «Έως». "); return; } setLoadingGames(true); setHasSearched(false); setSelectedGameIds([]); setBulkSummary(null); setError(""); setNotice(""); try { await refreshGames(); setSelectedGameId(""); setPreview(null); setHasSearched(true); } catch (caught) { setError(caught instanceof Error ? caught.message : "Αποτυχία αναζήτησης αγώνων."); } finally { setLoadingGames(false); } }
    async function showGame(gameId: string, force = false) { if (!force && selectedGameId === gameId) { setSelectedGameId(""); setPreview(null); return; } setSelectedGameId(gameId); setLoadingPreview(true); setError(""); setNotice(""); try { setPreview(await payload(await fetch(endpoint("game-settings", `&gameId=${encodeURIComponent(gameId)}`), { cache: "no-store" }))); } catch (caught) { setPreview(null); setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης προεπισκόπησης."); } finally { setLoadingPreview(false); } }
    async function saveGameSettings(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedGameId) return; const form = new FormData(event.currentTarget); const minutes = Number(form.get("regulation_period_minutes")); const overtime = Number(form.get("overtime_minutes")); if (!Number.isInteger(minutes) || minutes < 1 || !Number.isInteger(overtime) || overtime < 1) { setError("Οι διάρκειες πρέπει να είναι θετικοί ακέραιοι αριθμοί λεπτών."); return; } setBusy("game-settings"); setError(""); setNotice(""); try { await payload(await fetch(endpoint("game-settings"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(form), gameId: selectedGameId, regulation_period_seconds: minutes * 60, overtime_seconds: overtime * 60, ...resultPolicyFields(form.get("result_policy")) }) })); setNotice("Οι ρυθμίσεις του αγώνα αποθηκεύτηκαν."); await showGame(selectedGameId, true); } catch (caught) { setError(caught instanceof Error ? caught.message : "Αποτυχία αποθήκευσης ρυθμίσεων αγώνα."); } finally { setBusy(""); } }
    async function clearGameSettings() { if (!selectedGameId) return; setBusy("game-settings"); setError(""); setNotice(""); try { await payload(await fetch(endpoint("game-settings"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId: selectedGameId, clear: true }) })); setNotice("Ο αγώνας χρησιμοποιεί πλέον τις ρυθμίσεις διοργάνωσης."); await showGame(selectedGameId, true); } catch (caught) { setError(caught instanceof Error ? caught.message : "Αποτυχία επαναφοράς ρυθμίσεων."); } finally { setBusy(""); } }
    async function publishGame() { if (!selectedGameId) return; const republishing = Boolean(preview?.current); setBusy("publish"); setError(""); setNotice(""); try { const result = await payload(await fetch(endpoint("games"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId: selectedGameId }) })); setNotice(result.published ? (republishing ? `Η νέα έκδοση κοινοποιήθηκε επιτυχώς — v${result.packageVersion}.` : `Ο αγώνας κοινοποιήθηκε επιτυχώς στο KomoControl — v${result.packageVersion}.`) : "Δεν υπάρχουν αλλαγές προς κοινοποίηση."); await showGame(selectedGameId, true); await refreshGames(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Αποτυχία κοινοποίησης."); } finally { setBusy(""); } }
    async function publishSelectedGames() { if (selectedGameIds.length === 0) return; const affectedGameIds = [...selectedGameIds]; setBusy("bulk-publish"); setError(""); setNotice(""); try { const result = await payload(await fetch(endpoint("games"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameIds: affectedGameIds }) })) as BulkPublishSummary; setBulkSummary(result); setSelectedGameIds(result.results.filter((item) => item.outcome === "failed").map((item) => item.gameId)); await refreshGames(); if (selectedGameId && affectedGameIds.includes(selectedGameId)) await showGame(selectedGameId, true); } catch (caught) { setError(caught instanceof Error ? caught.message : "Αποτυχία μαζικής κοινοποίησης."); } finally { setBusy(""); } }
    const currentSettings = preview?.effective || initial; const number = (key: NumericGameSettingKey) => currentSettings[key]; const previewPanel = <>{loadingPreview && <p className="font-bold text-zinc-600">Φόρτωση προεπισκόπησης…</p>}{preview && <article className="rounded-2xl border border-orange-200 bg-white p-5"><h3 className="text-xl font-black text-zinc-950">{preview.snapshot.game.competitionName} · {preview.snapshot.game.phaseName || "Αγώνας"}</h3><p className="mt-1 font-bold text-zinc-700">{preview.snapshot.teams.map((team) => team.name).join(" — ")}</p><p className="mt-1 text-sm text-zinc-600">{preview.snapshot.game.scheduledDate} · {preview.snapshot.game.scheduledTime || "Ώρα δεν ορίστηκε"}{preview.snapshot.game.venue ? ` · ${preview.snapshot.game.venue}` : ""}</p><p className="mt-3 text-sm font-bold text-zinc-600">{preview.override ? "Προσαρμοσμένες ρυθμίσεις αγώνα" : "Ρυθμίσεις διοργάνωσης"}</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{preview.snapshot.teams.map((team) => <div key={team.side} className="rounded-xl bg-zinc-50 p-3"><p className="font-black">{team.side === "HOME" ? "HOME" : "AWAY"}: {team.name}</p><p className="text-sm text-zinc-600">διαθέσιμοι παίκτες: {team.players.length}</p><p className="text-sm text-zinc-600">διαθέσιμο staff: {team.staff.length}</p></div>)}</div><PlatformForm onSubmit={(event) => void saveGameSettings(event)} className="mt-5 grid gap-3 md:grid-cols-2"><label className="text-sm font-black">Τύπος καταγραφής<select name="game_mode" defaultValue={currentSettings.game_mode} className={field}><option value="FULL">Πλήρη στατιστικά</option><option value="SIMPLE">Απλό φύλλο αγώνα</option></select></label>{numericGameSettingLabels.map(([key,label]) => <label key={key} className="text-sm font-black">{label}<input name={key} type="number" min="1" defaultValue={number(key)} className={field}/></label>)}<label className="text-sm font-black">Διάρκεια περιόδου (λεπτά)<input name="regulation_period_minutes" type="number" min="1" defaultValue={number("regulation_period_seconds") / 60} className={field}/></label><label className="text-sm font-black">Διάρκεια παράτασης (λεπτά)<input name="overtime_minutes" type="number" min="1" defaultValue={number("overtime_seconds") / 60} className={field}/></label><ResultPolicyFieldset key={`${selectedGameId}-${resultPolicySelection(currentSettings)}`} settings={currentSettings}/><GameOfficialsFields values={preview.snapshot.officials} referees={referees} tableOfficials={officials} fieldClass={field}/><div className="flex flex-wrap gap-3 md:col-span-2"><PlatformButton mutation disabled={busy === "game-settings"} className="rounded-xl bg-orange-600 px-4 py-2.5 font-black text-white">Αποθήκευση ρυθμίσεων αγώνα</PlatformButton>{preview.override && <PlatformButton type="button" onClick={() => void clearGameSettings()} className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Χρήση ρυθμίσεων διοργάνωσης</PlatformButton>}</div></PlatformForm><div className="mt-5 flex flex-wrap items-center gap-3"><PlatformButton mutation disabled={busy === "publish"} onClick={() => void publishGame()} className="rounded-xl bg-zinc-950 px-4 py-2.5 font-black text-white">{preview.current ? "Κοινοποίηση ξανά" : "Κοινοποίηση"}</PlatformButton>{preview.current && <span className="font-bold text-zinc-700">Κοινοποιήθηκε • v{preview.current.package_version}</span>}{preview.current && preview.changed && <span className="text-sm font-bold text-orange-700">Υπάρχουν αλλαγές που δεν έχουν κοινοποιηθεί.</span>}</div><div className="mt-5 border-t border-zinc-200 pt-4"><p className="font-black">Ιστορικό κοινοποιήσεων</p>{preview.history.length === 0 ? <p className="mt-1 text-sm text-zinc-600">Δεν υπάρχει ακόμη κοινοποιημένο Package.</p> : <div className="mt-2 space-y-1 text-sm text-zinc-700">{preview.history.map((item) => <p key={String(item.package_version)}>v{item.package_version} • {item.status} • {String(item.published_at || item.superseded_at || "")}</p>)}</div>}</div></article>}</>; const gamesPanel = <section className="space-y-5"><PlatformForm readOnlyAction onSubmit={(event) => void searchGames(event)} className="rounded-2xl border border-zinc-200 bg-white p-5"><h2 className="text-xl font-black text-zinc-950">Αγώνες KomoControl</h2><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-black text-zinc-700">Διοργάνωση<select value={gameCompetitionId} onChange={(event) => setGameCompetitionId(event.target.value)} className={field}><option value="">Όλες οι διαθέσιμες διοργανώσεις</option>{competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.season_name} · {competition.name}</option>)}</select></label><OperatorDateField label="Από" value={fromDateText} onChange={(next) => { setFromDateText(next); setToDateText((current) => current === fromDateText ? next : current); }}/><OperatorDateField label="Έως" value={toDateText} onChange={setToDateText}/><PlatformButton className="rounded-xl bg-orange-600 px-4 py-2.5 font-black text-white">Αναζήτηση</PlatformButton></div></PlatformForm>{!loadingGames && games.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4"><label className="flex items-center gap-2 font-black text-zinc-800"><input type="checkbox" checked={games.every((game) => selectedGameIds.includes(game.id))} onChange={(event) => setSelectedGameIds(event.target.checked ? games.map((game) => game.id) : [])}/>Επιλογή όλων</label><PlatformButton mutation type="button" disabled={selectedGameIds.length === 0 || busy === "bulk-publish"} onClick={() => void publishSelectedGames()} className="rounded-xl bg-zinc-950 px-4 py-2.5 font-black text-white disabled:opacity-50">{busy === "bulk-publish" ? "Κοινοποίηση…" : `Κοινοποίηση επιλεγμένων (${selectedGameIds.length})`}</PlatformButton></div>}{bulkSummary && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><p className="font-black">Η μαζική κοινοποίηση ολοκληρώθηκε.</p><p className="mt-1 text-sm font-bold">Κοινοποιήθηκαν: {bulkSummary.published} · Χωρίς αλλαγές: {bulkSummary.unchanged} · Απέτυχαν: {bulkSummary.failed}</p>{bulkSummary.results.map((item) => <p key={item.gameId} className="mt-1 text-sm">{item.label}{item.outcome === "published" ? ` → v${item.packageVersion}` : item.outcome === "unchanged" ? " → Δεν υπάρχουν αλλαγές προς κοινοποίηση." : ` — ${item.reason}`}</p>)}</div>}{loadingGames ? <p className="rounded-2xl border border-zinc-200 bg-white p-5 font-bold text-zinc-600">Φόρτωση αγώνων…</p> : hasSearched && games.length === 0 ? <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-600">Δεν βρέθηκαν διαθέσιμοι αγώνες για το επιλεγμένο διάστημα.</p> : games.map((game) => <article key={game.id} className="rounded-2xl border border-zinc-200 bg-white p-5"><label className="mb-3 flex w-fit items-center gap-2 text-sm font-black text-zinc-700"><input type="checkbox" checked={selectedGameIds.includes(game.id)} onChange={(event) => setSelectedGameIds((current) => event.target.checked ? [...current, game.id] : current.filter((id) => id !== game.id))}/>Επιλογή αγώνα</label><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-zinc-950">{game.home_team_name} — {game.away_team_name}</p><p className="mt-1 text-sm text-zinc-600">{game.scheduled_date} · {game.scheduled_time || "Ώρα δεν ορίστηκε"} · {game.competition_name}{game.phase_name ? ` · ${game.phase_name}` : ""}{game.round_label ? ` · ${game.round_label}` : ""}</p></div><span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-black text-zinc-700">{game.package_version ? `Κοινοποιήθηκε • v${game.package_version}` : "Δεν έχει κοινοποιηθεί"}</span></div><PlatformButton onClick={() => void showGame(game.id)} className="mt-4 rounded-xl border border-zinc-300 px-4 py-2 font-black">Προβολή / Ρυθμίσεις</PlatformButton>{selectedGameId === game.id && previewPanel}</article>)}</section>;
    function RegistryPanel({ kind, title, empty }: {
        kind: "scorers" | "referees" | "table-officials";
        title: string;
        empty: string;
    }) { const edit = editing?.kind === kind ? editing.entry : null; const list = kind === "scorers" ? scorers : kind === "referees" ? referees : officials; return <section className="space-y-5"><div className="rounded-2xl border border-zinc-200 bg-white p-5"><h2 className="text-xl font-black text-zinc-950">{edit ? `Επεξεργασία ${title}` : `Νέος ${title}`}</h2><PlatformForm onSubmit={(e) => void saveEntry(kind, e)} className="mt-4 grid gap-3 md:grid-cols-2">{kind === "scorers" ? <><label className="text-sm font-black text-zinc-700">Username<input name="username" required defaultValue={(edit as Scorer | undefined)?.username} className={field}/></label><label className="text-sm font-black text-zinc-700">{edit ? "Νέος κωδικός (προαιρετικά)" : "Password"}<input name="password" type="password" required={!edit} minLength={8} autoComplete="new-password" className={field}/></label></> : <><label className="text-sm font-black text-zinc-700">Όνομα<input name="first_name" required defaultValue={(edit as Registry | undefined)?.first_name} className={field}/></label><label className="text-sm font-black text-zinc-700">Επώνυμο<input name="last_name" required defaultValue={(edit as Registry | undefined)?.last_name} className={field}/></label><label className="text-sm font-black text-zinc-700 md:col-span-2">Οργανισμός (προαιρετικό)<input name="organization" defaultValue={(edit as Registry | undefined)?.organization || ""} className={field}/></label></>}<div className="md:col-span-2 flex flex-wrap gap-3"><PlatformButton mutation disabled={Boolean(busy)} className="rounded-xl bg-orange-600 px-4 py-2.5 font-black text-white disabled:opacity-50">{busy === kind ? "Αποθήκευση…" : "Αποθήκευση"}</PlatformButton>{edit && <PlatformButton mutation type="button" onClick={() => setEditing(null)} className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Ακύρωση</PlatformButton>}</div></PlatformForm></div><div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">{list.length === 0 ? <p className="p-6 text-zinc-600">{empty}</p> : <div className="divide-y divide-zinc-100">{list.map(entry => { const active = kind === "scorers" ? (entry as Scorer).status === "active" : Boolean((entry as Registry).active); const name = kind === "scorers" ? (entry as Scorer).username : `${(entry as Registry).first_name} ${(entry as Registry).last_name}`; return <div key={entry.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="font-black text-zinc-950">{name}</p>{kind !== "scorers" && <p className="text-sm text-zinc-500">{(entry as Registry).organization || "—"}</p>}</div><span className={`rounded-full px-3 py-1 text-xs font-black ${active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{active ? "Ενεργός" : "Απενεργοποιημένος"}</span><PlatformButton mutation onClick={() => setEditing({ kind, entry })} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-black">Επεξεργασία</PlatformButton><PlatformButton mutation disabled={Boolean(busy)} onClick={() => void toggle(kind, entry)} className="rounded-lg border border-orange-200 px-3 py-2 text-sm font-black text-orange-700">{active ? "Απενεργοποίηση" : "Ενεργοποίηση"}</PlatformButton></div>; })}</div>}</div></section>; }
    return <section className="space-y-5"><div className="rounded-2xl border border-zinc-200 bg-white p-2"><div className="flex flex-wrap gap-1">{visibleKomoControlTabs(isSuperAdmin).map(([id, label]) => <PlatformButton mutation key={id} onClick={() => { setTab(id); setEditing(null); }} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab === id ? "bg-zinc-950 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}>{label}</PlatformButton>)}</div></div>{notice && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</p>}{error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</p>}{tab === "settings" && <section className="rounded-2xl border border-zinc-200 bg-white p-5"><h2 className="text-xl font-black text-zinc-950">Ρυθμίσεις KomoControl</h2><p className="mt-1 text-sm text-zinc-600">Οι τιμές αποθηκεύονται μόνο μετά από ρητή επιλογή «Αποθήκευση».</p><label className="mt-5 block text-sm font-black text-zinc-700">Σεζόν · Διοργάνωση<select value={competitionId} onChange={e => setCompetitionId(e.target.value)} disabled={loadingCompetitions} className={field}><option value="">{loadingCompetitions ? "Φόρτωση διοργανώσεων…" : competitions.length ? "Επιλέξτε Διοργάνωση" : "Δεν υπάρχουν διαθέσιμες διοργανώσεις"}</option>{competitions.map(c => <option key={c.id} value={c.id}>{c.season_name} · {c.name}</option>)}</select></label>{competitionId && <PlatformForm key={`${competitionId}-${JSON.stringify(settings)}`} onSubmit={(e) => void saveSettings(e)} className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-black">Τύπος καταγραφής<select name="game_mode" defaultValue={values.game_mode} className={field}><option value="FULL">Πλήρη στατιστικά</option><option value="SIMPLE">Απλό φύλλο αγώνα</option></select></label>{[['min_players', 'Ελάχιστοι παίκτες'], ['max_players', 'Μέγιστοι παίκτες'], ['starting_players', 'Παίκτες στο γήπεδο'], ['regulation_periods', 'Κανονικές περίοδοι'], ['regulation_period_seconds', 'Διάρκεια περιόδου (λεπτά)'], ['overtime_seconds', 'Διάρκεια παράτασης (λεπτά)']].map(([name, label]) => <label key={name} className="text-sm font-black">{label}<input name={name} type="number" min="1" required defaultValue={(name === "regulation_period_seconds" ? values.regulation_period_seconds / 60 : name === "overtime_seconds" ? values.overtime_seconds / 60 : values[name as keyof typeof values]) as number} className={field}/></label>)}<ResultPolicyFieldset key={`${competitionId}-${resultPolicySelection(values)}`} settings={values}/><div className="md:col-span-2"><PlatformButton mutation disabled={Boolean(busy)} className="rounded-xl bg-orange-600 px-5 py-3 font-black text-white disabled:opacity-50">{busy === "settings" ? "Αποθήκευση…" : "Αποθήκευση"}</PlatformButton></div></PlatformForm>}</section>}{isSuperAdmin && tab === "scorers" && <RegistryPanel kind="scorers" title="Scorer" empty="Δεν έχουν δημιουργηθεί ακόμη scorers."/>}{tab === "referees" && <RegistryPanel kind="referees" title="Διαιτητής" empty="Δεν έχουν καταχωρηθεί ακόμη διαιτητές."/>}{tab === "table-officials" && <RegistryPanel kind="table-officials" title="Κριτής" empty="Δεν έχουν καταχωρηθεί ακόμη κριτές."/>}{tab === "games" && gamesPanel}</section>;
}
