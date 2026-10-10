"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlatformButton, usePlatformContext } from "./shared/platform-context";

type Phase = { id: string; competition_id: string; name: string; format: "standings" | "series"; mvp_enabled: number; tournamentId: string; tournamentName: string };
type Scope = { phase_id: string; round_number: number | null; series_matchup_id: string | null; round_label: string | null;
  home_team_name: string | null; away_team_name: string | null };
type OccupiedScope = { phase_id: string; scope_type: "round" | "series"; round_number: number | null; matchup_id: string | null };
type Candidate = { id: string; contest_id: string; player_id: string; player_name: string; team_name: string; votes: number | null };
type Contest = { id: string; phase_id: string; scope_type: "round" | "series"; round_number: number | null; matchup_id: string | null;
  status: string; selection_method: string; results_visibility: "live" | "after_close"; opens_at: number; closes_at: number; finalized_at: number | null;
  winner_player_id: string | null; competition_name: string; phase_name: string; totalVotes: number | null; candidates: Candidate[] };
type Snapshot = { competitions: { id: string; name: string; season_name: string }[]; phases: Phase[]; scopes: Scope[];
  occupiedScopes: OccupiedScope[]; contests: Contest[] };
type Eligible = { playerId: string; player: { displayName: string }; teamName: string; statistics: { efficiency: number } };
type Preview = { suggested: Eligible[]; eligible: Eligible[] };
type View = "new" | "active" | "history";
const panel = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const field = "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950";
const action = "rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50";
const date = (seconds: number | null) => seconds ? new Date(seconds * 1000).toLocaleString("el-GR") : "—";
const deadline = (value: string) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
const errorLabels: Record<string, string> = {
  CONTEST_CONFLICT: "Υπάρχει ήδη MVP για αυτή την αγωνιστική ή σειρά.",
  OFFICIAL_MVP_EXISTS: "Υπάρχει ήδη επίσημο MVP για αυτή την αγωνιστική.",
  SCOPE_INCOMPLETE: "Η αγωνιστική ή σειρά δεν έχει ολοκληρωθεί.",
  SCOPE_NOT_FOUND: "Δεν βρέθηκε διαθέσιμη αγωνιστική ή σειρά.",
  EVIDENCE_REVIEW_REQUIRED: "Τα στοιχεία αγώνων χρειάζονται έλεγχο.",
  NO_ELIGIBLE_PLAYERS: "Δεν υπάρχουν επιλέξιμοι παίκτες.",
  INVALID_INPUT: "Ελέγξτε τα στοιχεία και δοκιμάστε ξανά.",
  CONTEST_NOT_FOUND: "Δεν βρέθηκε η ψηφοφορία MVP.",
  CONTEST_NOT_OPEN: "Η ψηφοφορία MVP έχει κλείσει.",
  INVALID_RESOLUTION: "Ελέγξτε τον νικητή και την αιτιολογία.",
  ALREADY_FINALIZED: "Το MVP έχει ήδη οριστικοποιηθεί.",
  CONFLICT: "Η ενέργεια συγκρούεται με νεότερη αλλαγή. Ανανεώστε τη σελίδα.",
  DATABASE_UNAVAILABLE: "Η βάση δεδομένων δεν είναι προσωρινά διαθέσιμη.",
};
const asError = (value: unknown) => {
  const message = value instanceof Error ? value.message : "Η ενέργεια δεν ολοκληρώθηκε.";
  return errorLabels[message] ?? message;
};
export const statusLabel = (status: string) => ({ open: "Ανοιχτή", tie_requires_resolution: "Ισοψηφία προς επίλυση",
  needs_operator_decision: "Αναμονή απόφασης διαχειριστή", finalized: "Οριστικοποιημένη" })[status as "open" | "tie_requires_resolution" | "needs_operator_decision" | "finalized"] ?? "Άγνωστη κατάσταση";
export const seriesLabel = (scope: Scope | undefined) => {
  const home = scope?.home_team_name?.trim() || "Αναμονή ομάδας";
  const away = scope?.away_team_name?.trim() || "Αναμονή ομάδας";
  return `${scope?.round_label ? `${scope.round_label} · ` : ""}${home} – ${away}`;
};
const contestScopeLabel = (contest: Contest, scopes: Scope[]) => contest.scope_type === "round"
  ? `Αγωνιστική ${contest.round_number}`
  : `Σειρά · ${seriesLabel(scopes.find((scope) => scope.phase_id === contest.phase_id && scope.series_matchup_id === contest.matchup_id))}`;
