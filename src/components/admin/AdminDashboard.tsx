"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Database,
  FileText,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
  ["seasons", "Σεζόν & διοργανώσεις", Trophy],
  ["teams", "Ομάδες & συμμετοχές", ShieldCheck],
  ["players", "Παίκτες & ρόστερ", UsersRound],
  ["movements", "Μεταγραφές & αποχωρήσεις", UserRoundCog],
  ["schedule", "Πρόγραμμα & αγώνες", CalendarDays],
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

type TeamRosterViewRole = "head_coach" | "assistant_coach" | "trainer" | "physiotherapist" | "doctor" | "team_manager" | "team_official" | "other";
const staffRoleLabels: Record<TeamRosterViewRole, string> = {
  head_coach: "Προπονητής",
  assistant_coach: "Βοηθός Προπονητή",
  trainer: "Γυμναστής",
  physiotherapist: "Φυσικοθεραπευτής",
  doctor: "Ιατρός",
  team_manager: "Team Manager",
  team_official: "Έφορος",
  other: "Άλλο",
};

type TeamRosterAthlete = {
  roster_id: string;
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  photo_url: string | null;
  birth_date: string | null;
  shirt_number: number | null;
};

type TeamRosterStaff = {
  membership_id: string;
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  photo_url: string | null;
  birth_date: string | null;
  role: TeamRosterViewRole | string;
  custom_role_label: string | null;
};

type PreviousRosterInfo = {
  seasonId: string | null;
  seasonName: string | null;
  targetAthleteRosterExists: boolean;
  targetAthleteCount: number;
  targetStaffRosterExists: boolean;
  targetStaffCount: number;
  previousAthleteCount: number;
  previousStaffCount: number;
};

type TeamRosterManagementView = {
  seasonId: string;
  seasonName: string;
  competitionId: string;
  competitionName: string;
  teamId: string;
  teamName: string;
  athletes: TeamRosterAthlete[];
  staff: TeamRosterStaff[];
  previousRoster: PreviousRosterInfo;
};

type TeamRosterAthleteWithIndex = TeamRosterAthlete & { rowIndex: number };
type TeamRosterStaffWithIndex = TeamRosterStaff & { rowIndex: number };

type SearchAthleteResult = {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  birth_date: string | null;
  last_team_name: string | null;
  last_season_name: string | null;
  career_history: {
    season_name: string;
    team_name: string;
    competition_name: string | null;
    season_year_key: number | null;
  }[];
};

type SearchStaffResult = {
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  birth_date: string | null;
  last_team_name: string | null;
  last_season_name: string | null;
};

type RosterActionKind = "athlete" | "staff";

type SortDirection = "asc" | "desc";
type SortState = {
  key: "first_name" | "last_name" | "birth_date" | "shirt_number" | "staff_first_name" | "staff_last_name" | "staff_role";
  direction: SortDirection;
};

function parseDateForDisplay(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function compareNullable(a:string|number|null|undefined,b:string|number|null|undefined,direction:SortDirection) {
  const left = a ?? "";
  const right = b ?? "";
  if (left === right) return 0;
  const value = String(left).localeCompare(String(right), "el-GR", { sensitivity: "base", numeric: true });
  return direction === "asc" ? value : -value;
}

type AdminView = "home" | "news" | "platform";

function AdminHeader({ view, onRefresh }: { view:AdminView; onRefresh?:() => void }) {
  const titles:Record<AdminView, string> = {
    home: "Κεντρική διαχείριση",
    news: "Διαχείριση Νέων",
    platform: "KomoBasket Platform",
  };

  return <header className="border-b border-zinc-800 bg-zinc-950 text-white">
    <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
      <div className="flex items-center gap-4">
        {view !== "home" && <Link href="/admin" className="rounded-xl border border-zinc-700 p-2.5 transition hover:border-orange-500" aria-label="Επιστροφή στην αρχική διαχείριση"><ArrowLeft size={20}/></Link>}
        <div><p className="text-xs font-black uppercase tracking-[.22em] text-orange-500">KomoBasket Control Center</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">{titles[view]}</h1></div>
      </div>
      <div className="flex gap-2">
        {onRefresh && <button onClick={onRefresh} className="rounded-xl border border-zinc-700 p-2.5 transition hover:border-orange-500" aria-label="Ανανέωση"><RefreshCw size={20}/></button>}
        <Link href="/" className="rounded-xl border border-zinc-700 px-4 py-2.5 font-bold transition hover:border-orange-500">Δημόσιο site</Link>
      </div>
    </div>
  </header>;
}

function AdminHome() {
  const choices = [
    {
      href: "/admin/news",
      title: "Νέα",
      description: "Δημιουργία, επεξεργασία και δημοσίευση ανακοινώσεων και συνημμένων.",
      Icon: FileText,
    },
    {
      href: "/admin/platform",
      title: "KomoBasket Platform",
      description: "Διαχείριση σεζόν, διοργανώσεων, ομάδων, παικτών, ρόστερ και αγώνων.",
      Icon: Database,
    },
  ];

  return <div className="min-h-screen bg-zinc-100">
    <AdminHeader view="home"/>
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-7 sm:py-16">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-black text-zinc-950 sm:text-4xl">Τι θέλεις να διαχειριστείς;</h2>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600">Οι ανακοινώσεις και η αγωνιστική πλατφόρμα λειτουργούν ως δύο ανεξάρτητες ενότητες.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {choices.map(({ href, title, description, Icon }) => <Link key={href} href={href} className="group flex min-h-64 flex-col rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-orange-300 hover:shadow-xl sm:p-9">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-zinc-950 text-orange-500 transition group-hover:bg-orange-600 group-hover:text-white"><Icon size={28}/></span>
          <h3 className="mt-7 text-2xl font-black text-zinc-950">{title}</h3>
          <p className="mt-3 flex-1 leading-7 text-zinc-600">{description}</p>
          <span className="mt-7 inline-flex items-center gap-2 font-black text-orange-600">Άνοιγμα ενότητας <span aria-hidden="true">→</span></span>
        </Link>)}
      </div>
    </main>
  </div>;
}

function NewsAdmin() {
  return <div className="min-h-screen bg-zinc-100">
    <AdminHeader view="news"/>
    <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7">
      <NewsManager/>
    </main>
  </div>;
}

