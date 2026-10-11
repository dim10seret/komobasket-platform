"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { readPublicMvpContestsWithDb } from "@/services/public-mvp-contests.service";

type Feed = Awaited<ReturnType<typeof readPublicMvpContestsWithDb>>;
type Contest = Feed["active"][number];
type AuthState = "loading" | "anonymous" | "signed-in" | "unavailable";

export function remainingSeconds(nowMs: number, closesAt: number): number {
  return Math.max(0, Math.ceil((closesAt * 1000 - nowMs) / 1000));
}

export function conservativeClockOffset(serverTime: number, requestStartedAt: number): number {
  return (serverTime + 1) * 1000 - requestStartedAt;
}

export function countdownLabel(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return days ? `${days}η ${hours}ω ${minutes}λ` : `${hours}ω ${minutes}λ ${rest}δ`;
}

export function googleLoginHref(path: string): string {
  return `/api/public/v1/mvp-google-auth/start?${new URLSearchParams({ returnTo: path })}`;
}

function formatDate(seconds: number): string {
  return new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Athens" })
    .format(new Date(seconds * 1000));
}

function performanceStats(values: Contest["candidates"][number]["performance"]) {
  return (["points", "rebounds", "assists", "efficiency"] as const).map((key) => ({
    label: { points: "PTS", rebounds: "REB", assists: "AST", efficiency: "EFF" }[key],
    value: values[key],
  }));
}