export const hasContest = (item: Scope, format: Phase["format"], occupied: OccupiedScope[]) => occupied.some((existing) =>
  existing.phase_id === item.phase_id && (format === "standings"
    ? existing.scope_type === "round" && existing.round_number === item.round_number
    : existing.scope_type === "series" && existing.matchup_id === item.series_matchup_id));

export default function PlatformMvpManagement({ organizationId, readOnly = false }: { organizationId: string; readOnly?: boolean }) {
  const api = usePlatformContext();
  const canManage = api.canManage && !readOnly;
  const [view, setView] = useState<View>("new");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [tournamentId, setTournamentId] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState("48");
  const [explicitClose, setExplicitClose] = useState("");
  const [visibility, setVisibility] = useState<"live" | "after_close">("after_close");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const read = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api.request(`/api/admin/mvp?organizationId=${encodeURIComponent(organizationId)}`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Η φόρτωση MVP απέτυχε.");
      setSnapshot(value as Snapshot);
    } catch (caught) { setError(asError(caught)); }
    finally { setLoading(false); }
  }, [api, organizationId]);
  useEffect(() => { const timer = window.setTimeout(() => void read(), 0); return () => window.clearTimeout(timer); }, [read]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setNotice(""); setCompetitionId(""); setTournamentId(""); setPhaseId(""); setScopeKey(""); setPreview(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [organizationId]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30000); return () => window.clearInterval(timer); }, []);

  const phases = useMemo(() => snapshot?.phases.filter((phase) => phase.competition_id === competitionId) ?? [], [snapshot, competitionId]);
  const tournaments = useMemo(() => [...new Map(phases.map((phase) => [phase.tournamentId, { id: phase.tournamentId, name: phase.tournamentName }])).values()], [phases]);
  const visiblePhases = phases.filter((phase) => phase.tournamentId === tournamentId);
  const phase = visiblePhases.find((item) => item.id === phaseId);
  const scopes = (snapshot?.scopes ?? []).filter((item) => item.phase_id === phaseId &&
    (phase?.format === "standings" ? item.round_number !== null : item.series_matchup_id !== null));
  const scopeValue = (item: Scope) => phase?.format === "standings" ? `round:${item.round_number}` : `series:${item.series_matchup_id}`;
  const scope = scopes.find((item) => scopeValue(item) === scopeKey);
  const scopeOccupied = Boolean(scope && phase && hasContest(scope, phase.format, snapshot?.occupiedScopes ?? []));
  const scopeInput = () => phase?.format === "standings"
    ? { phaseId, scopeType: "round", roundNumber: scope?.round_number }
    : { phaseId, scopeType: "series", matchupId: scope?.series_matchup_id };

  async function mutate(method: "POST" | "PATCH", input: Record<string, unknown>, message: string) {
    if (!canManage || busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await api.request("/api/admin/mvp", { method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, organizationId }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Η ενέργεια απέτυχε.");
      setNotice(message); await read(); return true;
    } catch (caught) { setError(asError(caught)); return false; }
    finally { setBusy(false); }
  }
  async function loadPreview() {
    if (!scope || !phase?.mvp_enabled || scopeOccupied) return;
    setBusy(true); setError(""); setPreview(null); setSelected([]);
    try {
      const query = new URLSearchParams({ organizationId, action: "preview", phaseId, scopeType: phase.format === "standings" ? "round" : "series" });
      if (phase.format === "standings") query.set("roundNumber", String(scope.round_number));
      else query.set("matchupId", String(scope.series_matchup_id));
      const response = await api.request(`/api/admin/mvp?${query}`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Οι προτάσεις δεν είναι διαθέσιμες.");
      setPreview(value as Preview); setSelected((value as Preview).suggested.map((candidate) => candidate.playerId));
    } catch (caught) { setError(asError(caught)); }
    finally { setBusy(false); }
  }
  async function start() {
    if (!scope || !selected.length || !phase?.mvp_enabled || scopeOccupied) return;
    const closesAt = explicitClose ? deadline(explicitClose) : undefined;
    if (!window.confirm(`Έναρξη ψηφοφορίας MVP με ${selected.length} υποψηφίους; Η ενέργεια δεν αναιρείται.`)) return;
    const ok = await mutate("POST", { action: "start", ...scopeInput(), candidatePlayerIds: selected,
      ...(closesAt ? { closesAt } : { durationHours: Number(duration) }), resultsVisibility: visibility }, "Η ψηφοφορία MVP ξεκίνησε.");
    if (ok) { setView("active"); setPreview(null); setSelected([]); }
  }
  const active = snapshot?.contests.filter((contest) => contest.status !== "finalized") ?? [];
  const history = snapshot?.contests.filter((contest) => contest.status === "finalized") ?? [];

  return <div className="space-y-5">
    <div className={panel}><h2 className="text-2xl font-black">MVP</h2><p className="mt-1 text-sm text-zinc-600">Δημιουργία και διαχείριση ψηφοφοριών ανά οργανισμό.</p>
      <div className="mt-4 flex flex-wrap gap-2">{([["new", "Νέα ψηφοφορία"], ["active", "Ενεργές"], ["history", "Ιστορικό"]] as const).map(([id, label]) =>
        <button key={id} type="button" onClick={() => { setView(id); setNotice(""); }} aria-current={view === id ? "page" : undefined}
          className={`rounded-xl px-4 py-2 text-sm font-black ${view === id ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700"}`}>{label}</button>)}</div>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 font-bold text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</p>}
    {loading && <p className="text-sm text-zinc-500">Φόρτωση MVP…</p>}
    {view === "new" && snapshot && <>
      <section className={panel}><h3 className="text-lg font-black">Επιλογή διοργάνωσης και θεσμού</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-bold">Διοργάνωση<select className={field} value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); setTournamentId(""); setPhaseId(""); setScopeKey(""); setPreview(null); setNotice(""); }}><option value="">Επιλέξτε διοργάνωση</option>{snapshot.competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.season_name} · {competition.name}</option>)}</select></label>
          <label className="text-sm font-bold">Θεσμός<select className={field} value={tournamentId} disabled={!competitionId} onChange={(event) => { setTournamentId(event.target.value); setPhaseId(""); setScopeKey(""); setPreview(null); setNotice(""); }}><option value="">Επιλέξτε θεσμό</option>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}</select></label>
        </div>
      </section>
      {tournamentId && <section className={panel}><h3 className="text-lg font-black">Φάσεις MVP</h3><p className="mt-1 text-sm text-zinc-600">Η απενεργοποίηση δεν επιτρέπεται όσο υπάρχει ανοιχτή ψηφοφορία.</p>
        <div className="mt-3 space-y-2">{visiblePhases.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3"><span className="font-bold">{item.name} · {item.format === "standings" ? "Αγωνιστική" : "Σειρά"}</span><PlatformButton mutation type="button" disabled={busy || !canManage} onClick={() => void mutate("PATCH", { action: "phase", phaseId: item.id, enabled: item.mvp_enabled !== 1 }, "Η ρύθμιση MVP ενημερώθηκε.")} className={action}>{item.mvp_enabled === 1 ? "Απενεργοποίηση" : "Ενεργοποίηση"}</PlatformButton></div>)}</div>
      </section>}
      {tournamentId && <section className={panel}><h3 className="text-lg font-black">Νέα ψηφοφορία</h3><div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-bold">Φάση<select className={field} value={phaseId} onChange={(event) => { setPhaseId(event.target.value); setScopeKey(""); setPreview(null); setNotice(""); }}><option value="">Επιλέξτε φάση</option>{visiblePhases.map((item) => <option key={item.id} value={item.id}>{item.name}{item.mvp_enabled !== 1 ? " · MVP εκτός" : ""}</option>)}</select></label>
        <label className="text-sm font-bold">{phase?.format === "series" ? "Σειρά" : "Αγωνιστική"}<select className={field} value={scopeKey} disabled={!phaseId} onChange={(event) => { setScopeKey(event.target.value); setPreview(null); setNotice(""); }}><option value="">Επιλέξτε</option>{scopes.map((item) => <option key={scopeValue(item)} value={scopeValue(item)} disabled={phase ? hasContest(item, phase.format, snapshot.occupiedScopes) : false}>{phase?.format === "standings" ? item.round_label || `Αγωνιστική ${item.round_number}` : `Σειρά · ${seriesLabel(item)}`}{phase && hasContest(item, phase.format, snapshot.occupiedScopes) ? " · Ήδη υπάρχει MVP" : ""}</option>)}</select></label>
      </div>{phase && phase.mvp_enabled !== 1 && <p className="mt-3 text-sm font-bold text-amber-700">Ενεργοποιήστε MVP για τη φάση πριν συνεχίσετε.</p>}
      {scopeOccupied && <p className="mt-3 text-sm font-bold text-amber-700">Ήδη υπάρχει MVP για αυτή την αγωνιστική ή σειρά.</p>}
      <PlatformButton mutation type="button" disabled={busy || !canManage || !scope || !phase?.mvp_enabled || scopeOccupied} onClick={() => void loadPreview()} className={`${action} mt-4`}>Προτεινόμενοι υποψήφιοι</PlatformButton>
      {preview && <div className="mt-5 space-y-4"><div><h4 className="font-black">Τελικοί υποψήφιοι</h4><p className="text-sm text-zinc-600">Οι πέντε πρώτοι προτείνονται αυτόματα. Αλλάξτε τη λίστα πριν από την έναρξη.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{preview.eligible.map((candidate) => <label key={candidate.playerId} className="flex items-center gap-2 rounded-xl border border-zinc-200 p-3 text-sm"><input type="checkbox" checked={selected.includes(candidate.playerId)} disabled={!canManage} onChange={(event) => setSelected((current) => event.target.checked ? [...current, candidate.playerId] : current.filter((id) => id !== candidate.playerId))}/><span>{candidate.player.displayName} · {candidate.teamName} · EFF {candidate.statistics.efficiency}</span></label>)}</div></div>
        <div className="grid gap-3 md:grid-cols-3"><label className="text-sm font-bold">Διάρκεια (ώρες)<input className={field} type="number" min="1" max="168" value={duration} disabled={Boolean(explicitClose)} onChange={(event) => setDuration(event.target.value)}/></label><label className="text-sm font-bold">Ή ακριβές κλείσιμο<input className={field} type="datetime-local" value={explicitClose} onChange={(event) => setExplicitClose(event.target.value)}/></label><label className="text-sm font-bold">Αποτελέσματα<select className={field} value={visibility} onChange={(event) => setVisibility(event.target.value as "live" | "after_close")}><option value="after_close">Μετά το κλείσιμο</option><option value="live">Ζωντανά</option></select></label></div>
        <PlatformButton mutation type="button" className={action} disabled={busy || !canManage || !selected.length || selected.length > 32 || scopeOccupied} onClick={() => void start()}>Έναρξη ψηφοφορίας MVP</PlatformButton>
      </div>}
      </section>}
    </>}
    {view === "active" && <section className={panel}><h3 className="text-lg font-black">Ενεργές και προς επίλυση</h3>{active.length === 0 && <p className="mt-3 text-sm text-zinc-600">Δεν υπάρχουν ψηφοφορίες.</p>}{active.map((contest) =>
      <ContestCard key={contest.id} contest={contest} scopes={snapshot?.scopes ?? []} now={now} canManage={canManage} busy={busy} organizationId={organizationId} request={api.request} mutate={mutate}/>)}</section>}
    {view === "history" && <section className={panel}><h3 className="text-lg font-black">Ιστορικό MVP</h3>{history.length === 0 && <p className="mt-3 text-sm text-zinc-600">Δεν υπάρχουν ολοκληρωμένες ψηφοφορίες.</p>}{history.map((contest) => <article key={contest.id} className="mt-3 rounded-xl border border-zinc-200 p-4"><p className="font-black">{contest.competition_name} · {contest.phase_name} · {contestScopeLabel(contest, snapshot?.scopes ?? [])}</p><p className="mt-1 text-sm">Νικητής: {contest.candidates.find((candidate) => candidate.player_id === contest.winner_player_id)?.player_name ?? "—"} · {contest.candidates.find((candidate) => candidate.player_id === contest.winner_player_id)?.team_name ?? "—"}</p><p className="text-sm text-zinc-600">Μέθοδος: {contest.selection_method === "manual" ? "χειροκίνητη" : "ψηφοφορία εφαρμογής"} · Κατάσταση: {statusLabel(contest.status)} · Κλείσιμο: {date(contest.closes_at)} · Οριστικοποίηση: {date(contest.finalized_at)}</p></article>)}</section>}
  </div>;
}