export default function AdminDashboard({ view }: { view:AdminView }) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("overview");
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [teamSeasonFilter, setTeamSeasonFilter] = useState("all");
  const [selectedParticipationTeamIds, setSelectedParticipationTeamIds] = useState<string[]>([]);

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
    if (view !== "platform") return;
    const request = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(request);
  }, [load, view]);

  async function create(resource:string, input:Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/league/${resource}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(input) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποθήκευση απέτυχε.");
      setNotice(
        payload?.message ||
        (payload.automaticallyMatched ? "Ο παίκτης αναγνωρίστηκε και ενώθηκε αυτόματα με την υπάρχουσα εγγραφή." : "Η εγγραφή αποθηκεύτηκε."),
      );
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Η αποθήκευση απέτυχε."); }
    finally { setBusy(false); }
  }

  async function submit(resource:string, event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    await create(resource, Object.fromEntries(form.entries()));
    formEl.reset();
  }

  async function updateEntity(resource:string, id:string, event:FormEvent<HTMLFormElement>, successMessage:string) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const response = await fetch(`/api/admin/league/${resource}`, {
        method:"PATCH",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({ id, ...input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η επεξεργασία απέτυχε.");
      setNotice(successMessage);
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η επεξεργασία απέτυχε.");
      return false;
    } finally { setBusy(false); }
  }

  async function deleteEntity(resource:string, id:string, successMessage:string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/league/${resource}`, {
        method:"DELETE",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({ id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η διαγραφή απέτυχε.");
      setNotice(successMessage);
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η διαγραφή απέτυχε.");
      return false;
    } finally { setBusy(false); }
  }

  async function depart(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setBusy(true); setError(""); setNotice("");
    try {
      const input = Object.fromEntries(new FormData(formEl).entries());
      const response = await fetch("/api/admin/league", {
        method:"PATCH", headers:{"content-type":"application/json"},
        body:JSON.stringify({ action:"departure", ...input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποχώρηση απέτυχε.");
      setNotice("Η αποχώρηση καταγράφηκε χωρίς να διαγραφεί το ιστορικό του παίκτη.");
      formEl.reset();
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Η αποχώρηση απέτυχε."); }
    finally { setBusy(false); }
  }

  if (view === "home") return <AdminHome/>;
  if (view === "news") return <NewsAdmin/>;

  return <div className="min-h-screen bg-zinc-100">
    <AdminHeader view="platform" onRefresh={() => void load()}/>
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
          {tab === "seasons" && <Seasons data={data} submit={submit} updateEntity={updateEntity} deleteEntity={deleteEntity} busy={busy}/>}
          {tab === "teams" && (
            <Teams
              data={data}
              submit={submit}
              createEntity={create}
              updateEntity={updateEntity}
              deleteEntity={deleteEntity}
              busy={busy}
              teamSeasonFilter={teamSeasonFilter}
              setTeamSeasonFilter={setTeamSeasonFilter}
              selectedParticipationTeamIds={selectedParticipationTeamIds}
              setSelectedParticipationTeamIds={setSelectedParticipationTeamIds}
            />
          )}
          {tab === "players" && <Players data={data} />} 
          {tab === "movements" && <Movements data={data} depart={depart} busy={busy}/>} 
          {tab === "schedule" && <Schedule data={data} submit={submit} updateEntity={updateEntity} busy={busy}/>}
        </>}
      </main>
    </div>
  </div>;
}

function Overview({data}:{data:Snapshot}) { return <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Σεζόν",data.counts.seasons],["Διοργανώσεις",data.counts.competitions],["Ομάδες",data.counts.teams],["Παίκτες",data.counts.players]].map(([label,value]) => <div key={String(label)} className="rounded-2xl bg-zinc-950 p-5 text-white shadow-sm"><p className="text-sm text-zinc-400">{label}</p><p className="mt-2 text-4xl font-black text-orange-500">{value}</p></div>)}</div><Panel title="Τελευταίες κινήσεις" description="Μεταγραφές, εγγραφές και αποχωρήσεις παραμένουν στο ιστορικό."><SimpleTable rows={data.movements.slice(0,8)} columns={[["effective_on","Ημερομηνία"],["player_name","Παίκτης"],["movement_type","Κίνηση"],["from_team_name","Από"],["to_team_name","Προς"]]}/></Panel></> }

const seasonStatusLabels:Record<string, string> = {
  draft: "Under Construction",
  active: "Online",
  completed: "Complete",
};

const competitionLifecycleLabels:Record<string, string> = {
  under_construction: "Under Construction",
  online: "Online",
  complete: "Complete",
};

const competitionTypeLabels:Record<string, string> = {
  league: "Πρωτάθλημα",
  cup: "Κύπελλο",
  tournament: "Τουρνουά",
};

const phaseKindLabels:Record<string, string> = {
  regular_season: "Regular Season",
  play_in: "Play-In",
  play_out: "Play-Out",
  playoffs: "Playoffs",
  final_four: "Final Four",
  finals: "Finals",
  custom: "Άλλη φάση",
};

type UpdateEntity = (resource:string,id:string,event:FormEvent<HTMLFormElement>,successMessage:string)=>Promise<boolean>;
type DeleteEntity = (resource:string,id:string,successMessage:string)=>Promise<boolean>;
type CreateEntity = (resource:string,input:Record<string, unknown>)=>Promise<void>;

function CompetitionFields({competition}:{competition?:Row}) {
  return <>
    <Field label="Ονομασία"><input required name="name" defaultValue={String(competition?.name ?? "")} placeholder="KomoBasket League" className={inputClass}/></Field>
    <Field label="Τύπος"><select name="type" defaultValue={String(competition?.type ?? "league")} className={inputClass}><option value="league">Πρωτάθλημα</option><option value="cup">Κύπελλο</option><option value="tournament">Τουρνουά</option></select></Field>
    <Field label="Κατάσταση"><select name="lifecycleStatus" defaultValue={String(competition?.lifecycle_status ?? "under_construction")} className={inputClass}><option value="under_construction">Under Construction</option><option value="online">Online</option><option value="complete">Complete</option></select></Field>
    <Field label="Αναμενόμενες ομάδες"><input name="expectedTeamCount" type="number" min="2" defaultValue={String(competition?.expected_team_count ?? "")} placeholder="16" className={inputClass}/></Field>
    <Field label="Αγώνες ανά ζευγάρι στην κανονική περίοδο"><input name="regularSeasonMeetings" type="number" min="0" defaultValue={String(competition?.regular_season_meetings ?? 1)} className={inputClass}/></Field>
    <Field label="Βαθμοί νίκης"><input name="winPoints" type="number" defaultValue={String(competition?.win_points ?? 2)} className={inputClass}/></Field>
    <Field label="Βαθμοί ήττας"><input name="lossPoints" type="number" defaultValue={String(competition?.loss_points ?? 1)} className={inputClass}/></Field>
    <Field label="Βαθμοί μηδενισμού"><input name="forfeitPoints" type="number" defaultValue={String(competition?.forfeit_points ?? 0)} className={inputClass}/></Field>
    <label className="grid gap-1.5 text-sm font-bold text-zinc-700 sm:col-span-2 xl:col-span-4"><span>Περιγραφή</span><textarea name="description" rows={3} defaultValue={String(competition?.description ?? "")} className={inputClass}/></label>
  </>;
}

function Seasons({data,submit,updateEntity,deleteEntity,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;updateEntity:UpdateEntity;deleteEntity:DeleteEntity;busy:boolean}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [competitionEditingId, setCompetitionEditingId] = useState<string | null>(null);
  const [sourceCompetitionId, setSourceCompetitionId] = useState("");

  return <>
    <Panel title="Διαχείριση σεζόν" description="Δημιούργησε τη νέα αγωνιστική περίοδο και έλεγξε τις ήδη καταχωρημένες σεζόν. Καμία αλλαγή κατάστασης δεν διαγράφει δεδομένα.">
      <form onSubmit={(e)=>void submit("seasons",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Ονομασία"><input required name="name" pattern="[0-9]{4}-[0-9]{2}" title="Παράδειγμα: 2026-27" placeholder="2026-27" className={inputClass}/></Field>
        <Field label="Έναρξη"><input name="startsOn" type="date" className={inputClass}/></Field>
        <Field label="Λήξη"><input name="endsOn" type="date" className={inputClass}/></Field>
        <Field label="Κατάσταση"><select name="status" className={inputClass}><option value="draft">Under Construction</option><option value="active">Online</option><option value="completed">Complete</option></select></Field>
        <button disabled={busy} className={buttonClass}>Προσθήκη σεζόν</button>
      </form>
      <div className="mt-7 grid gap-4 xl:grid-cols-2">
        {data.seasons.map((season) => {
          const id = String(season.id);
          const competitionCount = data.competitions.filter((competition) => String(competition.season_id) === id).length;
          const isEditing = editingId === id;
          return <article key={id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-black text-zinc-950">{season.name}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${season.status === "active" ? "bg-emerald-100 text-emerald-800" : season.status === "completed" ? "bg-zinc-200 text-zinc-700" : "bg-amber-100 text-amber-800"}`}>{seasonStatusLabels[String(season.status)] ?? season.status}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-600">{season.starts_on || season.ends_on ? `${season.starts_on ?? "Χωρίς έναρξη"} — ${season.ends_on ?? "Χωρίς λήξη"}` : "Δεν έχουν οριστεί ημερομηνίες"} · {competitionCount} {competitionCount === 1 ? "διοργάνωση" : "διοργανώσεις"}</p>
              </div>
              <button type="button" onClick={() => setEditingId(isEditing ? null : id)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500">{isEditing ? "Ακύρωση" : "Edit"}</button>
            </div>
            {isEditing && <form onSubmit={async (event) => { if (await updateEntity("seasons",id,event,"Οι αλλαγές στη σεζόν αποθηκεύτηκαν χωρίς να επηρεαστεί το ιστορικό της.")) setEditingId(null); }} className="mt-5 grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-2">
              <Field label="Ονομασία"><input required name="name" pattern="[0-9]{4}-[0-9]{2}" title="Παράδειγμα: 2026-27" defaultValue={String(season.name ?? "")} className={inputClass}/></Field>
              <Field label="Κατάσταση"><select name="status" defaultValue={String(season.status ?? "draft")} className={inputClass}><option value="draft">Under Construction</option><option value="active">Online</option><option value="completed">Complete</option></select></Field>
              <Field label="Έναρξη"><input name="startsOn" type="date" defaultValue={String(season.starts_on ?? "")} className={inputClass}/></Field>
              <Field label="Λήξη"><input name="endsOn" type="date" defaultValue={String(season.ends_on ?? "")} className={inputClass}/></Field>
              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <button disabled={busy} className={buttonClass}>Αποθήκευση αλλαγών</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const name = String(season.name ?? "");
                    if (!window.confirm(`Πρόκειται να διαγράψετε τη σεζόν «${name}». Θέλετε να συνεχίσετε;`)) return;
                    if (await deleteEntity("seasons", id, `Η σεζόν «${name}» διαγράφηκε.`)) setEditingId(null);
                  }}
                  className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Διαγραφή Σεζόν
                </button>
              </div>
            </form>}
          </article>;
        })}
      </div>
    </Panel>
    <Panel title="Νέα διοργάνωση" description="Δημιούργησε μία διοργάνωση από την αρχή ή χρησιμοποίησε ως πρότυπο το format προηγούμενης σεζόν. Το ιστορικό της αρχικής διοργάνωσης δεν αλλάζει.">
      <form onSubmit={(e)=>void submit("competitions",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Σεζόν"><select required name="seasonId" className={inputClass}><option value="">Επιλογή</option>{data.seasons.map(s=><option key={String(s.id)} value={String(s.id)}>{s.name}</option>)}</select></Field>
        <Field label="Πρότυπο προηγούμενης διοργάνωσης"><select name="sourceCompetitionId" value={sourceCompetitionId} onChange={(event)=>setSourceCompetitionId(event.target.value)} className={inputClass}><option value="">Χωρίς πρότυπο</option>{data.competitions.map(c=><option key={String(c.id)} value={String(c.id)}>{c.season_name} · {c.name}</option>)}</select></Field>
        {sourceCompetitionId && <label className="flex items-center gap-2 self-end rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm font-bold text-orange-900"><input name="copyPhases" type="checkbox" defaultChecked/> Αντιγραφή φάσεων και κανόνων</label>}
        <CompetitionFields/>
        <button disabled={busy} className={`${buttonClass} sm:col-span-2 xl:col-span-4 xl:justify-self-start`}>Δημιουργία διοργάνωσης</button>
      </form>
    </Panel>
    <Panel title="Υφιστάμενες διοργανώσεις" description="Η αλλαγή κατάστασης δεν διαγράφει αγώνες, ομάδες ή ιστορικά στοιχεία.">
      <div className="grid gap-4 xl:grid-cols-2">
        {data.competitions.map((competition) => {
          const id=String(competition.id);
          const isEditing=competitionEditingId===id;
          const phaseCount=data.phases.filter((phase)=>String(phase.competition_id)===id).length;
          const lifecycle=String(competition.lifecycle_status ?? "under_construction");
          return <article key={id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-wider text-orange-600">{competition.season_name}</p><h3 className="mt-1 text-xl font-black text-zinc-950">{competition.name}</h3><p className="mt-2 text-sm text-zinc-600">{competitionTypeLabels[String(competition.type)] ?? competition.type} · {phaseCount} {phaseCount===1?"φάση":"φάσεις"} · {competition.expected_team_count ?? "—"} ομάδες</p><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${lifecycle==="online"?"bg-emerald-100 text-emerald-800":lifecycle==="complete"?"bg-zinc-200 text-zinc-700":"bg-amber-100 text-amber-800"}`}>{competitionLifecycleLabels[lifecycle] ?? lifecycle}</span></div>
              <button type="button" onClick={()=>setCompetitionEditingId(isEditing?null:id)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500">{isEditing?"Ακύρωση":"Edit"}</button>
            </div>
            {isEditing && <form onSubmit={async(event)=>{if(await updateEntity("competitions",id,event,"Οι αλλαγές στη διοργάνωση και το format αποθηκεύτηκαν."))setCompetitionEditingId(null);}} className="mt-5 grid gap-x-5 gap-y-4 border-t border-zinc-200 pt-5 sm:grid-cols-2 xl:grid-cols-4">
              <CompetitionFields competition={competition}/>
              <div className="mt-2 flex flex-col gap-4 border-t border-zinc-200 pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between xl:col-span-4">
                <button disabled={busy} className={buttonClass}>Αποθήκευση διοργάνωσης</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async()=>{
                    const name=String(competition.name ?? "");
                    if(!window.confirm(`Πρόκειται να διαγράψετε τη διοργάνωση «${name}». Θέλετε να συνεχίσετε;`))return;
                    if(await deleteEntity("competitions",id,`Η διοργάνωση «${name}» διαγράφηκε.`))setCompetitionEditingId(null);
                  }}
                  className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Διαγραφή Διοργάνωσης
                </button>
              </div>
            </form>}
          </article>;
        })}
        {!data.competitions.length && <p className="text-sm text-zinc-500">Δεν υπάρχουν ακόμη διοργανώσεις.</p>}
      </div>
    </Panel>
  </>;
}

const participationStatusLabels:Record<string, string> = {
  active: "Ενεργή",
  inactive: "Ανενεργή",
  withdrawn: "Αποχώρησε",
};
const COMPLETED_COMPETITION_STATUSES = new Set(["complete","completed","finished"]);
const isCompletedCompetition = (status:string) => COMPLETED_COMPETITION_STATUSES.has(String(status).toLowerCase().trim());

function Teams({data,submit,updateEntity,deleteEntity,createEntity,busy,teamSeasonFilter,setTeamSeasonFilter,selectedParticipationTeamIds,setSelectedParticipationTeamIds}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;updateEntity:UpdateEntity;deleteEntity:DeleteEntity;createEntity:CreateEntity;busy:boolean;teamSeasonFilter:string;setTeamSeasonFilter:(value:string)=>void;selectedParticipationTeamIds:string[];setSelectedParticipationTeamIds:(ids:string[])=>void}) {
  const [selectedSeasonId,setSelectedSeasonId]=useState("");
  const [selectedCompetitionId,setSelectedCompetitionId]=useState("");
  const [selectedRegistryTeamId,setSelectedRegistryTeamId]=useState("");
  const [editingParticipationId,setEditingParticipationId]=useState<string|null>(null);
  const [participationFilterSeasonId,setParticipationFilterSeasonId]=useState("");
  const [participationFilterCompetitionId,setParticipationFilterCompetitionId]=useState("");
  const availableCompetitions=data.competitions.filter((competition)=>String(competition.season_id)===selectedSeasonId);
  const availableCompetitionParticipations=data.competitions.filter((competition)=>String(competition.season_id)===participationFilterSeasonId);
  const activeTeams=data.teams.filter((team)=>Number(team.active ?? 1)===1);
  const competitionSeasonById = new Map(
    data.competitions.map((competition) => [String(competition.id), String(competition.season_id ?? "")]),
  );
  const competitionById = new Map(data.competitions.map((competition) => [String(competition.id), competition]));
  const seasonById = new Map(data.seasons.map((season) => [String(season.id), season]));
  const existingTeamIdsInCompetition = new Set(
    selectedCompetitionId
      ? data.participations
        .filter((participation) => String(participation.competition_id ?? "") === selectedCompetitionId)
        .map((participation) => String(participation.team_id ?? "").trim())
        .filter(Boolean)
      : [],
  );
  const getSeasonOrder = (season: Row) => {
    const label = String(season.name ?? season.slug ?? "");
    const labelMatch = label.match(/^([0-9]{4})-[0-9]{2}$/);
    if (labelMatch) return Number(labelMatch[1]);
    const startsOn = season.starts_on ? new Date(String(season.starts_on)).valueOf() : NaN;
    if (!Number.isNaN(startsOn)) return startsOn;
    return NaN;
  };
  const compareSeasonDesc = (left: Row, right: Row) => {
    const leftOrder = getSeasonOrder(left);
    const rightOrder = getSeasonOrder(right);

    if (!Number.isNaN(leftOrder) && !Number.isNaN(rightOrder)) {
      return rightOrder - leftOrder;
    }
    if (Number.isNaN(leftOrder) && Number.isNaN(rightOrder)) return 0;
    if (Number.isNaN(leftOrder)) return 1;
    return -1;
  };
  const participationSeasonIds=new Set(
    data.participations.flatMap((participation) => [
      String(participation.season_id ?? ""),
      String(competitionSeasonById.get(String(participation.competition_id ?? "")) ?? ""),
    ]).filter(Boolean),
  );
  const filteredPreviousSeasons=data.seasons
    .filter((season)=>{
      const selectedSeasonOrder=getSeasonOrder(data.seasons.find((candidate)=>String(candidate.id)===selectedSeasonId) ?? {});
      const candidateSeasonId=String(season.id);
      if (!participationSeasonIds.has(candidateSeasonId)) return false;
      const candidateOrder=getSeasonOrder(season);
      if (Number.isNaN(selectedSeasonOrder) || Number.isNaN(candidateOrder)) return false;
      return candidateOrder < selectedSeasonOrder;
    })
    .sort(compareSeasonDesc);

  const previousSeasonOptions = selectedSeasonId
    ? filteredPreviousSeasons
    : [...data.seasons].sort(compareSeasonDesc);

  const defaultSourceSeasonId = (seasonId:string) => {
    const selectedSeasonOrder=getSeasonOrder(data.seasons.find((season)=>String(season.id)===seasonId) ?? {});
    if (Number.isNaN(selectedSeasonOrder)) return "";
    const candidates=data.seasons
      .filter((season)=>{
        const candidateSeasonId=String(season.id);
        const candidateOrder=getSeasonOrder(season);
        return candidateOrder < selectedSeasonOrder && participationSeasonIds.has(candidateSeasonId);
      })
      .sort(compareSeasonDesc);
    return candidates.length ? String(candidates[0].id) : "";
  };

  const seasonTeamIds = teamSeasonFilter==="all"
    ? []
    : Array.from(new Set(
      data.participations.flatMap((participation) => {
        const participationSeasonId = String(participation.season_id ?? "");
        const competitionSeasonId = String(competitionSeasonById.get(String(participation.competition_id ?? "")) ?? "");
        const matchesSeason = teamSeasonFilter === participationSeasonId;
        const matchesCompetition = teamSeasonFilter === competitionSeasonId;
        return (matchesSeason || matchesCompetition) ? [String(participation.team_id ?? "")] : [];
      }),
    ));

  const availableParticipationTeams = teamSeasonFilter==="all" ? activeTeams : activeTeams.filter((team)=>seasonTeamIds.includes(String(team.id)));
  const selectableParticipationTeams = availableParticipationTeams.filter(
    (team) => !existingTeamIdsInCompetition.has(String(team.id)),
  );
  const allParticipationTeamsSelected=selectableParticipationTeams.length > 0 && selectableParticipationTeams.every((team)=>selectedParticipationTeamIds.includes(String(team.id)));
  const toggleParticipationTeam=(teamId:string,checked:boolean)=>{
    if (checked) {
      setSelectedParticipationTeamIds(Array.from(new Set([...selectedParticipationTeamIds,teamId])));
      return;
    }
    setSelectedParticipationTeamIds(selectedParticipationTeamIds.filter((id)=>id!==teamId));
  };
  const toggleAllParticipationTeams=()=>{
    if (allParticipationTeamsSelected) {
      setSelectedParticipationTeamIds([]);
      return;
    }
    setSelectedParticipationTeamIds(selectableParticipationTeams.map((team)=>String(team.id)));
  };

  const submitBulkParticipation = async () => {
    if (!selectedSeasonId || !selectedCompetitionId) return;
    const teamIds = selectedParticipationTeamIds.filter(
      (teamId)=>!existingTeamIdsInCompetition.has(teamId),
    );
    if (!teamIds.length) return;
    await createEntity("participations", {
      seasonId: selectedSeasonId,
      competitionId: selectedCompetitionId,
      teamIds,
      copyPreviousRoster: false,
    });
    setSelectedParticipationTeamIds([]);
  };

  const historicalSeasons = [...data.seasons].sort(compareSeasonDesc);
  const latestSeasonId = historicalSeasons[0] ? String(historicalSeasons[0].id) : "";
  useEffect(() => {
    const seasonExists = data.seasons.some((season)=>String(season.id)===selectedSeasonId);
    if (!seasonExists) {
      setSelectedSeasonId(latestSeasonId);
      setSelectedCompetitionId("");
      setTeamSeasonFilter("all");
      setSelectedParticipationTeamIds([]);
    }
  }, [data.seasons, latestSeasonId, selectedSeasonId, setSelectedParticipationTeamIds, setTeamSeasonFilter]);

  useEffect(() => {
    if (!selectedSeasonId) return;
    const filteredCompetitions = data.competitions.filter((competition)=>String(competition.season_id)===selectedSeasonId);
    const competitionExists = filteredCompetitions.some((competition)=>String(competition.id)===selectedCompetitionId);
    if (!competitionExists) {
      setSelectedCompetitionId(filteredCompetitions.length === 1 ? String(filteredCompetitions[0].id) : "");
    }
  }, [data.competitions, selectedSeasonId, selectedCompetitionId]);

  useEffect(() => {
    if (!latestSeasonId) return;
    const seasonExists = data.seasons.some((season)=>String(season.id)===participationFilterSeasonId);
    if (!seasonExists) setParticipationFilterSeasonId(latestSeasonId);
  }, [data.seasons, latestSeasonId, participationFilterSeasonId]);

  useEffect(() => {
    if (!participationFilterSeasonId) return;
    const validCompetitionIds = new Set(
      data.competitions
        .filter((competition)=>String(competition.season_id)===participationFilterSeasonId)
        .map((competition)=>String(competition.id)),
    );
    if (participationFilterCompetitionId && !validCompetitionIds.has(participationFilterCompetitionId)) {
      setParticipationFilterCompetitionId("");
    }
    if (!participationFilterCompetitionId && validCompetitionIds.size === 1) {
      setParticipationFilterCompetitionId(String(Array.from(validCompetitionIds)[0]));
    }
    if (!validCompetitionIds.size) {
      setParticipationFilterCompetitionId("");
    }
  }, [data.competitions, participationFilterCompetitionId, participationFilterSeasonId]);

  useEffect(()=>{ setSelectedParticipationTeamIds([]); }, [teamSeasonFilter]);
  const logoUrlInputRef = useRef<HTMLInputElement | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedLogoName, setSelectedLogoName] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadMessage, setLogoUploadMessage] = useState("");
  const editLogoInputRef = useRef<HTMLInputElement | null>(null);
  const editLogoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [editLogoUploadMessage, setEditLogoUploadMessage] = useState("");
  const editParticipationLogoInputRef = useRef<HTMLInputElement | null>(null);
  const editParticipationLogoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [editParticipationLogoUploadMessage, setEditParticipationLogoUploadMessage] = useState("");
  const [editingRegistryTeam, setEditingRegistryTeam] = useState(false);

  const registryTeams = [...data.teams].sort((left,right) => {
    const leftName=String(left.name ?? "").normalize("NFC");
    const rightName=String(right.name ?? "").normalize("NFC");
    return leftName.localeCompare(rightName, "el");
  });
  const selectedRegistryTeam = registryTeams.find((team)=>String(team.id) === String(selectedRegistryTeamId));
  const selectedTeamParticipations = selectedRegistryTeamId
    ? data.participations.filter((participation)=>String(participation.team_id ?? "") === String(selectedRegistryTeamId))
    : [];
  const selectedTeamHasCompletedHistory = selectedTeamParticipations.some((participation) => {
    const participationCompetition = competitionById.get(String(participation.competition_id ?? ""));
    const competitionStatus = String(participationCompetition?.lifecycle_status ?? "under_construction");
    const participationSeasonId = String(participation.season_id ?? String(participationCompetition?.season_id ?? ""));
    const seasonStatus = String(seasonById.get(participationSeasonId)?.status ?? "");
    return isCompletedCompetition(competitionStatus) || isCompletedCompetition(seasonStatus);
  });
  const selectedTeamHasActiveParticipation = selectedTeamParticipations.some((participation) => {
    const participationCompetition = competitionById.get(String(participation.competition_id ?? ""));
    const competitionStatus = String(participationCompetition?.lifecycle_status ?? "under_construction");
    const participationSeasonId = String(participation.season_id ?? String(participationCompetition?.season_id ?? ""));
    const seasonStatus = String(seasonById.get(participationSeasonId)?.status ?? "");
    return !isCompletedCompetition(competitionStatus) && !isCompletedCompetition(seasonStatus);
  });
  const selectedTeamCanDelete = selectedRegistryTeamId
    && !selectedTeamHasCompletedHistory
    && !selectedTeamHasActiveParticipation;

  async function uploadLogoFile(file: File) {
    setSelectedLogoName(file.name);
    setLogoUploadMessage("");
    setUploadingLogo(true);
    if (logoUrlInputRef.current) logoUrlInputRef.current.value = "";

    try {
      const fd = new FormData();
      fd.append("logo", file);
      fd.append("teamId", ""); // temporary bucket path
      const resp = await fetch("/api/admin/team-logo-route", { method: "POST", body: fd });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload.error || "Upload failed");
      if (logoUrlInputRef.current) logoUrlInputRef.current.value = payload.logoUrl ?? "";
      setLogoUploadMessage("Το λογότυπο ανέβηκε.");
    } catch (err) {
      setSelectedLogoName("");
      setLogoUploadMessage("");
      if (logoFileInputRef.current) logoFileInputRef.current.value = "";
      void alert(String(err));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function uploadEditTeamLogo(file: File) {
    setEditLogoUploadMessage("");
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      fd.append("teamId", "");
      const resp = await fetch("/api/admin/team-logo-route", { method: "POST", body: fd });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload.error || "Upload failed");
      if (editLogoInputRef.current) editLogoInputRef.current.value = payload.logoUrl ?? "";
      setEditLogoUploadMessage("Το λογότυπο ανέβηκε.");
    } catch (err) {
      setEditLogoUploadMessage("");
      if (editLogoFileInputRef.current) editLogoFileInputRef.current.value = "";
      void alert(String(err));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function uploadParticipationLogoFile(file: File, teamId:string) {
    setEditParticipationLogoUploadMessage("");
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      fd.append("teamId", teamId);
      const resp = await fetch("/api/admin/team-logo-route", { method: "POST", body: fd });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload.error || "Upload failed");
      if (editParticipationLogoInputRef.current) editParticipationLogoInputRef.current.value = payload.logoUrl ?? "";
      setEditParticipationLogoUploadMessage("Το λογότυπο ανέβηκε.");
    } catch (err) {
      setEditParticipationLogoUploadMessage("");
      if (editParticipationLogoFileInputRef.current) editParticipationLogoFileInputRef.current.value = "";
      void alert(String(err));
    } finally {
      setUploadingLogo(false);
    }
  }

  return <>
    <Panel title="Νέα ομάδα" description="Η ομάδα δημιουργείται μία φορά στο ενιαίο μητρώο και μπορεί να χρησιμοποιείται σε πολλές σεζόν και διοργανώσεις.">
      <form onSubmit={(event)=>void submit("teams",event)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Ονομασία"><input required name="name" className={inputClass}/></Field>
        <Field label="Πόλη"><input name="city" defaultValue="Κομοτηνή" className={inputClass}/></Field>
        <Field label="Επιλογή Λογότυπου">
          <div className="flex flex-col gap-2">
            <input ref={logoUrlInputRef} type="hidden" name="logoUrl" />
            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadLogoFile(file);
              }}
            />
            <button
              type="button"
              disabled={uploadingLogo}
              onClick={() => logoFileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:border-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadingLogo ? "Μεταφόρτωση..." : "Επιλογή Λογότυπου"}
            </button>
            {selectedLogoName ? (
              <p className="text-xs text-zinc-500">
                {selectedLogoName}{logoUploadMessage ? ` · ${logoUploadMessage}` : ""}
              </p>
            ) : null}
          </div>
        </Field>
        <button disabled={busy || uploadingLogo} className={`${buttonClass} self-end`}>Προσθήκη ομάδας</button>
      </form>
    </Panel>

    <Panel title="Συμμετοχή ομάδας σε διοργάνωση" description="Επίλεξε τη σεζόν, τη διοργάνωση και τις ομάδες για πολλαπλή προσθήκη.">
      <form onSubmit={(event)=>{event.preventDefault(); void submitBulkParticipation();}} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Σεζόν">
          <select required name="seasonId" value={selectedSeasonId} onChange={(event) => { const next = event.target.value; setSelectedSeasonId(next); setSelectedCompetitionId(""); setTeamSeasonFilter("all"); setSelectedParticipationTeamIds([]); }} className={inputClass}>
            <option value="">Επιλογή</option>
            {data.seasons.map((season)=><option key={String(season.id)} value={String(season.id)}>{season.name}</option>)}
          </select>
        </Field>
        <Field label="Διοργάνωση">
          <select required name="competitionId" value={selectedCompetitionId} disabled={!selectedSeasonId} onChange={(event)=>{const nextCompetitionId=event.target.value; setSelectedCompetitionId(nextCompetitionId); setSelectedParticipationTeamIds([]); if(nextCompetitionId){ const fallback = defaultSourceSeasonId(selectedSeasonId); setTeamSeasonFilter(fallback || "all"); }}}
          className={inputClass}>
            <option value="">{selectedSeasonId ? "Επιλογή" : "Επίλεξε πρώτα σεζόν"}</option>
            {availableCompetitions.map((competition)=><option key={String(competition.id)} value={String(competition.id)}>{competition.name}</option>)}
          </select>
        </Field>
        <Field label="Ομάδες">
          {!selectedCompetitionId ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm font-bold text-zinc-700">Επίλεξε πρώτα σεζόν και διοργάνωση</div>
          ) : (
            <>
              <label className="mb-1 block">
                <span className="text-sm font-bold text-zinc-700">Ομάδες από σεζόν</span>
                <select value={teamSeasonFilter} onChange={(event)=>setTeamSeasonFilter(event.target.value)} disabled={!selectedCompetitionId} className={`${inputClass} mt-1`}>
                  <option value="all">Όλες οι ομάδες του Μητρώου</option>
                  {previousSeasonOptions.map((season)=><option key={String(season.id)} value={String(season.id)}>{season.name}</option>)}
                </select>
              </label>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={toggleAllParticipationTeams}
                  className="self-start rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-black text-orange-900 transition hover:border-orange-400"
                >
                  {allParticipationTeamsSelected ? "Αποεπιλογή όλων" : "Επιλογή όλων"}
                </button>
                <div className="max-h-56 overflow-auto rounded-xl border border-zinc-200 bg-white p-2">
                  <div className="grid gap-2">
                    {availableParticipationTeams.length ? availableParticipationTeams.map((team)=><label key={String(team.id)} className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2 py-1.5 text-sm text-zinc-800">
                    <input
                        type="checkbox"
                        checked={selectedParticipationTeamIds.includes(String(team.id))}
                        disabled={existingTeamIdsInCompetition.has(String(team.id))}
                        onChange={(event)=>toggleParticipationTeam(String(team.id), event.target.checked)}
                      />
                      <span className="flex-1">{team.name}</span>
                      {existingTeamIdsInCompetition.has(String(team.id)) ? <span className="ml-auto text-xs font-black uppercase text-zinc-500">Ήδη συμμετέχει</span> : null}
                    </label>) : <p className="px-2 py-1.5 text-sm text-zinc-500">Δεν υπάρχουν ενεργές ομάδες.</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </Field>
        <button
          disabled={busy || !selectedSeasonId || !availableCompetitions.length || !selectedCompetitionId || !selectedParticipationTeamIds.some((teamId)=>!existingTeamIdsInCompetition.has(teamId))}
          className={`${buttonClass} self-end`}
        >
          Προσθήκη επιλεγμένων ομάδων
        </button>
      </form>
      {selectedSeasonId && !availableCompetitions.length && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Δεν υπάρχει ακόμη διοργάνωση για την επιλεγμένη σεζόν.</p>}
    </Panel>

    <Panel title="Συμμετοχές ομάδων" description="Η απενεργοποίηση ή η αποχώρηση μιας συμμετοχής δεν διαγράφει την ομάδα, το ρόστερ ή το ιστορικό της.">
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:max-w-3xl">
        <Field label="Σεζόν">
          <select
            value={participationFilterSeasonId}
            onChange={(event)=>setParticipationFilterSeasonId(event.target.value)}
            className={inputClass}
          >
            {historicalSeasons.map((season)=><option key={String(season.id)} value={String(season.id)}>{season.name}</option>)}
          </select>
        </Field>
        <Field label="Διοργάνωση">
          <select
            value={participationFilterCompetitionId}
            disabled={!participationFilterSeasonId}
            onChange={(event)=>setParticipationFilterCompetitionId(event.target.value)}
            className={inputClass}
          >
            <option value="">Όλες οι διοργανώσεις</option>
            {availableCompetitionParticipations.map((competition)=><option key={String(competition.id)} value={String(competition.id)}>{competition.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {data.participations
          .filter((participation) => {
            const participationSeasonId = String(participation.season_id ?? "");
            const competitionSeasonId = String(competitionSeasonById.get(String(participation.competition_id ?? "")) ?? "");
            const seasonMatch = participationSeasonId === participationFilterSeasonId || competitionSeasonId === participationFilterSeasonId;
            if (!seasonMatch) return false;
            if (participationFilterCompetitionId && String(participation.competition_id ?? "") !== participationFilterCompetitionId) return false;
            return true;
          })
          .map((participation)=>{
          const id=String(participation.id);
          const isEditing=editingParticipationId===id;
          const status=String(participation.status ?? "active");
          const participationCompetition = competitionById.get(String(participation.competition_id ?? ""));
          const season = seasonById.get(String(participation.season_id ?? String(participationCompetition?.season_id ?? "")));
          const canRemoveParticipation = !isCompletedCompetition(String(participationCompetition?.lifecycle_status ?? "")) && !isCompletedCompetition(String(season?.status ?? ""));
          return <article key={id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-orange-600">{participation.season_name} · {participation.competition_name}</p>
                <h3 className="mt-1 text-lg font-black text-zinc-950">{participation.team_name}</h3>
                <p className="mt-1 text-sm text-zinc-600">Μόνιμη ομάδα: {participation.team_name}{participation.seed ? ` · seed ${participation.seed}` : ""}</p>
                <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${status==="active"?"bg-emerald-100 text-emerald-800":status==="withdrawn"?"bg-red-100 text-red-700":"bg-zinc-200 text-zinc-700"}`}>{participationStatusLabels[status] ?? status}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingParticipationId(isEditing ? null : id);
                  setEditParticipationLogoUploadMessage("");
                  if (editParticipationLogoInputRef.current) editParticipationLogoInputRef.current.value = String(participation.logo_url ?? "");
                  if (editParticipationLogoFileInputRef.current) editParticipationLogoFileInputRef.current.value = "";
                }}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500"
              >
                {isEditing ? "Ακύρωση" : "Edit"}
              </button>
            </div>
            {isEditing && <form onSubmit={async(event)=>{if(await updateEntity("participations",id,event,"Οι αλλαγές στη συμμετοχή της ομάδας αποθηκεύτηκαν."))setEditingParticipationId(null);}} className="mt-5 grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-2">
              <Field label="Ονομασία στη σεζόν"><input required name="displayName" defaultValue={String(participation.display_name ?? participation.team_name ?? "")} className={inputClass}/></Field>
              <Field label="Επιλογή Λογότυπου στη σεζόν">
                <div className="flex flex-col gap-2">
                  <input ref={editParticipationLogoInputRef} type="hidden" name="logoUrl" defaultValue={String(participation.logo_url ?? "")} />
                  <input
                    ref={editParticipationLogoFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void uploadParticipationLogoFile(file, String(participation.team_id ?? ""));
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={() => editParticipationLogoFileInputRef.current?.click()}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:border-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {uploadingLogo ? "Μεταφόρτωση..." : "Επιλογή Λογότυπου"}
                  </button>
                  {editParticipationLogoUploadMessage ? <p className="text-xs text-zinc-500">{editParticipationLogoUploadMessage}</p> : null}
                </div>
              </Field>
              <div className="sm:col-span-2 flex flex-wrap justify-between gap-3">
                <button disabled={busy} className={buttonClass}>Αποθήκευση συμμετοχής</button>
                <button
                  type="button"
                  disabled={busy || !canRemoveParticipation}
                  onClick={async()=>{
                    const teamName = String(participation.team_name ?? participation.display_name ?? "");
                    const competitionName = String(participation.competition_name ?? "");
                    const confirmMessage = `Να αφαιρεθεί η ομάδα ${teamName} από τη διοργάνωση ${competitionName}; Η μόνιμη ομάδα δεν θα διαγραφεί.`;
                    if (!window.confirm(confirmMessage)) return;
                    if (await deleteEntity("participations", id, `Η ομάδα ${teamName} αφαιρέθηκε από τη διοργάνωση.`)) {
                      setEditingParticipationId(null);
                    }
                  }}
                  className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Αφαίρεση ομάδας από τη διοργάνωση
                </button>
              </div>
            </form>}
          </article>;
        })}
        {!data.participations
          .filter((participation) => {
            const participationSeasonId = String(participation.season_id ?? "");
            const competitionSeasonId = String(competitionSeasonById.get(String(participation.competition_id ?? "")) ?? "");
            const seasonMatch = participationSeasonId === participationFilterSeasonId || competitionSeasonId === participationFilterSeasonId;
            if (!seasonMatch) return false;
            if (participationFilterCompetitionId && String(participation.competition_id ?? "") !== participationFilterCompetitionId) return false;
            return true;
          }).length && <p className="text-sm text-zinc-500">Δεν υπάρχουν συμμετοχές για τα επιλεγμένα φίλτρα.</p>}
      </div>
    </Panel>

    <Panel title="Μητρώο ομάδων" description="Τα στοιχεία εδώ ανήκουν στη μόνιμη εγγραφή της ομάδας. Η επεξεργασία τους δεν δημιουργεί νέα ομάδα και δεν αλλάζει τις παλιές συμμετοχές της.">
      <div className="grid gap-4">
        <Field label="Επιλογή ομάδας">
          <select
            value={selectedRegistryTeamId}
            onChange={(event)=>{
              setSelectedRegistryTeamId(event.target.value);
              setEditingRegistryTeam(false);
              setEditLogoUploadMessage("");
            }}
            className={inputClass}
          >
            <option value="">Επίλεξε ομάδα για επεξεργασία</option>
            {registryTeams.map((team)=><option key={String(team.id)} value={String(team.id)}>{team.name}</option>)}
          </select>
        </Field>
        {!selectedRegistryTeam && <p className="text-sm text-zinc-500">Διάλεξε μια ομάδα για να την επεξεργαστείς.</p>}
        {selectedRegistryTeam && (
          <article className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-zinc-950">{selectedRegistryTeam.name}</h3>
                <p className="mt-1 text-sm text-zinc-600">{selectedRegistryTeam.city || "—"}</p>
                <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${Number(selectedRegistryTeam.active ?? 1)===1?"bg-emerald-100 text-emerald-800":"bg-zinc-200 text-zinc-700"}`}>{Number(selectedRegistryTeam.active ?? 1)===1?"Ενεργή":"Ανενεργή"}</span>
              </div>
              <button type="button" onClick={()=>setEditingRegistryTeam((value)=>!value)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500">{editingRegistryTeam ? "Ακύρωση" : "Edit"}</button>
            </div>
            {editingRegistryTeam && (
              <form
                key={String(selectedRegistryTeam.id)}
                onSubmit={async(event)=>{if(await updateEntity("teams",String(selectedRegistryTeam.id),event,"Τα μόνιμα στοιχεία της ομάδας αποθηκεύτηκαν.")){setEditingRegistryTeam(false);}}}
                className="mt-5 grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-2"
              >
                <Field label="Ονομασία"><input required name="name" defaultValue={String(selectedRegistryTeam.name ?? "")} className={inputClass}/></Field>
                <Field label="Πόλη"><input name="city" defaultValue={String(selectedRegistryTeam.city ?? "Κομοτηνή")} className={inputClass}/></Field>
              <Field label="Κατάσταση">
                  <select name="active" defaultValue={Number(selectedRegistryTeam.active ?? 1)===1 ? "1" : "0"} className={inputClass}>
                    <option value="1">Ενεργή</option><option value="0">Ανενεργή</option>
                  </select>
                </Field>
                <Field label="Επιλογή Λογότυπου">
                  <div className="flex flex-col gap-2">
                    <input ref={editLogoInputRef} type="hidden" name="logoUrl" defaultValue={String(selectedRegistryTeam.logo_url ?? "")} />
                    <input
                      ref={editLogoFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="sr-only"
                      onChange={(event)=>{
                        const file = event.currentTarget.files?.[0];
                        if (file) void uploadEditTeamLogo(file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={uploadingLogo}
                      onClick={() => editLogoFileInputRef.current?.click()}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:border-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {uploadingLogo ? "Μεταφόρτωση..." : "Επιλογή Λογότυπου"}
                    </button>
                    {editLogoUploadMessage ? <p className="text-xs text-zinc-500">{editLogoUploadMessage}</p> : null}
                  </div>
                </Field>
                <button disabled={busy} className={`${buttonClass} sm:col-span-2 sm:justify-self-start`}>Αποθήκευση ομάδας</button>
                <div className="sm:col-span-2 flex flex-wrap gap-3">
                  {!selectedTeamCanDelete && selectedTeamParticipations.length > 0 ? (
                    <p className="w-full text-sm text-red-700">
                      {selectedTeamHasCompletedHistory
                        ? "Η ομάδα έχει ιστορικό συμμετοχής και δεν μπορεί να διαγραφεί."
                        : "Η ομάδα συμμετέχει ακόμη σε ενεργή διοργάνωση. Αφαίρεσέ την πρώτα από τη διοργάνωση και δοκίμασε ξανά."}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || !selectedTeamCanDelete}
                    onClick={async()=>{
                      const teamName=String(selectedRegistryTeam.name ?? "");
                      const confirmMessage = `Να διαγραφεί οριστικά η ομάδα ${teamName} από το Μητρώο; Η ενέργεια δεν μπορεί να αναιρεθεί.`;
                      if (!window.confirm(confirmMessage)) return;
                      if (await deleteEntity("teams", String(selectedRegistryTeam.id), `Η ομάδα ${teamName} διαγράφηκε από το Μητρώο.`)) {
                        setSelectedRegistryTeamId("");
                        setEditingRegistryTeam(false);
                      }
                    }}
                    className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Διαγραφή ομάδας
                  </button>
                </div>
              </form>
            )}
          </article>
        )}
      </div>
    </Panel>
  </>;
}

function Players({data}:{data:Snapshot}) {
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");

  const [selectedTeamRoster, setSelectedTeamRoster] = useState<TeamRosterManagementView | null>(null);
  const [teamRosterLoading, setTeamRosterLoading] = useState(false);
  const [teamRosterError, setTeamRosterError] = useState("");
  const [manualRosterInitialized, setManualRosterInitialized] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");

  const [searchMode, setSearchMode] = useState<RosterActionKind>("athlete");
  const [searchText, setSearchText] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<(SearchAthleteResult | SearchStaffResult)[]>([]);

  const [addMode, setAddMode] = useState<"existing" | "new">("existing");
  const [showAddRosterModal, setShowAddRosterModal] = useState(false);
  const [newAthleteFirstName, setNewAthleteFirstName] = useState("");
  const [newAthleteLastName, setNewAthleteLastName] = useState("");
  const [newAthleteBirthDate, setNewAthleteBirthDate] = useState("");
  const [newAthletePhotoUrl, setNewAthletePhotoUrl] = useState("");
  const [newAthleteShirtNumber, setNewAthleteShirtNumber] = useState("");
  const [newAthleteUploadMessage, setNewAthleteUploadMessage] = useState("");
  const [newAthleteUploadBusy, setNewAthleteUploadBusy] = useState(false);
  const [newStaffFirstName, setNewStaffFirstName] = useState("");
  const [newStaffLastName, setNewStaffLastName] = useState("");
  const [newStaffBirthDate, setNewStaffBirthDate] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<TeamRosterViewRole>("other");
  const [newStaffCustomRoleLabel, setNewStaffCustomRoleLabel] = useState("");
  const [newStaffPhotoUrl, setNewStaffPhotoUrl] = useState("");
  const [newStaffUploadMessage, setNewStaffUploadMessage] = useState("");
  const [newStaffUploadBusy, setNewStaffUploadBusy] = useState(false);

  const [editingAthlete, setEditingAthlete] = useState<TeamRosterAthleteWithIndex | null>(null);
  const [editingAthleteFirstName, setEditingAthleteFirstName] = useState("");
  const [editingAthleteLastName, setEditingAthleteLastName] = useState("");
  const [editingAthleteBirthDate, setEditingAthleteBirthDate] = useState("");
  const [editingAthletePhotoUrl, setEditingAthletePhotoUrl] = useState("");
  const [editingAthleteShirtNumber, setEditingAthleteShirtNumber] = useState("");
  const [editingAthleteUploadBusy, setEditingAthleteUploadBusy] = useState(false);
  const [editingAthleteUploadMessage, setEditingAthleteUploadMessage] = useState("");
  const [editingStaff, setEditingStaff] = useState<TeamRosterStaffWithIndex | null>(null);
  const [editingStaffFirstName, setEditingStaffFirstName] = useState("");
  const [editingStaffLastName, setEditingStaffLastName] = useState("");
  const [editingStaffBirthDate, setEditingStaffBirthDate] = useState("");
  const [editingStaffPhotoUrl, setEditingStaffPhotoUrl] = useState("");
  const [editingStaffRole, setEditingStaffRole] = useState<TeamRosterViewRole>("other");
  const [editingStaffCustomRoleLabel, setEditingStaffCustomRoleLabel] = useState("");
  const [editingStaffUploadBusy, setEditingStaffUploadBusy] = useState(false);
  const [editingStaffUploadMessage, setEditingStaffUploadMessage] = useState("");

  const [athleteSort, setAthleteSort] = useState<SortState>({ key: "last_name", direction: "asc" });
  const [staffSort, setStaffSort] = useState<SortState>({ key: "staff_first_name", direction: "asc" });

  const competitionsForSelectedSeason = useMemo(() => data.competitions
    .filter((competition) => String(competition.season_id) === selectedSeasonId)
    .sort((left, right) => String(left.name).localeCompare(String(right.name), "el-GR", { sensitivity: "base" })), [data.competitions, selectedSeasonId]);

  const teamsForSelection = useMemo(() => {
    if (!selectedCompetitionId) return [] as Row[];
    const collected = data.participations
      .filter((participation) =>
        String(participation.competition_id) === selectedCompetitionId &&
        String(participation.status ?? "") !== "withdrawn"
      )
      .map((participation) => {
        return {
          id: participation.team_id,
          name: participation.team_name ?? participation.team_id ?? "",
        } satisfies Row;
      })
      .filter((team) => String(team.id));
    const unique = new Map<string, Row>();
    for (const team of collected) {
      if (!String(team.id)) continue;
      unique.set(String(team.id), team);
    }
    return [...unique.values()].sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? ""), "el-GR", { sensitivity: "base" }));
  }, [data.participations, selectedCompetitionId]);

  const loadRoster = useCallback(async () => {
    if (!selectedSeasonId || !selectedCompetitionId || !selectedTeamId) {
      setSelectedTeamRoster(null);
      setManualRosterInitialized(false);
      return;
    }

    setTeamRosterLoading(true);
    setTeamRosterError("");
    try {
      const request = await fetch(`/api/admin/league?view=team-roster&seasonId=${selectedSeasonId}&competitionId=${selectedCompetitionId}&teamId=${selectedTeamId}`, { cache: "no-store" });
      const payload = await request.json();
      if (!request.ok || payload?.view !== "team-roster") {
        throw new Error(payload?.error || "Αποτυχία φόρτωσης ρόστερ.");
      }
      setSelectedTeamRoster(payload.data as TeamRosterManagementView);
    } catch (error) {
      setTeamRosterError(error instanceof Error ? error.message : "Αποτυχία φόρτωσης ρόστερ.");
    } finally {
      setTeamRosterLoading(false);
    }
  }, [selectedSeasonId, selectedCompetitionId, selectedTeamId]);

  const refreshSelectedRoster = useCallback(async () => {
    await loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    void loadRoster();
  }, [selectedSeasonId, selectedCompetitionId, selectedTeamId]);

  const isSelectionComplete = Boolean(selectedSeasonId && selectedCompetitionId && selectedTeamId);
  const hasSelectedTargetRoster = manualRosterInitialized || Boolean(
    selectedTeamRoster?.previousRoster.targetAthleteRosterExists || selectedTeamRoster?.previousRoster.targetStaffRosterExists,
  );
  const hasPreviousRoster = Boolean(
    (selectedTeamRoster?.previousRoster.previousAthleteCount ?? 0) > 0 ||
    (selectedTeamRoster?.previousRoster.previousStaffCount ?? 0) > 0 ||
    (selectedTeamRoster?.previousRoster.seasonName ?? ""),
  );

  const athletesWithIndex = useMemo(() => {
    return (selectedTeamRoster?.athletes ?? []).map((athlete, index) => ({ ...athlete, rowIndex: index + 1 }));
  }, [selectedTeamRoster?.athletes]);

  const staffWithIndex = useMemo(() => {
    return (selectedTeamRoster?.staff ?? []).map((member, index) => ({ ...member, rowIndex: index + 1 }));
  }, [selectedTeamRoster?.staff]);

  const sortedAthletes = useMemo(() => {
    const list = [...athletesWithIndex];
    list.sort((left, right) => {
      if (athleteSort.key === "first_name") {
        return compareNullable(
          left.first_name ?? left.display_name,
          right.first_name ?? right.display_name,
          athleteSort.direction,
        );
      }
      if (athleteSort.key === "last_name") {
        return compareNullable(
          left.last_name ?? left.display_name,
          right.last_name ?? right.display_name,
          athleteSort.direction,
        );
      }
      if (athleteSort.key === "birth_date") return compareNullable(left.birth_date, right.birth_date, athleteSort.direction);
      return compareNullable(left.shirt_number, right.shirt_number, athleteSort.direction);
    });
    return list;
  }, [athletesWithIndex, athleteSort]);

  const sortedStaff = useMemo(() => {
    const list = [...staffWithIndex];
    list.sort((left, right) => {
      if (staffSort.key === "staff_first_name") {
        return compareNullable(
          left.first_name ?? left.display_name ?? "",
          right.first_name ?? right.display_name ?? "",
          staffSort.direction,
        );
      }
      if (staffSort.key === "staff_last_name") {
        return compareNullable(
          left.last_name ?? left.display_name ?? "",
          right.last_name ?? right.display_name ?? "",
          staffSort.direction,
        );
      }
      return compareNullable(
        left.role,
        right.role,
        staffSort.direction,
      );
    });
    return list;
  }, [staffWithIndex, staffSort]);

  const showActionNotice = (message:string) => {
    setNoticeMessage(message);
    window.setTimeout(() => {
      setNoticeMessage("");
    }, 3500);
  };

  const parseShirtNumber = (value:string) => {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Μη έγκυρος αριθμός φανέλας.");
    return parsed;
  };

  const resetAddFormForAthlete = () => {
    setSearchText("");
    setSearchResults([]);
    setSearchError("");
    setAddMode("existing");
    setNewAthleteFirstName("");
    setNewAthleteLastName("");
    setNewAthleteBirthDate("");
    setNewAthletePhotoUrl("");
    setNewAthleteShirtNumber("");
    setNewAthleteUploadMessage("");
    setNewAthleteUploadBusy(false);
  };

  const resetAddFormForStaff = () => {
    setSearchText("");
    setSearchResults([]);
    setSearchError("");
    setAddMode("existing");
    setNewStaffFirstName("");
    setNewStaffLastName("");
    setNewStaffBirthDate("");
    setNewStaffRole("other");
    setNewStaffCustomRoleLabel("");
    setNewStaffPhotoUrl("");
    setNewStaffUploadMessage("");
    setNewStaffUploadBusy(false);
  };

  const closeAddRosterModal = () => {
    setShowAddRosterModal(false);
    setSearchMode("athlete");
    resetAddFormForAthlete();
    resetAddFormForStaff();
  };

  async function uploadEntityPhoto(file: File, labelSetter: (value: string) => void, busySetter: (value: boolean) => void, messageSetter: (value: string) => void) {
    const fd = new FormData();
    fd.append("logo", file);
    fd.append("teamId", "");
    busySetter(true);
    messageSetter("");
    try {
      const response = await fetch("/api/admin/team-logo-route", { method: "POST", body: fd });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Το upload απέτυχε.");
      const logoUrl = String(payload.logoUrl ?? "");
      if (!logoUrl) throw new Error("Λείπει το url.");
      labelSetter(logoUrl);
      messageSetter("Η φωτογραφία ανέβηκε.");
    } catch (error) {
      messageSetter(error instanceof Error ? error.message : "Το upload απέτυχε.");
    } finally {
      busySetter(false);
    }
  }

  const addSearchResultLabel = (item: SearchAthleteResult | SearchStaffResult) => {
    const first = item.first_name?.trim();
    const last = item.last_name?.trim();
    const fullName = [first, last].filter(Boolean).join(" ");
    const fallback = String(item.display_name ?? "—");
    return fullName || fallback;
  };

  const athleteResultDisplayName = (item: SearchAthleteResult) => {
    const first = item.first_name?.trim();
    const last = item.last_name?.trim();
    if (first && last) return `${last} ${first}`;
    return addSearchResultLabel(item);
  };

  const formatAthleteDob = (isoDate: string | null | undefined) => {
    if (!isoDate) return "Ημ. Γέννησης: —";
    const parsed = parseDateForDisplay(isoDate);
    return parsed === "—" ? "Ημ. Γέννησης: —" : `Ημ. Γέννησης: ${parsed}`;
  };

  async function runRosterPatch(action: string, payload: Record<string, unknown>, successMessage:string) {
    if (!selectedSeasonId || !selectedCompetitionId || !selectedTeamId) return;
    setActionBusy(true);
    setTeamRosterError("");
    try {
      const response = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responsePayload = await response.json();
      if (!response.ok) throw new Error(responsePayload.error || "Η ενέργεια απέτυχε.");
      showActionNotice(successMessage);
      await refreshSelectedRoster();
    } catch (error) {
      setTeamRosterError(error instanceof Error ? error.message : "Η ενέργεια απέτυχε.");
    } finally {
      setActionBusy(false);
    }
  }

  async function runExistingSearch() {
    if (!searchText.trim()) return;
    setIsSearching(true);
    setSearchError("");
    try {
      const response = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: searchMode === "athlete" ? "searchAthletes" : "searchStaff",
          query: searchText.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Αποτυχία αναζήτησης.");
      setSearchResults(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Αποτυχία αναζήτησης.");
    } finally {
      setIsSearching(false);
    }
  }

  async function addExistingAthleteRow(playerId: string, shirtNumber:string) {
    await runRosterPatch("addExistingAthlete", {
      action: "addExistingAthlete",
      playerId,
      seasonId: selectedSeasonId,
      competitionId: selectedCompetitionId,
      teamId: selectedTeamId,
      shirtNumber: parseShirtNumber(shirtNumber),
    }, "Ο αθλητής προστέθηκε στο ρόστερ.");
    closeAddRosterModal();
  }

  async function createAthleteWithRosterRow() {
    if (!newAthleteFirstName.trim() || !newAthleteLastName.trim()) {
      setSearchError("Απαιτείται όνομα και επώνυμο.");
      return;
    }
    await runRosterPatch("createAthleteWithRoster", {
      action: "createAthleteWithRoster",
      firstName: newAthleteFirstName.trim(),
      lastName: newAthleteLastName.trim(),
      birthDate: newAthleteBirthDate || null,
      photoUrl: newAthletePhotoUrl || null,
      seasonId: selectedSeasonId,
      competitionId: selectedCompetitionId,
      teamId: selectedTeamId,
      shirtNumber: parseShirtNumber(newAthleteShirtNumber),
    }, "Ο νέος αθλητής δημιουργήθηκε και προστέθηκε.");
    closeAddRosterModal();
  }

  async function addExistingStaffRow(staffId: string) {
    await runRosterPatch("addExistingStaff", {
      action: "addExistingStaff",
      staffId,
      seasonId: selectedSeasonId,
      competitionId: selectedCompetitionId,
      teamId: selectedTeamId,
      role: newStaffRole,
      customRoleLabel: newStaffCustomRoleLabel || null,
    }, "Το μέλος Staff προστέθηκε στο ρόστερ.");
    closeAddRosterModal();
  }

  async function createStaffWithRosterRow() {
    if (!newStaffFirstName.trim() || !newStaffLastName.trim()) {
      setSearchError("Απαιτείται όνομα και επώνυμο.");
      return;
    }
    await runRosterPatch("createStaffWithRoster", {
      action: "createStaffWithRoster",
      firstName: newStaffFirstName.trim(),
      lastName: newStaffLastName.trim(),
      birthDate: newStaffBirthDate || null,
      photoUrl: newStaffPhotoUrl || null,
      role: newStaffRole,
      customRoleLabel: newStaffCustomRoleLabel || null,
      seasonId: selectedSeasonId,
      competitionId: selectedCompetitionId,
      teamId: selectedTeamId,
    }, "Το νέο μέλος Staff δημιουργήθηκε και προστέθηκε.");
    closeAddRosterModal();
  }

  async function saveAthleteEdits() {
    if (!editingAthlete) return;
    await runRosterPatch("updateAthleteCanonical", {
      action: "updateAthleteCanonical",
      playerId: editingAthlete.player_id,
      firstName: editingAthleteFirstName.trim() || null,
      lastName: editingAthleteLastName.trim() || null,
      birthDate: editingAthleteBirthDate || null,
      photoUrl: editingAthletePhotoUrl || null,
    }, "Οι αλλαγές αθλητή αποθηκεύτηκαν.");

    await runRosterPatch("updateAthleteShirt", {
      action: "updateAthleteShirt",
      rosterId: editingAthlete.roster_id,
      shirtNumber: parseShirtNumber(editingAthleteShirtNumber),
    }, "Τα στοιχεία ρόστερ αποθηκεύτηκαν.");

    setEditingAthlete(null);
  }

  async function saveStaffEdits() {
    if (!editingStaff) return;
    await runRosterPatch("updateStaffCanonical", {
      action: "updateStaffCanonical",
      staffId: editingStaff.staff_id,
      firstName: editingStaffFirstName.trim() || null,
      lastName: editingStaffLastName.trim() || null,
      birthDate: editingStaffBirthDate || null,
      photoUrl: editingStaffPhotoUrl || null,
    }, "Το προφίλ Staff ενημερώθηκε.");

    await runRosterPatch("updateStaffMembership", {
      action: "updateStaffMembership",
      membershipId: editingStaff.membership_id,
      role: editingStaffRole,
      customRoleLabel: editingStaffCustomRoleLabel || null,
    }, "Οι αλλαγές ρόλου αποθηκεύτηκαν.");

    setEditingStaff(null);
  }

  function sortAthleteColumn(sortKey: "first_name" | "last_name" | "birth_date" | "shirt_number") {
    setAthleteSort((current) => current.key === sortKey ? { ...current, direction: current.direction === "asc" ? "desc" : "asc" } : { key: sortKey, direction: "asc" });
  }

  function sortStaffColumn(sortKey: "staff_first_name" | "staff_last_name" | "staff_role") {
    setStaffSort((current) => current.key === sortKey ? { ...current, direction: current.direction === "asc" ? "desc" : "asc" } : { key: sortKey, direction: "asc" });
  }

  const targetAthleteCount = selectedTeamRoster?.athletes.length ?? 0;
  const targetStaffCount = selectedTeamRoster?.staff.length ?? 0;

  return <>
    <Panel title="Παίκτες & Ρόστερ"><p className="text-sm text-zinc-600">Διαχείριση αθλητών και Staff ανά ομάδα</p></Panel>

    {noticeMessage && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">{noticeMessage}</div>}

    <Panel title="Επιλογή Ρόστερ Ομάδας">
      <div className="grid gap-3 xl:grid-cols-3">
        <Field label="Σεζόν">
          <select
            value={selectedSeasonId}
            onChange={(event) => {
              setSelectedSeasonId(event.target.value);
              setSelectedCompetitionId("");
              setSelectedTeamId("");
            }}
            className={inputClass}
          >
            <option value="">Επίλεξε σεζόν</option>
            {data.seasons.map((season) => <option key={String(season.id)} value={String(season.id)}>{season.name}</option>)}
          </select>
        </Field>
        <Field label="Διοργάνωση">
          <select
            value={selectedCompetitionId}
            disabled={!selectedSeasonId}
            onChange={(event) => {
              setSelectedCompetitionId(event.target.value);
              setSelectedTeamId("");
            }}
            className={inputClass}
          >
            <option value="">Επίλεξε διοργάνωση</option>
            {competitionsForSelectedSeason.map((competition) => (
              <option key={String(competition.id)} value={String(competition.id)}>
                {competition.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ομάδα">
          <select
            value={selectedTeamId}
            disabled={!selectedCompetitionId}
            onChange={(event) => setSelectedTeamId(event.target.value)}
            className={inputClass}
          >
            <option value="">Επίλεξε ομάδα</option>
            {teamsForSelection.map((team) => <option key={String(team.id)} value={String(team.id)}>{team.name}</option>)}
          </select>
        </Field>
      </div>
    </Panel>

    {!isSelectionComplete && <Panel title="Οδηγίες"><p className="text-zinc-700">Επίλεξε σεζόν, διοργάνωση και ομάδα για να εμφανιστεί το ρόστερ.</p></Panel>}

    {teamRosterError ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{teamRosterError}</div> : null}

    {isSelectionComplete && selectedTeamRoster && !teamRosterLoading && (
      <>
        <Panel title={selectedTeamRoster.teamName}>
          <p className="text-sm text-zinc-600">{selectedTeamRoster.competitionName} · {selectedTeamRoster.seasonName}</p>
          <p className="mt-2 text-sm font-bold text-zinc-700">{targetAthleteCount} Αθλητές · {targetStaffCount} Staff</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAddRosterModal(true);
                setSearchMode("athlete");
              }}
              className={buttonClass}
              disabled={actionBusy}
            >
              + Προσθήκη
            </button>
          </div>
        </Panel>

        <Panel title="Αθλητές">
          {selectedTeamRoster.athletes.length > 0 ? <>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs font-black uppercase tracking-wider text-zinc-500 sm:grid-cols-4">
              {[
                ["first_name","Όνομα"],
                ["last_name","Επώνυμο"],
                ["birth_date","Ημ. Γέννησης"],
                ["shirt_number","Νο. Φανέλας"],
              ].map(([key,label]) => (
                <button key={key} type="button" onClick={() => sortAthleteColumn(key as "first_name" | "last_name" | "birth_date" | "shirt_number")} className="text-left hover:text-zinc-900">
                  {label}
                  {athleteSort.key === key ? (athleteSort.direction === "asc" ? " ↑" : " ↓") : ""}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500"><tr>
                  <th className="px-3 py-3">#</th><th className="px-3 py-3">Φωτό</th><th className="px-3 py-3">Όνομα</th><th className="px-3 py-3">Επώνυμο</th><th className="px-3 py-3">Ημ. Γέννησης</th><th className="px-3 py-3">Νο. Φανέλας</th><th className="px-3 py-3">Ενέργειες</th>
                </tr></thead>
                <tbody>
                  {sortedAthletes.map((athlete) => {
                    const firstName = athlete.first_name?.trim() ? athlete.first_name : athlete.display_name;
                    const lastName = athlete.last_name?.trim() ? athlete.last_name : athlete.display_name;
                    return <tr key={athlete.roster_id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-3 font-black">{athlete.rowIndex}</td>
                      <td className="px-3 py-3">
                        {athlete.photo_url
                          ? <img src={athlete.photo_url} alt={firstName ?? ""} className="h-9 w-9 rounded-full object-cover" />
                          : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-500">—</div>}
                      </td>
                      <td className="px-3 py-3">{firstName || "—"}</td>
                      <td className="px-3 py-3">{lastName || "—"}</td>
                      <td className="px-3 py-3">{parseDateForDisplay(String(athlete.birth_date ?? ""))}</td>
                      <td className="px-3 py-3">{athlete.shirt_number ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAthlete(athlete);
                              setEditingAthleteFirstName(athlete.first_name ?? "");
                              setEditingAthleteLastName(athlete.last_name ?? "");
                              setEditingAthleteBirthDate(String(athlete.birth_date ?? ""));
                              setEditingAthletePhotoUrl(String(athlete.photo_url ?? ""));
                              setEditingAthleteShirtNumber(String(athlete.shirt_number ?? ""));
                            }}
                            className="rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-bold"
                          >
                            Επεξεργασία
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!window.confirm("Θέλεις να αφαιρέσεις τον αθλητή από το ρόστερ;")) return;
                              void runRosterPatch("removeAthleteFromRoster", {
                                action: "removeAthleteFromRoster",
                                rosterId: athlete.roster_id,
                              }, "Ο αθλητής αφαιρέθηκε από το ρόστερ.");
                            }}
                            className="rounded-xl border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700"
                          >
                            Αφαίρεση
                          </button>
                        </div>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </> : <p className="text-sm text-zinc-500">Δεν έχουν προστεθεί αθλητές στο ρόστερ.</p>}
        </Panel>

        <Panel title="Staff">
          {selectedTeamRoster.staff.length > 0 ? <>
            <div className="mb-3 grid grid-cols-3 gap-2 text-xs font-black uppercase tracking-wider text-zinc-500 sm:grid-cols-4">
              {[
                ["staff_first_name","Όνομα"],
                ["staff_last_name","Επώνυμο"],
                ["staff_role","Ρόλος"],
              ].map(([key,label]) => <button key={key} type="button" onClick={() => sortStaffColumn(key as "staff_first_name" | "staff_last_name" | "staff_role")} className="text-left hover:text-zinc-900">
                {label}{staffSort.key === key ? (staffSort.direction === "asc" ? " ↑" : " ↓") : ""}
              </button>)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500"><tr>
                  <th className="px-3 py-3">Φωτό</th><th className="px-3 py-3">Όνομα</th><th className="px-3 py-3">Επώνυμο</th><th className="px-3 py-3">Ρόλος</th><th className="px-3 py-3">Ενέργειες</th>
                </tr></thead>
                <tbody>
                  {sortedStaff.map((member) => {
                    const firstName = member.first_name?.trim() ? member.first_name : member.display_name;
                    const lastName = member.last_name?.trim() ? member.last_name : member.display_name;
                    return <tr key={member.membership_id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-3">
                        {member.photo_url
                          ? <img src={member.photo_url} alt={firstName ?? ""} className="h-9 w-9 rounded-full object-cover" />
                          : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs text-zinc-500">—</div>}
                      </td>
                      <td className="px-3 py-3">{firstName || "—"}</td>
                      <td className="px-3 py-3">{lastName || "—"}</td>
                      <td className="px-3 py-3">
                        {member.role === "other" ? (member.custom_role_label || staffRoleLabels.other) : staffRoleLabels[member.role as TeamRosterViewRole] || member.role}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStaff(member);
                              setEditingStaffFirstName(member.first_name ?? "");
                              setEditingStaffLastName(member.last_name ?? "");
                              setEditingStaffBirthDate(String(member.birth_date ?? ""));
                              setEditingStaffPhotoUrl(String(member.photo_url ?? ""));
                              setEditingStaffRole(String(member.role === "other" ? "other" : member.role) as TeamRosterViewRole);
                              setEditingStaffCustomRoleLabel(member.custom_role_label ?? "");
                            }}
                            className="rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-bold"
                          >
                            Επεξεργασία
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!window.confirm("Θέλεις να αφαιρέσεις το μέλος Staff από το ρόστερ;")) return;
                              void runRosterPatch("removeStaffFromRoster", {
                                action: "removeStaffFromRoster",
                                membershipId: member.membership_id,
                              }, "Το μέλος Staff αφαιρέθηκε από το ρόστερ.");
                            }}
                            className="rounded-xl border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700"
                          >
                            Αφαίρεση
                          </button>
                        </div>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </> : <p className="text-sm text-zinc-500">Δεν έχει προστεθεί Staff για αυτή την ομάδα.</p>}
        </Panel>

        {!hasSelectedTargetRoster && (
          <Panel title="Προηγούμενο roster">
            {hasPreviousRoster ? <>
              <p className="text-sm text-zinc-700">Δεν έχει δημιουργηθεί ακόμη ρόστερ για αυτή τη σεζόν.</p>
              <p className="mt-2 text-sm text-zinc-700">Βρέθηκε προηγούμενο ρόστερ: {String(selectedTeamRoster.previousRoster.seasonName ?? "—")}</p>
              <p className="mt-1 text-sm text-zinc-700">{selectedTeamRoster.previousRoster.previousAthleteCount} Αθλητές · {selectedTeamRoster.previousRoster.previousStaffCount} Staff</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Θέλεις να χρησιμοποιήσεις το ρόστερ της ${selectedTeamRoster.previousRoster.seasonName} ως βάση;`)) return;
                    await runRosterPatch("copyPreviousRoster", {
                      action: "copyPreviousRoster",
                      seasonId: selectedSeasonId,
                      competitionId: selectedCompetitionId,
                      teamId: selectedTeamId,
                    }, "Το προηγούμενο ρόστερ αντιγράφηκε.");
                    setManualRosterInitialized(true);
                  }}
                  disabled={actionBusy}
                  className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
                >
                  Χρήση ρόστερ {String(selectedTeamRoster.previousRoster.seasonName ?? "")} ως βάση
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm("Θες να ξεκινήσεις το ρόστερ κενό;")) return;
                    setManualRosterInitialized(true);
                    showActionNotice("Το ρόστερ ξεκίνησε κενό για χειροκίνητες προσθήκες.");
                  }}
                  disabled={actionBusy}
                  className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
                >
                  Έναρξη με κενό ρόστερ
                </button>
              </div>
            </> : <>
              <p className="text-sm text-zinc-700">Δεν υπάρχει προηγούμενο ρόστερ για αυτή την ομάδα.</p>
              <p className="mt-1 text-sm text-zinc-700">Το νέο ρόστερ θα ξεκινήσει κενό.</p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm("Θες να ξεκινήσεις το ρόστερ κενό;")) return;
                    setManualRosterInitialized(true);
                    showActionNotice("Το ρόστερ ξεκίνησε κενό για χειροκίνητες προσθήκες.");
                  }}
                  disabled={actionBusy}
                  className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
                >
                  Έναρξη με κενό ρόστερ
                </button>
              </div>
            </>}
          </Panel>
        )}

        {showAddRosterModal && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-lg font-black text-zinc-950">Προσθήκη στο ρόστερ</h3>
                <button type="button" onClick={() => void closeAddRosterModal()} className="rounded-xl border border-zinc-300 px-3 py-2">Κλείσιμο</button>
              </div>
              <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
                <button
                  type="button"
                  onClick={() => setSearchMode("athlete")}
                  className={`rounded-lg px-4 py-2 text-sm font-black ${searchMode === "athlete" ? "bg-zinc-950 text-white" : "bg-transparent text-zinc-700"}`}
                >
                  Αθλητής
                </button>
                <button
                  type="button"
                  onClick={() => setSearchMode("staff")}
                  className={`rounded-lg px-4 py-2 text-sm font-black ${searchMode === "staff" ? "bg-zinc-950 text-white" : "bg-transparent text-zinc-700"}`}
                >
                  Staff
                </button>
              </div>

              <div className="mb-5 flex flex-wrap gap-2">
                <button type="button" onClick={() => setAddMode("existing")} className={`rounded-lg px-4 py-2 text-sm font-bold ${addMode === "existing" ? "bg-zinc-950 text-white" : "bg-zinc-100"}`}>Υπάρχον</button>
                <button type="button" onClick={() => setAddMode("new")} className={`rounded-lg px-4 py-2 text-sm font-bold ${addMode === "new" ? "bg-zinc-950 text-white" : "bg-zinc-100"}`}>Νέο</button>
              </div>

              {searchMode === "athlete" && addMode === "existing" && (
                <div className="grid gap-3">
                  <Field label="Αναζήτηση αθλητή">
                    <div className="flex gap-2">
                      <input value={searchText} onChange={(event)=>setSearchText(event.target.value)} className={`${inputClass} flex-1`} />
                      <button type="button" onClick={() => void runExistingSearch()} disabled={isSearching} className={buttonClass}>{isSearching ? "Αναζήτηση..." : "Αναζήτηση"}</button>
                    </div>
                  </Field>
                  <Field label="Αριθμός Φανέλας (προαιρετικό)">
                    <input value={newAthleteShirtNumber} onChange={(event)=>setNewAthleteShirtNumber(event.target.value)} className={inputClass} />
                  </Field>
                  {searchError && <p className="text-sm font-bold text-red-600">{searchError}</p>}
                  <div className="mt-2 grid gap-3">
                    {searchResults.map((candidate) => (
                      <article key={(candidate as SearchAthleteResult).player_id} className="rounded-xl border border-zinc-200 p-3">
                        <p className="font-black">{athleteResultDisplayName(candidate as SearchAthleteResult)}</p>
                        <p className="mt-1 text-sm text-zinc-600">
                          {formatAthleteDob((candidate as SearchAthleteResult).birth_date)}
                        </p>
                        <div className="mt-3">
                          <p className="text-xs font-black uppercase tracking-wide text-zinc-500">Ιστορικό συμμετοχών</p>
                          <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                            {(candidate as SearchAthleteResult).career_history.map((entry) => (
                              <li key={`${(candidate as SearchAthleteResult).player_id}-${entry.season_name}-${entry.team_name}`}>
                                Σεζόν {entry.season_name} — {entry.team_name}
                              </li>
                            ))}
                            {!((candidate as SearchAthleteResult).career_history.length) && (
                              <li className="text-zinc-500">Δεν υπάρχουν διαθέσιμα ιστορικά συμμετοχών.</li>
                            )}
                          </ul>
                        </div>
                        <div className="mt-3">
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => void addExistingAthleteRow((candidate as SearchAthleteResult).player_id, newAthleteShirtNumber)}
                            disabled={actionBusy}
                          >
                            Χρήση υπάρχοντος αθλητή
                          </button>
                        </div>
                      </article>
                    ))}
                    {!searchResults.length && !isSearching && <p className="text-sm text-zinc-500">Δεν βρέθηκαν αποτελέσματα.</p>}
                  </div>
                  {Boolean(searchText.trim()) && (
                  <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                    <p className="font-black">Δεν βρήκα αυτόν που θέλω</p>
                    <p className="mt-1 text-sm text-zinc-600">Εάν ο αθλητής δεν υπάρχει στη λίστα, δημιούργησε νέο αθλητή.</p>
                    <div className="mt-3">
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => setAddMode("new")}
                        disabled={actionBusy}
                      >
                          Δημιουργία νέου αθλητή
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              )}

              {searchMode === "athlete" && addMode === "new" && (
                <div className="grid gap-4">
                  <Field label="Όνομα">
                    <input value={newAthleteFirstName} onChange={(event)=>setNewAthleteFirstName(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Επώνυμο">
                    <input value={newAthleteLastName} onChange={(event)=>setNewAthleteLastName(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Ημερομηνία γέννησης">
                    <input type="date" value={newAthleteBirthDate} onChange={(event)=>setNewAthleteBirthDate(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Αριθμός Φανέλας (προαιρετικό)">
                    <input value={newAthleteShirtNumber} onChange={(event)=>setNewAthleteShirtNumber(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Φωτογραφία">
                    <div className="flex items-center gap-2">
                      <input value={newAthletePhotoUrl} readOnly className={inputClass} />
                      <input type="file" accept="image/*" onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (!file) return;
                        void uploadEntityPhoto(file, setNewAthletePhotoUrl, setNewAthleteUploadBusy, setNewAthleteUploadMessage);
                      }} />
                    </div>
                    {newAthleteUploadBusy ? <p className="text-xs text-zinc-500">Φόρτωση εικόνας...</p> : <p className="text-xs text-zinc-500">{newAthleteUploadMessage}</p>}
                  </Field>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void createAthleteWithRosterRow()}
                    disabled={actionBusy}
                  >
                    Δημιουργία νέου αθλητή
                  </button>
                </div>
              )}

              {searchMode === "staff" && addMode === "existing" && (
                <div className="grid gap-3">
                  <Field label="Αναζήτηση Staff">
                    <div className="flex gap-2">
                      <input value={searchText} onChange={(event)=>setSearchText(event.target.value)} className={`${inputClass} flex-1`} />
                      <button type="button" onClick={() => void runExistingSearch()} disabled={isSearching} className={buttonClass}>{isSearching ? "Αναζήτηση..." : "Αναζήτηση"}</button>
                    </div>
                  </Field>
                  <Field label="Ρόλος">
                    <select value={newStaffRole} onChange={(event)=>setNewStaffRole(event.target.value as TeamRosterViewRole)} className={inputClass}>
                      {Object.entries(staffRoleLabels).map(([role,label]) => <option key={role} value={role}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label={newStaffRole === "other" ? "Εξατομικευμένος Ρόλος" : "Εξατομικευμένος Ρόλος (προαιρετικό)"}>
                    <input value={newStaffCustomRoleLabel} onChange={(event)=>setNewStaffCustomRoleLabel(event.target.value)} className={inputClass} disabled={newStaffRole !== "other"} />
                  </Field>
                  {searchError && <p className="text-sm font-bold text-red-600">{searchError}</p>}
                  <div className="mt-2 grid gap-3">
                    {searchResults.map((candidate) => (
                      <article key={(candidate as SearchStaffResult).staff_id} className="rounded-xl border border-zinc-200 p-3">
                        <p className="font-black">{addSearchResultLabel(candidate)}</p>
                        <p className="mt-1 text-sm text-zinc-600">
                          {parseDateForDisplay(candidate.birth_date)} · {candidate.last_team_name ?? "—"} · {candidate.last_season_name ?? "—"}
                        </p>
                        <div className="mt-3">
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => void addExistingStaffRow((candidate as SearchStaffResult).staff_id)}
                            disabled={actionBusy}
                          >
                            Χρήση υπάρχοντος Staff
                          </button>
                        </div>
                      </article>
                    ))}
                    {!searchResults.length && !isSearching && <p className="text-sm text-zinc-500">Δεν βρέθηκαν αποτελέσματα.</p>}
                  </div>
                </div>
              )}

              {searchMode === "staff" && addMode === "new" && (
                <div className="grid gap-4">
                  <Field label="Όνομα">
                    <input value={newStaffFirstName} onChange={(event)=>setNewStaffFirstName(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Επώνυμο">
                    <input value={newStaffLastName} onChange={(event)=>setNewStaffLastName(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Ημερομηνία γέννησης">
                    <input type="date" value={newStaffBirthDate} onChange={(event)=>setNewStaffBirthDate(event.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Ρόλος">
                    <select value={newStaffRole} onChange={(event)=>setNewStaffRole(event.target.value as TeamRosterViewRole)} className={inputClass}>
                      {Object.entries(staffRoleLabels).map(([role,label]) => <option key={role} value={role}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label={newStaffRole === "other" ? "Εξατομικευμένος Ρόλος" : "Εξατομικευμένος Ρόλος (προαιρετικό)"}>
                    <input value={newStaffCustomRoleLabel} onChange={(event)=>setNewStaffCustomRoleLabel(event.target.value)} className={inputClass} disabled={newStaffRole !== "other"} />
                  </Field>
                  <Field label="Φωτογραφία">
                    <div className="flex items-center gap-2">
                      <input value={newStaffPhotoUrl} readOnly className={inputClass} />
                      <input type="file" accept="image/*" onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (!file) return;
                        void uploadEntityPhoto(file, setNewStaffPhotoUrl, setNewStaffUploadBusy, setNewStaffUploadMessage);
                      }} />
                    </div>
                    {newStaffUploadBusy ? <p className="text-xs text-zinc-500">Φόρτωση εικόνας...</p> : <p className="text-xs text-zinc-500">{newStaffUploadMessage}</p>}
                  </Field>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => void createStaffWithRosterRow()}
                    disabled={actionBusy}
                  >
                    Δημιουργία νέου Staff
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {editingAthlete && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-xl rounded-2xl bg-white p-4 sm:p-6">
              <h3 className="text-lg font-black text-zinc-950">Επεξεργασία Αθλητή</h3>
              <div className="mt-4 grid gap-3">
                <Field label="Όνομα">
                  <input value={editingAthleteFirstName} onChange={(event)=>setEditingAthleteFirstName(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Επώνυμο">
                  <input value={editingAthleteLastName} onChange={(event)=>setEditingAthleteLastName(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Ημερομηνία γέννησης">
                  <input type="date" value={editingAthleteBirthDate} onChange={(event)=>setEditingAthleteBirthDate(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Αριθμός φανέλας">
                  <input value={editingAthleteShirtNumber} onChange={(event)=>setEditingAthleteShirtNumber(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Φωτογραφία">
                  <div className="flex items-center gap-2">
                    <input value={editingAthletePhotoUrl} readOnly className={inputClass} />
                    <input type="file" accept="image/*" onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      void uploadEntityPhoto(file, setEditingAthletePhotoUrl, setEditingAthleteUploadBusy, setEditingAthleteUploadMessage);
                    }} />
                  </div>
                  {editingAthleteUploadBusy ? <p className="text-xs text-zinc-500">Φόρτωση εικόνας...</p> : <p className="text-xs text-zinc-500">{editingAthleteUploadMessage}</p>}
                </Field>
                <div className="mt-1 flex gap-2">
                  <button type="button" className={buttonClass} onClick={() => void saveAthleteEdits()} disabled={actionBusy}>
                    Αποθήκευση
                  </button>
                  <button type="button" onClick={() => setEditingAthlete(null)} className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Ακύρωση</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {editingStaff && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-xl rounded-2xl bg-white p-4 sm:p-6">
              <h3 className="text-lg font-black text-zinc-950">Επεξεργασία Staff</h3>
              <div className="mt-4 grid gap-3">
                <Field label="Όνομα">
                  <input value={editingStaffFirstName} onChange={(event)=>setEditingStaffFirstName(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Επώνυμο">
                  <input value={editingStaffLastName} onChange={(event)=>setEditingStaffLastName(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Ημερομηνία γέννησης">
                  <input type="date" value={editingStaffBirthDate} onChange={(event)=>setEditingStaffBirthDate(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Ρόλος">
                  <select value={editingStaffRole} onChange={(event)=>setEditingStaffRole(event.target.value as TeamRosterViewRole)} className={inputClass}>
                    {Object.entries(staffRoleLabels).map(([role,label]) => <option key={role} value={role}>{label}</option>)}
                  </select>
                </Field>
                <Field label={editingStaffRole === "other" ? "Εξατομικευμένος Ρόλος" : "Εξατομικευμένος Ρόλος (προαιρετικό)"}>
                  <input value={editingStaffCustomRoleLabel} onChange={(event)=>setEditingStaffCustomRoleLabel(event.target.value)} className={inputClass} disabled={editingStaffRole !== "other"} />
                </Field>
                <Field label="Φωτογραφία">
                  <div className="flex items-center gap-2">
                    <input value={editingStaffPhotoUrl} readOnly className={inputClass} />
                    <input type="file" accept="image/*" onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      void uploadEntityPhoto(file, setEditingStaffPhotoUrl, setEditingStaffUploadBusy, setEditingStaffUploadMessage);
                    }} />
                  </div>
                  {editingStaffUploadBusy ? <p className="text-xs text-zinc-500">Φόρτωση εικόνας...</p> : <p className="text-xs text-zinc-500">{editingStaffUploadMessage}</p>}
                </Field>
                <div className="mt-1 flex gap-2">
                  <button type="button" className={buttonClass} onClick={() => void saveStaffEdits()} disabled={actionBusy}>
                    Αποθήκευση
                  </button>
                  <button type="button" onClick={() => setEditingStaff(null)} className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Ακύρωση</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    )}

    {teamRosterLoading && isSelectionComplete && <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-zinc-500">Φόρτωση ρόστερ…</div>}
  </>;
}

function Movements({data,depart,busy}:{data:Snapshot;depart:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean}) { const active=data.rosters.filter(r=>r.status==="active"); return <><Panel title="Αποχώρηση παίκτη" description="Η εγγραφή κλείνει, αλλά το ιστορικό ομάδας και σεζόν διατηρείται."><form onSubmit={(e)=>void depart(e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Ενεργό ρόστερ"><select required name="rosterId" className={inputClass}><option value="">Επιλογή</option>{active.map(r=><option key={String(r.id)} value={String(r.id)}>{r.season_name} · {r.player_name} · {r.team_name}</option>)}</select></Field><Field label="Ημερομηνία"><input name="effectiveOn" type="date" className={inputClass}/></Field><Field label="Σημείωση"><input name="note" className={inputClass}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Καταχώριση αποχώρησης</button></form></Panel><Panel title="Ιστορικό μετακινήσεων" description="Καμία μεταγραφή ή αποχώρηση δεν διαγράφει το παρελθόν του παίκτη."><SimpleTable rows={data.movements} columns={[["effective_on","Ημερομηνία"],["player_name","Παίκτης"],["movement_type","Ενέργεια"],["from_team_name","Προηγούμενη ομάδα"],["to_team_name","Νέα ομάδα"],["note","Σημείωση"]]}/></Panel></> }

function PhaseFields({data,phase,competitionId}:{data:Snapshot;phase?:Row;competitionId?:string}) {
  const selectedCompetitionId=competitionId ?? String(phase?.competition_id ?? "");
  const availableSources=data.phases.filter((candidate)=>String(candidate.competition_id)===selectedCompetitionId && String(candidate.id)!==String(phase?.id ?? ""));

  return <>
    <Field label="Ονομασία"><input required name="name" defaultValue={String(phase?.name ?? "")} placeholder="Κανονική περίοδος / Final Four" className={inputClass}/></Field>
    <Field label="Τύπος φάσης"><select name="phaseKind" defaultValue={String(phase?.phase_kind ?? "regular_season")} className={inputClass}>{Object.entries(phaseKindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
    <Field label="Σειρά εμφάνισης"><input name="orderIndex" type="number" min="0" defaultValue={String(phase?.order_index ?? 0)} className={inputClass}/></Field>
    <Field label="Μέγεθος ταμπλό"><input name="bracketSize" type="number" min="2" defaultValue={String(phase?.bracket_size ?? "")} placeholder="8" className={inputClass}/></Field>
    <Field label="Best of"><input name="bestOf" type="number" min="1" step="2" defaultValue={String(phase?.best_of ?? "")} placeholder="3" className={inputClass}/></Field>
    <Field label="Νίκες για πρόκριση"><input name="winsRequired" type="number" min="1" defaultValue={String(phase?.wins_required ?? "")} placeholder="2" className={inputClass}/></Field>
    <Field label="Μεταφορά αποτελέσματος από"><select name="carryOverSourcePhaseId" defaultValue={String(phase?.carry_over_source_phase_id ?? "")} className={inputClass}><option value="">Χωρίς μεταφορά</option>{availableSources.map((source)=><option key={String(source.id)} value={String(source.id)}>{source.name}</option>)}</select></Field>
    <label className="flex items-center gap-2 self-end rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm font-bold text-orange-950"><input name="carryOverEnabled" type="checkbox" defaultChecked={Number(phase?.carry_over_enabled ?? 0) === 1}/> Υπολογισμός μεταφερόμενου αποτελέσματος</label>
  </>;
}

function Schedule({data,submit,updateEntity,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;updateEntity:UpdateEntity;busy:boolean}) {
  const [selectedCompetitionId,setSelectedCompetitionId]=useState("");
  const [editingPhaseId,setEditingPhaseId]=useState<string|null>(null);

  return <>
    <Panel title="Competition Format & φάσεις" description="Κάθε διοργάνωση μπορεί να έχει το δικό της format. Οι φάσεις και οι κανόνες τους μπορούν να αλλάξουν οποιαδήποτε στιγμή χωρίς να διαγράφεται το ιστορικό.">
      <form onSubmit={(event)=>void submit("phases",event)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Διοργάνωση"><select required name="competitionId" value={selectedCompetitionId} onChange={(event)=>setSelectedCompetitionId(event.target.value)} className={inputClass}><option value="">Επιλογή</option>{data.competitions.map((competition)=><option key={String(competition.id)} value={String(competition.id)}>{competition.season_name} · {competition.name}</option>)}</select></Field>
        <PhaseFields data={data} competitionId={selectedCompetitionId}/>
        <button disabled={busy} className={`${buttonClass} sm:col-span-2 xl:col-span-4 xl:justify-self-start`}>Προσθήκη φάσης</button>
      </form>
      <div className="mt-7 grid gap-4 xl:grid-cols-2">
        {data.phases.map((phase)=>{
          const id=String(phase.id);
          const isEditing=editingPhaseId===id;
          return <article key={id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-wider text-orange-600">{phase.season_name} · {phase.competition_name}</p><h3 className="mt-1 text-lg font-black text-zinc-950">{phase.name}</h3><p className="mt-2 text-sm text-zinc-600">{phaseKindLabels[String(phase.phase_kind)] ?? phase.phase_kind} · σειρά {phase.order_index ?? 0}{phase.best_of ? ` · Best of ${phase.best_of}` : ""}{phase.wins_required ? ` · ${phase.wins_required} νίκες` : ""}</p>{Number(phase.carry_over_enabled ?? 0) === 1 && <p className="mt-2 text-xs font-bold text-orange-700">Με μεταφορά αποτελέσματος{phase.carry_over_source_name ? ` από ${phase.carry_over_source_name}` : ""}</p>}</div>
              <button type="button" onClick={()=>setEditingPhaseId(isEditing?null:id)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500">{isEditing?"Ακύρωση":"Edit"}</button>
            </div>
            {isEditing && <form onSubmit={async(event)=>{if(await updateEntity("phases",id,event,"Οι αλλαγές στη φάση και στους κανόνες της αποθηκεύτηκαν."))setEditingPhaseId(null);}} className="mt-5 grid gap-3 border-t border-zinc-200 pt-5 sm:grid-cols-2 xl:grid-cols-4"><input type="hidden" name="competitionId" value={String(phase.competition_id)}/><PhaseFields data={data} phase={phase}/><button disabled={busy} className={`${buttonClass} sm:col-span-2 xl:col-span-4 xl:justify-self-start`}>Αποθήκευση φάσης</button></form>}
          </article>;
        })}
        {!data.phases.length && <p className="text-sm text-zinc-500">Δεν έχουν δημιουργηθεί ακόμη φάσεις.</p>}
      </div>
    </Panel>
    <Panel title="Νέος αγώνας"><form onSubmit={(e)=>void submit("games",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Διοργάνωση"><select required name="competitionId" className={inputClass}><option value="">Επιλογή</option>{data.competitions.map(c=><option key={String(c.id)} value={String(c.id)}>{c.season_name} · {c.name}</option>)}</select></Field><Field label="Φάση"><select name="phaseId" className={inputClass}><option value="">Χωρίς φάση</option>{data.phases.map(p=><option key={String(p.id)} value={String(p.id)}>{p.competition_name} · {p.name}</option>)}</select></Field><Field label="Γύρος / αγωνιστική"><input name="roundLabel" className={inputClass}/></Field><Field label="Ημερομηνία & ώρα"><input name="scheduledAt" type="datetime-local" className={inputClass}/></Field><Field label="Γηπεδούχος"><select required name="homeTeamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Φιλοξενούμενος"><select required name="awayTeamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Γήπεδο"><input name="venue" className={inputClass}/></Field><button disabled={busy} className={`${buttonClass} self-end`}>Προσθήκη αγώνα</button></form></Panel>
    <Panel title="Αγώνες"><SimpleTable rows={data.games} columns={[["scheduled_at","Ημερομηνία"],["phase_name","Φάση"],["round_label","Γύρος"],["home_team_name","Γηπεδούχος"],["away_team_name","Φιλοξενούμενος"],["status","Κατάσταση"]]}/></Panel>
  </>;
}