export default function MvpVotingPage({ initialContest, initialServerTime, competitionId, rootPhaseId,
  competitionName, tournamentName, authEnabled, votingEnabled }: {
  initialContest: Contest; initialServerTime: number; competitionId: string; rootPhaseId: string;
  competitionName: string; tournamentName: string; authEnabled: boolean; votingEnabled: boolean;
}) {
  const [contest, setContest] = useState(initialContest);
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(initialServerTime * 1000);
  const [clockReady, setClockReady] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const ready = authEnabled && votingEnabled;
  const [auth, setAuth] = useState<AuthState>(ready ? "loading" : "unavailable");
  const [csrf, setCsrf] = useState("");
  const [ballotId, setBallotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const closedRefresh = useRef(false);
  const path = `/mvp/competitions/${competitionId}/tournaments/${rootPhaseId}/contests/${contest.id}`;
  const feedPath = `/api/public/v1/competitions/${competitionId}/tournaments/${rootPhaseId}/mvp`;
  const seconds = remainingSeconds(nowMs, contest.closesAt);
  const open = contest.status === "open" && nowMs >= contest.opensAt * 1000 && seconds > 0;
  const canVote = open && clockReady;
  const winner = contest.official?.winner;

  const refreshPoll = useCallback(async () => {
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(feedPath, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload: { data?: Feed } = await response.json();
      const current = [...(payload.data?.active ?? []), ...(payload.data?.history ?? [])]
        .find((item) => item.id === initialContest.id);
      if (!current || typeof payload.data?.serverTime !== "number") throw new Error();
      setContest(current);
      // D1's integer second was observed after request start. Its next-second
      // boundary gives a conservative clock bound; the UI can close early,
      // while the guarded D1 insert remains the final deadline authority.
      const conservativeOffset = conservativeClockOffset(payload.data.serverTime, requestStartedAt);
      setOffsetMs(conservativeOffset);
      setNowMs(performance.now() + conservativeOffset);
      setClockReady(true);
    } catch { setError("Δεν ήταν δυνατή η ανανέωση της ψηφοφορίας. Δοκιμάστε ξανά."); }
  }, [feedPath, initialContest.id]);

  const readMyVote = useCallback(async (): Promise<string | null> => {
    const response = await fetch(`/api/public/v1/mvp-google-votes/me?${new URLSearchParams({ contestId: initialContest.id })}`,
      { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    const payload: { data?: { voted?: boolean; candidateId?: string | null } } = await response.json();
    if (!payload.data || typeof payload.data.voted !== "boolean") throw new Error();
    const candidateId = payload.data.voted ? payload.data.candidateId ?? null : null;
    setBallotId(candidateId);
    if (candidateId) setSelectedId(candidateId);
    setUncertain(false);
    return candidateId;
  }, [initialContest.id]);

  useEffect(() => {
    if (offsetMs === null) return;
    const timer = window.setInterval(() => setNowMs(performance.now() + offsetMs), 1000);
    return () => window.clearInterval(timer);
  }, [offsetMs]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshPoll(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshPoll]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/public/v1/mvp-google-auth/session", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error();
        const data: { authenticated?: boolean; csrfToken?: string } = await response.json();
        if (typeof data.authenticated !== "boolean") throw new Error();
        if (cancelled) return;
        setAuth(data.authenticated ? "signed-in" : "anonymous");
        setCsrf(data.csrfToken ?? "");
        if (data.authenticated) await readMyVote();
      } catch { if (!cancelled) setAuth("unavailable"); }
    })();
    return () => { cancelled = true; };
  }, [ready, readMyVote]);

  useEffect(() => {
    if (contest.status !== "open" || seconds > 0 || closedRefresh.current) return;
    closedRefresh.current = true;
    void refreshPoll();
  }, [contest.status, seconds, refreshPoll]);

  function select(candidateId: string) {
    setSelectedId(candidateId);
    setConfirming(false);
    setError("");
  }

  async function submit() {
    if (!canVote || !ready || auth !== "signed-in" || !csrf || !selectedId || busy || ballotId || uncertain) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/public/v1/mvp-google-votes", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-kb-mvp-csrf": csrf },
        body: JSON.stringify({ contestId: contest.id, candidateId: selectedId }),
      });
      const payload: { data?: { candidateId?: string; alreadyVoted?: boolean }; error?: { code?: string } } = await response.json();
      if (response.ok && payload.data?.candidateId === selectedId) {
        setBallotId(selectedId);
        setMessage(payload.data.alreadyVoted ? "Η ψήφος σας είχε ήδη καταχωριστεί." : "Η ψήφος σας καταχωρίστηκε.");
      } else {
        const actual = await readMyVote();
        if (actual) setMessage("Έχετε ήδη ψηφίσει σε αυτή την ψηφοφορία.");
        else setError(payload.error?.code === "CONTEST_UNAVAILABLE" ? "Η ψηφοφορία δεν είναι πλέον διαθέσιμη." :
          "Η ψήφος δεν καταχωρίστηκε. Ελέγξτε την κατάσταση και δοκιμάστε ξανά.");
      }
    } catch {
      try {
        const actual = await readMyVote();
        if (actual) setMessage("Η ψήφος σας έχει καταχωριστεί.");
        else setError("Δεν επιβεβαιώθηκε η ψήφος. Δοκιμάστε ξανά.");
      } catch { setUncertain(true); setError("Δεν μπορέσαμε να ελέγξουμε την ψήφο σας. Ανανεώστε την κατάσταση πριν ξαναδοκιμάσετε."); }
    } finally { setBusy(false); setConfirming(false); void refreshPoll(); }
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 text-zinc-950 sm:py-12">
    <div className="mx-auto max-w-4xl px-4 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">KomoBasket · MVP</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Ψηφοφορία MVP</h1>
      <p className="mt-3 text-base font-semibold text-zinc-600">{competitionName} · {tournamentName}</p>
      <section className="mt-7 rounded-3xl border border-zinc-200 bg-white p-5 shadow-lg sm:p-8" aria-label="Πληροφορίες ψηφοφορίας">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-widest text-orange-700">{contest.scopeType === "round" ? "Αγωνιστική" : "Σειρά"}</p>
            <h2 className="mt-1 text-2xl font-black">{contest.scopeType === "round" ? `MVP ${contest.roundNumber}ης αγωνιστικής` : "MVP σειράς"}</h2></div>
          <span className="rounded-full bg-orange-100 px-4 py-2 text-sm font-black text-orange-800">{contest.status === "finalized" ? "Οριστικό" : open ? "Ανοιχτή" : contest.status === "open" && nowMs < contest.opensAt * 1000 ? "Δεν έχει ανοίξει" : "Έκλεισε"}</span>
        </div>
        <p className="mt-4 text-sm font-semibold text-zinc-600">Λήξη: <time dateTime={new Date(contest.closesAt * 1000).toISOString()}>{formatDate(contest.closesAt)}</time></p>
        {open ? <p className="mt-2 font-black tabular-nums text-orange-700" role="timer">Απομένουν {countdownLabel(seconds)}</p> : null}
        {!clockReady && open ? <p className="mt-2 text-sm font-semibold text-zinc-600">Συγχρονισμός ώρας ψηφοφορίας…</p> : null}
        {contest.status === "tie_requires_resolution" || contest.status === "needs_operator_decision"
          ? <p className="mt-4 rounded-xl bg-amber-50 p-4 font-bold text-amber-900">Αναμένεται η επίσημη απόφαση για το MVP.</p> : null}
      </section>

      {contest.status === "finalized" && contest.official ? <section className="mt-6 rounded-3xl border-2 border-orange-300 bg-orange-50 p-5 sm:p-8" aria-label="Επίσημο MVP">
        <p className="text-xs font-black uppercase tracking-widest text-orange-700">Επίσημο MVP</p>
        {winner ? <><h2 className="mt-2 text-3xl font-black">{winner.playerName}</h2><p className="font-bold text-zinc-700">{winner.teamName}</p>
          <div className="mt-5 grid grid-cols-4 gap-2">{performanceStats(winner.performance).map((item) => <div key={item.label} className="rounded-xl bg-white p-2 text-center"><span className="block text-xs font-bold">{item.label}</span><strong>{item.value}</strong></div>)}</div></> : null}
        {contest.official.photoUrl ? <figure className="mt-5"><Image src={contest.official.photoUrl} alt={winner ? `Φωτογραφία ${winner.playerName}` : "Φωτογραφία MVP"} width={1200} height={800} unoptimized className="max-h-[32rem] w-full rounded-xl object-contain" />{contest.official.photoCaption ? <figcaption className="mt-2 text-sm text-zinc-600">{contest.official.photoCaption}</figcaption> : null}</figure> : null}
        {contest.official.bodyText ? <p className="mt-5 whitespace-pre-wrap text-zinc-800">{contest.official.bodyText}</p> : null}
        {contest.official.sponsorName ? <p className="mt-4 font-semibold">Χορηγός: {contest.official.sponsorName}</p> : null}
        {contest.official.giftDescription ? <p className="mt-1 font-semibold">Δώρο: {contest.official.giftDescription}</p> : null}
      </section> : null}

      <section className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-lg sm:p-8" aria-labelledby="candidate-heading">
        <h2 id="candidate-heading" className="text-2xl font-black">Υποψήφιοι</h2>
        {contest.resultsVisibility === "hidden" ? <p className="mt-2 text-sm font-semibold text-zinc-600">Τα αποτελέσματα θα εμφανιστούν μετά την ολοκλήρωση.</p> : null}
        <fieldset className="mt-5 space-y-3" disabled={!canVote || !ready || Boolean(ballotId) || busy}>
          <legend className="sr-only">Επιλέξτε έναν υποψήφιο</legend>
          {contest.candidates.map((candidate) => <label key={candidate.id} className={`flex min-h-24 cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition sm:p-5 ${selectedId === candidate.id ? "border-orange-500 bg-orange-50" : "border-zinc-200 hover:border-orange-300"}`}>
            <input type="radio" name="mvp-candidate" value={candidate.id} checked={selectedId === candidate.id} onChange={() => select(candidate.id)} className="mt-1 h-5 w-5 shrink-0 accent-orange-600" />
            <span className="min-w-0 flex-1"><strong className="block text-lg">{candidate.playerName}</strong><span className="block text-sm font-semibold text-zinc-600">{candidate.teamName}</span>
              <span className="mt-3 grid grid-cols-4 gap-2">{performanceStats(candidate.performance).map((item) => <span key={item.label} className="rounded-lg bg-zinc-100 px-2 py-1 text-center"><span className="block text-[10px] font-bold">{item.label}</span><strong className="text-sm">{item.value}</strong></span>)}</span>
              {contest.resultsVisibility === "visible" && candidate.votes !== null ? <span className="mt-2 block text-sm font-bold text-orange-800">{candidate.votes} ψήφοι</span> : null}</span>
          </label>)}
        </fieldset>
        {contest.resultsVisibility === "visible" && contest.totalVotes !== null ? <p className="mt-4 font-bold text-zinc-600">Σύνολο ψήφων: {contest.totalVotes}</p> : null}
        {ballotId ? <p className="mt-5 rounded-xl bg-emerald-50 p-4 font-bold text-emerald-900" role="status">Έχετε ήδη ψηφίσει. Η ψήφος δεν μπορεί να αλλάξει.</p> : null}
        {!ready && open ? <p className="mt-5 rounded-xl bg-zinc-100 p-4 font-semibold" role="status">Η ψηφοφορία δεν είναι διαθέσιμη αυτή τη στιγμή.</p> : null}
        {ready && open && auth === "anonymous" ? <div className="mt-5 space-y-3"><p className="font-semibold">Συνδεθείτε με Google για να ψηφίσετε. Μετά τη σύνδεση επιλέξτε ξανά υποψήφιο και επιβεβαιώστε την ψήφο σας.</p><a href={googleLoginHref(path)} className="inline-flex min-h-12 items-center rounded-xl bg-zinc-950 px-5 py-3 font-black text-white hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">Σύνδεση με Google</a></div> : null}
        {ready && open && auth === "signed-in" && !ballotId ? <div className="mt-5">
          {!confirming ? <button type="button" disabled={!canVote || !selectedId || busy || !csrf || uncertain} onClick={() => setConfirming(true)} className="min-h-12 rounded-xl bg-orange-600 px-6 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-50">Συνέχεια</button>
            : <div className="rounded-xl border border-orange-300 bg-orange-50 p-4"><p className="font-bold">Επιβεβαίωση ψήφου: {contest.candidates.find((candidate) => candidate.id === selectedId)?.playerName}</p><p className="mt-1 text-sm">Η ψήφος σας δεν αλλάζει μετά την καταχώριση.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void submit()} className="min-h-12 rounded-xl bg-orange-600 px-5 py-3 font-black text-white disabled:opacity-50">{busy ? "Καταχώριση…" : "Επιβεβαίωση ψήφου"}</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-12 rounded-xl border border-zinc-300 px-5 py-3 font-bold">Αλλαγή επιλογής</button></div></div>}
        </div> : null}
        {ready && open && auth === "unavailable" ? <p className="mt-5 font-semibold text-zinc-700">Η σύνδεση δεν είναι διαθέσιμη. Δοκιμάστε ξανά αργότερα.</p> : null}
        {message ? <p className="mt-4 rounded-xl bg-emerald-50 p-4 font-bold text-emerald-900" role="status">{message}</p> : null}
        {error ? <p className="mt-4 rounded-xl bg-red-50 p-4 font-bold text-red-900" role="alert">{error}</p> : null}
        <button type="button" onClick={() => { void refreshPoll(); if (auth === "signed-in") void readMyVote(); }} className="mt-5 min-h-11 text-sm font-bold text-orange-800 underline">Ανανέωση κατάστασης</button>
      </section>
    </div>
  </main>;
}
