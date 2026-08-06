"use client";

import Link from "next/link";
import {
  CalendarDays,
  Database,
  FileText,
  LayoutDashboard,
  ListTree,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import NewsManager from "@/components/admin/NewsManager";

type Row = Record<string, string | number | null>;
type Snapshot = {
  mode: "preview" | "database";
  seasons: Row[]; competitions: Row[]; teams: Row[]; players: Row[];
  participations: Row[]; rosters: Row[]; movements: Row[]; phases: Row[]; games: Row[];
  counts: { seasons:number; competitions:number; teams:number; players:number };
};

const tabs = [
  ["overview", "Επισκόπηση", LayoutDashboard],
  ["news", "Νέα", FileText],
  ["seasons", "Σεζόν & διοργανώσεις", Trophy],
  ["teams", "Ομάδες & συμμετοχές", ShieldCheck],
  ["players", "Παίκτες & ρόστερ", UsersRound],
  ["movements", "Μεταγραφές & αποχωρήσεις", UserRoundCog],
  ["schedule", "Πρόγραμμα & αγώνες", CalendarDays],
  ["migration", "Μεταφορά παλιών δεδομένων", Database],
] as const;

function Field({ label, children }: { label:string; children:ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-bold text-zinc-700"><span>{label}</span>{children}</label>;
}

const inputClass = "rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-zinc-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100";
const buttonClass = "rounded-xl bg-orange-600 px-4 py-2.5 font-black text-white transition hover:bg-orange-700 disabled:opacity-50";

function Panel({ title, description, children }: { title:string; description?:string; children:ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
    <h2 className="text-xl font-black text-zinc-950">{title}</h2>
    {description && <p className="mt-1 text-sm text-zinc-600">{description}</p>}
    <div className="mt-5">{children}</div>
  </section>;
}

function SimpleTable({ rows, columns, empty="Δεν υπάρχουν ακόμη εγγραφές." }: { rows:Row[]; columns:[string,string][]; empty?:string }) {
  if (!rows.length) return <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">{empty}</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
    <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500"><tr>{columns.map(([key,label]) => <th key={key} className="px-3 py-3">{label}</th>)}</tr></thead>
    <tbody>{rows.map((row,index) => <tr key={String(row.id ?? index)} className="border-b border-zinc-100 last:border-0">{columns.map(([key]) => <td key={key} className="px-3 py-3 text-zinc-700">{String(row[key] ?? "—")}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default function AdminDashboard() {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("overview");
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/league", { cache:"no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Αποτυχία φόρτωσης.");
      setData(payload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(request);
  }, [load]);

  async function create(resource:string, input:Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/league/${resource}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(input) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποθήκευση απέτυχε.");
      setNotice(payload.automaticallyMatched ? "Ο παίκτης αναγνωρίστηκε και ενώθηκε αυτόματα με την υπάρχουσα εγγραφή." : "Η εγγραφή αποθηκεύτηκε.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Η αποθήκευση απέτυχε."); }
    finally { setBusy(false); }
  }

  async function submit(resource:string, event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await create(resource, Object.fromEntries(form.entries()));
    event.currentTarget.reset();
  }

  async function migrate() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/league", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"migrate-history"}) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η μεταφορά απέτυχε.");
      setNotice(`Η μεταφορά ολοκληρώθηκε: ${payload.total} συμμετοχές παικτών, ${payload.created} νέοι παίκτες, ${payload.automaticallyMerged} αυτόματες αντιστοιχίσεις, ${payload.historicalPhases} φάσεις και ${payload.historicalGames} αγώνες. Παραλείφθηκαν ${payload.skippedGames} εγγραφές χωρίς επαρκή στοιχεία.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Η μεταφορά απέτυχε."); }
    finally { setBusy(false); }
  }

  async function depart(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const response = await fetch("/api/admin/league", {
        method:"PATCH", headers:{"content-type":"application/json"},
        body:JSON.stringify({ action:"departure", ...input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποχώρηση απέτυχε.");
      setNotice("Η αποχώρηση καταγράφηκε χωρίς να διαγραφεί το ιστορικό του παίκτη.");
      event.currentTarget.reset();
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Η αποχώρηση απέτυχε."); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-zinc-100">
    <header className="border-b border-zinc-800 bg-zinc-950 text-white">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
        <div><p className="text-xs font-black uppercase tracking-[.22em] text-orange-500">KomoBasket Control Center</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Κεντρική διαχείριση</h1></div>
        <div className="flex gap-2"><button onClick={() => void load()} className="rounded-xl border border-zinc-700 p-2.5 hover:border-orange-500" aria-label="Ανανέωση"><RefreshCw size={20}/></button><Link href="/" className="rounded-xl border border-zinc-700 px-4 py-2.5 font-bold hover:border-orange-500">Δημόσιο site</Link></div>
      </div>
    </header>
    <div className="mx-auto grid max-w-[1500px] gap-6 px-4 py-6 lg:grid-cols-[270px_1fr] lg:px-7">
      <nav className="h-fit rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm lg:sticky lg:top-5">
        {tabs.map(([id,label,Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold transition ${tab===id?"bg-zinc-950 text-white":"text-zinc-700 hover:bg-zinc-100"}`}><Icon size={19} className={tab===id?"text-orange-500":"text-zinc-500"}/>{label}</button>)}
      </nav>
      <main className="min-w-0 space-y-5">
        {loading && <div className="rounded-2xl bg-white p-8 text-center text-zinc-500">Φόρτωση δεδομένων…</div>}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div>}
        {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</div>}
        {!loading && data && <>
          {data.mode === "preview" && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">Τοπική προεπισκόπηση με τα υπάρχοντα αρχεία. Η μόνιμη αποθήκευση ενεργοποιείται στην εγκατάσταση D1.</div>}
          {tab === "overview" && <Overview data={data}/>} 
          {tab === "news" && <NewsManager/>}
          {tab === "seasons" && <Seasons data={data} submit={submit} busy={busy}/>} 
          {tab === "teams" && <Teams data={data} submit={submit} busy={busy}/>} 
          {tab === "players" && <Players data={data} submit={submit} busy={busy}/>} 
          {tab === "movements" && <Movements data={data} depart={depart} busy={busy}/>} 
          {tab === "schedule" && <Schedule data={data} submit={submit} busy={busy}/>} 
          {tab === "migration" && <Migration migrate={migrate} busy={busy}/>} 
        </>}
      </main>
    </div>
  </div>;
}

function Overview({data}:{data:Snapshot}) { return <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Σεζόν",data.counts.seasons],["Διοργανώσεις",data.counts.competitions],["Ομάδες",data.counts.teams],["Παίκτες",data.counts.players]].map(([label,value]) => <div key={String(label)} className="rounded-2xl bg-zinc-950 p-5 text-white shadow-sm"><p className="text-sm text-zinc-400">{label}</p><p className="mt-2 text-4xl font-black text-orange-500">{value}</p></div>)}</div><Panel title="Τελευταίες κινήσεις" description="Μεταγραφές, εγγραφές και αποχωρήσεις παραμένουν στο ιστορικό."><SimpleTable rows={data.movements.slice(0,8)} columns={[["effective_on","Ημερομηνία"],["player_name","Παίκτης"],["movement_type","Κίνηση"],["from_team_name","Από"],["to_team_name","Προς"]]}/></Panel></> }

function Seasons({data,submit,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;busy:boolean}) { return <><Panel title="Νέα σεζόν"><form onSubmit={(e)=>void submit("seasons",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Ονομασία"><input required name="name" placeholder="2026-27" className={inputClass}/></Field><Field label="Έναρξη"><input name="startsOn" type="date" className={inputClass}/></Field><Field label="Λήξη"><input name="endsOn" type="date" className={inputClass}/></Field><Field label="Κατάσταση"><select name="status" className={inputClass}><option value="draft">Προετοιμασία</option><option value="active">Ενεργή</option><option value="completed">Ολοκληρωμένη</option></select></Field><button disabled={busy} className={buttonClass}>Προσθήκη σεζόν</button></form></Panel><Panel title="Νέα διοργάνωση"><form onSubmit={(e)=>void submit("competitions",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Σεζόν"><select required name="seasonId" className={inputClass}><option value="">Επιλογή</option>{data.seasons.map(s=><option key={String(s.id)} value={String(s.id)}>{s.name}</option>)}</select></Field><Field label="Ονομασία"><input required name="name" placeholder="KomoBasket League" className={inputClass}/></Field><Field label="Τύπος"><select name="type" className={inputClass}><option value="league">Πρωτάθλημα</option><option value="cup">Κύπελλο</option><option value="tournament">Τουρνουά</option></select></Field><Field label="Κατάσταση"><select name="status" className={inputClass}><option value="draft">Προετοιμασία</option><option value="active">Ενεργή</option><option value="completed">Ολοκληρωμένη</option></select></Field><button disabled={busy} className={buttonClass}>Προσθήκη διοργάνωσης</button></form></Panel><Panel title="Υφιστάμενες διοργανώσεις"><SimpleTable rows={data.competitions} columns={[["season_name","Σεζόν"],["name","Διοργάνωση"],["type","Τύπος"],["status","Κατάσταση"]]}/></Panel></> }

function Teams({data,submit,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;busy:boolean}) { return <><Panel title="Νέα ομάδα" description="Οι ομάδες είναι ενιαίες και μπορούν να συμμετέχουν σε πολλές σεζόν."><form onSubmit={(e)=>void submit("teams",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Ονομασία"><input required name="name" className={inputClass}/></Field><Field label="Πόλη"><input name="city" defaultValue="Κομοτηνή" className={inputClass}/></Field><Field label="Διεύθυνση λογοτύπου"><input name="logoUrl" placeholder="/logos/teams/..." className={inputClass}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Προσθήκη ομάδας</button></form></Panel><Panel title="Συμμετοχή ομάδας σε νέα σεζόν" description="Επιλέγεις υπάρχουσα ομάδα ή δημιουργείς πρώτα μία νέα. Το όνομα και το λογότυπο μπορούν να αλλάζουν μόνο για τη συγκεκριμένη σεζόν."><form onSubmit={(e)=>void submit("participations",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Σεζόν"><select required name="seasonId" className={inputClass}><option value="">Επιλογή</option>{data.seasons.map(s=><option key={String(s.id)} value={String(s.id)}>{s.name}</option>)}</select></Field><Field label="Διοργάνωση"><select name="competitionId" className={inputClass}><option value="">Μόνο στη σεζόν</option>{data.competitions.map(c=><option key={String(c.id)} value={String(c.id)}>{c.season_name} · {c.name}</option>)}</select></Field><Field label="Υφιστάμενη ομάδα"><select required name="teamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Ονομασία στη σεζόν (προαιρετικό)"><input name="displayName" className={inputClass}/></Field><Field label="Λογότυπο σεζόν (προαιρετικό)"><input name="logoUrl" className={inputClass}/></Field><Field label="Κατάταξη / seed"><input name="seed" type="number" className={inputClass}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Προσθήκη συμμετοχής</button></form></Panel><Panel title="Συμμετοχές ανά σεζόν"><SimpleTable rows={data.participations} columns={[["season_name","Σεζόν"],["display_name","Ονομασία"],["team_name","Ενιαία ομάδα"],["competition_names","Διοργανώσεις"]]}/></Panel><Panel title="Μητρώο ομάδων"><SimpleTable rows={data.teams} columns={[["name","Ομάδα"],["city","Πόλη"],["slug","Αναγνωριστικό"],["active","Ενεργή"]]}/></Panel></> }

function Players({data,submit,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;busy:boolean}) { return <><Panel title="Νέος ή υφιστάμενος παίκτης" description="Το σύστημα ενώνει αυτόματα ονόματα με αντίστροφη σειρά, χωρίς τόνους ή με μικρές ορθογραφικές διαφορές."><form onSubmit={(e)=>void submit("players",e)} className="flex flex-col gap-3 sm:flex-row"><Field label="Ονοματεπώνυμο"><input required name="displayName" className={`${inputClass} min-w-72`}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Καταχώριση / αναγνώριση</button></form></Panel><Panel title="Προσθήκη σε ρόστερ"><form onSubmit={(e)=>void submit("rosters",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Σεζόν"><select required name="seasonId" className={inputClass}><option value="">Επιλογή</option>{data.seasons.map(s=><option key={String(s.id)} value={String(s.id)}>{s.name}</option>)}</select></Field><Field label="Διοργάνωση"><select name="competitionId" className={inputClass}><option value="">Γενικό ρόστερ</option>{data.competitions.map(c=><option key={String(c.id)} value={String(c.id)}>{c.season_name} · {c.name}</option>)}</select></Field><Field label="Παίκτης"><select required name="playerId" className={inputClass}><option value="">Επιλογή</option>{data.players.map(p=><option key={String(p.id)} value={String(p.id)}>{p.display_name}</option>)}</select></Field><Field label="Ομάδα"><select required name="teamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Αριθμός φανέλας"><input name="shirtNumber" type="number" className={inputClass}/></Field><Field label="Ημερομηνία ένταξης"><input name="joinedOn" type="date" className={inputClass}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Προσθήκη / μεταγραφή</button></form></Panel><Panel title="Τρέχοντα και ιστορικά ρόστερ"><SimpleTable rows={data.rosters} columns={[["season_name","Σεζόν"],["player_name","Παίκτης"],["team_name","Ομάδα"],["shirt_number","#"],["status","Κατάσταση"]]}/></Panel></> }

function Movements({data,depart,busy}:{data:Snapshot;depart:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean}) { const active=data.rosters.filter(r=>r.status==="active"); return <><Panel title="Αποχώρηση παίκτη" description="Η εγγραφή κλείνει, αλλά το ιστορικό ομάδας και σεζόν διατηρείται."><form onSubmit={(e)=>void depart(e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Ενεργό ρόστερ"><select required name="rosterId" className={inputClass}><option value="">Επιλογή</option>{active.map(r=><option key={String(r.id)} value={String(r.id)}>{r.season_name} · {r.player_name} · {r.team_name}</option>)}</select></Field><Field label="Ημερομηνία"><input name="effectiveOn" type="date" className={inputClass}/></Field><Field label="Σημείωση"><input name="note" className={inputClass}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Καταχώριση αποχώρησης</button></form></Panel><Panel title="Ιστορικό μετακινήσεων" description="Καμία μεταγραφή ή αποχώρηση δεν διαγράφει το παρελθόν του παίκτη."><SimpleTable rows={data.movements} columns={[["effective_on","Ημερομηνία"],["player_name","Παίκτης"],["movement_type","Ενέργεια"],["from_team_name","Προηγούμενη ομάδα"],["to_team_name","Νέα ομάδα"],["note","Σημείωση"]]}/></Panel></> }

function Schedule({data,submit,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;busy:boolean}) { return <><Panel title="Νέα φάση"><form onSubmit={(e)=>void submit("phases",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Διοργάνωση"><select required name="competitionId" className={inputClass}><option value="">Επιλογή</option>{data.competitions.map(c=><option key={String(c.id)} value={String(c.id)}>{c.season_name} · {c.name}</option>)}</select></Field><Field label="Ονομασία"><input required name="name" placeholder="Κανονική περίοδος / Final 4" className={inputClass}/></Field><Field label="Τύπος"><input name="phaseType" defaultValue="regular" className={inputClass}/></Field><Field label="Σειρά"><input name="orderIndex" type="number" defaultValue="0" className={inputClass}/></Field><button disabled={busy} className={buttonClass}>Προσθήκη φάσης</button></form></Panel><Panel title="Νέος αγώνας"><form onSubmit={(e)=>void submit("games",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Διοργάνωση"><select required name="competitionId" className={inputClass}><option value="">Επιλογή</option>{data.competitions.map(c=><option key={String(c.id)} value={String(c.id)}>{c.season_name} · {c.name}</option>)}</select></Field><Field label="Φάση"><select name="phaseId" className={inputClass}><option value="">Χωρίς φάση</option>{data.phases.map(p=><option key={String(p.id)} value={String(p.id)}>{p.competition_name} · {p.name}</option>)}</select></Field><Field label="Γύρος / αγωνιστική"><input name="roundLabel" className={inputClass}/></Field><Field label="Ημερομηνία & ώρα"><input name="scheduledAt" type="datetime-local" className={inputClass}/></Field><Field label="Γηπεδούχος"><select required name="homeTeamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Φιλοξενούμενος"><select required name="awayTeamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Γήπεδο"><input name="venue" className={inputClass}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Προσθήκη αγώνα</button></form></Panel><Panel title="Αγώνες"><SimpleTable rows={data.games} columns={[["scheduled_at","Ημερομηνία"],["phase_name","Φάση"],["round_label","Γύρος"],["home_team_name","Γηπεδούχος"],["away_team_name","Φιλοξενούμενος"],["status","Κατάσταση"]]}/></Panel></> }

function Migration({migrate,busy}:{migrate:()=>void;busy:boolean}) { return <Panel title="Μεταφορά ιστορικών δεδομένων" description="Εισάγει τις σεζόν 2019-20 έως 2025-26, τις διοργανώσεις, τις ομάδες, τα ρόστερ, τις φάσεις, τους αγώνες και τα διαθέσιμα αποτελέσματα από τα υπάρχοντα αρχεία."><div className="rounded-2xl border border-orange-200 bg-orange-50 p-5"><div className="flex gap-3"><ListTree className="mt-1 text-orange-600"/><div><h3 className="font-black">Αυτόματη ενοποίηση παικτών</h3><p className="mt-1 text-sm leading-6 text-zinc-700">Αντίστροφο όνομα–επώνυμο, τόνοι και μικρές ορθογραφικές αποκλίσεις αναγνωρίζονται χωρίς χειροκίνητη έγκριση. Κάθε ένωση καταγράφεται και μπορεί να αναιρεθεί από το ιστορικό της βάσης.</p></div></div><button onClick={()=>void migrate()} disabled={busy} className={`${buttonClass} mt-5`}>{busy?"Μεταφορά…":"Έναρξη ασφαλούς μεταφοράς"}</button></div></Panel> }