function ContestCard({ contest, scopes, now, canManage, busy, organizationId, request, mutate }: {
  contest: Contest; scopes: Scope[]; now: number; canManage: boolean; busy: boolean; organizationId: string; request: typeof fetch;
  mutate: (method: "POST" | "PATCH", input: Record<string, unknown>, message: string) => Promise<boolean>;
}) {
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [close, setClose] = useState("");
  const [reason, setReason] = useState("");
  const [resolutionId, setResolutionId] = useState("");
  const open = contest.status === "open" && contest.closes_at > now;
  const maxVotes = Math.max(0, ...contest.candidates.map((candidate) => Number(candidate.votes)));
  const choices = contest.status === "tie_requires_resolution" ? contest.candidates.filter((candidate) => Number(candidate.votes) === maxVotes && maxVotes > 0) : contest.candidates;
  async function suggestions() {
    const query = new URLSearchParams({ organizationId, action: "preview", phaseId: contest.phase_id, scopeType: contest.scope_type });
    if (contest.scope_type === "round") query.set("roundNumber", String(contest.round_number)); else query.set("matchupId", String(contest.matchup_id));
    const response = await request(`/api/admin/mvp?${query}`);
    if (!response.ok) return;
    const value = await response.json() as Preview;
    setEligible(value.eligible.filter((candidate) => !contest.candidates.some((existing) => existing.player_id === candidate.playerId)));
  }
  return <article className="mt-4 space-y-3 rounded-xl border border-zinc-200 p-4"><div className="flex flex-wrap justify-between gap-2"><div><h4 className="font-black">{contest.competition_name} · {contest.phase_name}</h4><p className="text-sm text-zinc-600">{contestScopeLabel(contest, scopes)} · {statusLabel(contest.status)}</p></div><p className="text-sm font-bold">{open ? `${Math.max(0, Math.ceil((contest.closes_at - now) / 60))} λεπτά απομένουν` : "Έκλεισε"}</p></div>
    <p className="text-sm">Κλείσιμο: {date(contest.closes_at)} · Ψήφοι: {contest.totalVotes ?? "μόνο για διαχειριστές"} · Αποτελέσματα: {contest.results_visibility === "live" ? "ζωντανά" : "μετά το κλείσιμο"}</p>
    <ul className="list-inside list-disc text-sm">{contest.candidates.map((candidate) => <li key={candidate.id}>{candidate.player_name} · {candidate.team_name}{candidate.votes === null ? "" : ` · ${candidate.votes} ψήφοι`}</li>)}</ul>
    {open && canManage && <div className="grid gap-3 border-t border-zinc-200 pt-3 md:grid-cols-2"><div className="space-y-2"><PlatformButton mutation type="button" disabled={busy} onClick={() => void suggestions()} className={action}>Προσθήκη υποψηφίου</PlatformButton>{eligible.length > 0 && <><select className={field} value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Επιλέξτε επιλέξιμο παίκτη</option>{eligible.map((candidate) => <option key={candidate.playerId} value={candidate.playerId}>{candidate.player.displayName} · {candidate.teamName}</option>)}</select><PlatformButton mutation type="button" disabled={busy || !candidateId} className={action} onClick={() => void mutate("PATCH", { action: "candidate", contestId: contest.id, playerId: candidateId }, "Ο υποψήφιος προστέθηκε με μηδέν ψήφους.")}>Προσθήκη</PlatformButton></>}</div>
      <div className="space-y-2"><label className="text-sm font-bold">Νέο κλείσιμο<input className={field} type="datetime-local" value={close} onChange={(event) => setClose(event.target.value)}/></label><PlatformButton mutation type="button" disabled={busy || !close} className={action} onClick={() => void mutate("PATCH", { action: "settings", contestId: contest.id, closesAt: deadline(close) }, "Η ώρα κλεισίματος ενημερώθηκε.")}>Αλλαγή κλεισίματος</PlatformButton></div>
      <div className="md:col-span-2"><PlatformButton mutation type="button" disabled={busy} className={action} onClick={() => { if (contest.results_visibility === "live" && !window.confirm("Τα ήδη δημοσιευμένα ζωντανά αποτελέσματα δεν μπορούν να ανακληθούν. Συνέχεια;")) return; void mutate("PATCH", { action: "settings", contestId: contest.id, resultsVisibility: contest.results_visibility === "live" ? "after_close" : "live" }, "Η προβολή αποτελεσμάτων ενημερώθηκε."); }}>Αλλαγή σε {contest.results_visibility === "live" ? "μετά το κλείσιμο" : "ζωντανά"}</PlatformButton></div></div>}
    {(contest.status === "tie_requires_resolution" || contest.status === "needs_operator_decision") && canManage && <div className="grid gap-2 border-t border-zinc-200 pt-3 sm:grid-cols-2"><p className="font-bold sm:col-span-2">{contest.status === "tie_requires_resolution" ? "Ισοψηφία πρώτης θέσης" : "Χωρίς ψήφους"} · Επιλέξτε νικητή και αιτιολογία.</p><select className={field} value={resolutionId} onChange={(event) => setResolutionId(event.target.value)}><option value="">Επιλέξτε υποψήφιο</option>{choices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.player_name} · {candidate.team_name}</option>)}</select><input className={field} value={reason} maxLength={1000} placeholder="Αιτιολογία" onChange={(event) => setReason(event.target.value)}/><PlatformButton mutation type="button" disabled={busy || !resolutionId || !reason.trim()} className={action} onClick={() => void mutate("PATCH", { action: "resolve", contestId: contest.id, candidateId: resolutionId, reason }, "Ο νικητής οριστικοποιήθηκε.")}>Οριστικοποίηση MVP</PlatformButton></div>}
  </article>;
}
