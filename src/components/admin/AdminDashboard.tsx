"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Database,
  FileText,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import NewsManager from "@/components/admin/NewsManager";
import { AdminView, CompetitionWorkspaceMode, CreateEntity, DeleteEntity, Snapshot, UpdateEntity } from "./platform/shared/admin-core";
import {
  CompetitionWorkspaceManager,
  Seasons,
} from "./platform/sections/CompetitionSection";
import { Overview } from "./platform/sections/OverviewSection";
import { Players } from "./platform/sections/PlayersSection";
import { Teams } from "./platform/sections/TeamsSection";
import { Movements } from "./platform/sections/MovementsSection";

const tabs = [
  ["overview", "Επισκόπηση", LayoutDashboard],
  ["seasons", "Σεζόν", Trophy],
  ["competitions", "Διοργανώσεις", Trophy],
  ["teams", "Ομάδες & Συμμετοχές", ShieldCheck],
  ["players", "Παίκτες & Ρόστερ", UsersRound],
  ["movements", "Μεταγραφές & Αποχωρήσεις", UserRoundCog],
] as const;

function AdminHeader({ view, onRefresh }: { view: AdminView; onRefresh?: () => void }) {
  const titles: Record<AdminView, string> = {
    home: "Κεντρική διαχείριση",
    news: "Διαχείριση Νέων",
    platform: "KomoBasket Platform",
  };

  return <header className="border-b border-zinc-800 bg-zinc-950 text-white">
    <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7">
      <div className="flex items-center gap-4">
        {view !== "home" && (
          <Link href="/admin" className="rounded-xl border border-zinc-700 p-2.5 transition hover:border-orange-500" aria-label="Επιστροφή στην αρχική διαχείριση">
            <ArrowLeft size={20} />
          </Link>
        )}
        <div>
          <p className="text-xs font-black uppercase tracking-[.22em] text-orange-500">KomoBasket Control Center</p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">{titles[view]}</h1>
        </div>
      </div>
      <div className="flex gap-2">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="rounded-xl border border-zinc-700 p-2.5 transition hover:border-orange-500"
            aria-label="Ανανέωση"
          >
            <RefreshCw size={20} />
          </button>
        )}
        <Link href="/" className="rounded-xl border border-zinc-700 px-4 py-2.5 font-bold transition hover:border-orange-500">
          Δημόσιο site
        </Link>
      </div>
    </div>
  </header>;
}

function AdminHome() {
  return <div className="min-h-screen bg-zinc-100">
    <AdminHeader view="home" />
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-7 sm:py-16">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-black text-zinc-950 sm:text-4xl">Τι θέλεις να διαχειριστείς;</h2>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600">Οι ανακοινώσεις και η αγωνιστική πλατφόρμα λειτουργούν ως δύο ανεξάρτητες ενότητες.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Link href="/admin/news" className="group flex min-h-64 flex-col rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-orange-300 hover:shadow-xl sm:p-9">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-zinc-950 text-orange-500 transition group-hover:bg-orange-600 group-hover:text-white">
            <FileText size={28} />
          </span>
          <h3 className="mt-7 text-2xl font-black text-zinc-950">Νέα</h3>
          <p className="mt-3 flex-1 leading-7 text-zinc-600">Δημιουργία, επεξεργασία και δημοσίευση ανακοινώσεων και συνημμένων.</p>
          <span className="mt-7 inline-flex items-center gap-2 font-black text-orange-600">Άνοιγμα ενότητας <span aria-hidden="true">→</span></span>
        </Link>
        <Link href="/admin/platform" className="group flex min-h-64 flex-col rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-orange-300 hover:shadow-xl sm:p-9">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-zinc-950 text-orange-500 transition group-hover:bg-orange-600 group-hover:text-white">
            <Database size={28} />
          </span>
          <h3 className="mt-7 text-2xl font-black text-zinc-950">KomoBasket Platform</h3>
          <p className="mt-3 flex-1 leading-7 text-zinc-600">Διαχείριση σεζόν, διοργανώσεων, ομάδων, παικτών, ρόστερ και αγώνων.</p>
          <span className="mt-7 inline-flex items-center gap-2 font-black text-orange-600">Άνοιγμα ενότητας <span aria-hidden="true">→</span></span>
        </Link>
      </div>
    </main>
  </div>;
}

function NewsAdmin() {
  return <div className="min-h-screen bg-zinc-100">
    <AdminHeader view="news" />
    <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7">
      <NewsManager />
    </main>
  </div>;
}

function Message({ text, kind }: { text: string; kind: "notice" | "error" }) {
  const base = "rounded-2xl border p-4 font-bold";
  return <div className={`${base} ${kind === "notice" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{text}</div>;
}

export default function AdminDashboard({ view }: { view: AdminView }) {
  const router = useRouter();
  const pathname = usePathname();
  const routeSearchParams = useSearchParams();
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("overview");
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [teamSeasonFilter, setTeamSeasonFilter] = useState("all");
  const [selectedParticipationTeamIds, setSelectedParticipationTeamIds] = useState<string[]>([]);
  const [competitionWorkspaceMode, setCompetitionWorkspaceMode] = useState<CompetitionWorkspaceMode>("settings");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/league", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Αποτυχία φόρτωσης.");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Αποτυχία φόρτωσης.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "platform") return;
    const request = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(request);
  }, [load, view]);

  const competitionWorkspaceId = routeSearchParams.get("competitionId") ?? "";

  const setWorkspaceCompetitionId = useCallback((competitionId: string) => {
    const normalizedCompetitionId = competitionId.trim();
    const nextParams = new URLSearchParams(routeSearchParams.toString());
    if (normalizedCompetitionId) {
      nextParams.set("competitionId", normalizedCompetitionId);
    } else {
      nextParams.delete("competitionId");
      setCompetitionWorkspaceMode("settings");
    }

    const nextPath = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
    router.push(nextPath);
  }, [pathname, routeSearchParams, router]);

  const create: CreateEntity = async (resource: string, input: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/league/${resource}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποθήκευση απέτυχε.");
      if (resource === "competitions" && payload?.id) {
        setWorkspaceCompetitionId(String(payload.id));
        setCompetitionWorkspaceMode("settings");
      }
      setNotice(payload?.message || "Η εγγραφή αποθηκεύτηκε.");
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η αποθήκευση απέτυχε.");
    } finally {
      setBusy(false);
    }
    return false;
  };

  const submit = async (resource: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const ok = await create(resource, Object.fromEntries(new FormData(form).entries()));
    if (!ok) return false;
    form.reset();
    return true;
  };

  const updateEntity: UpdateEntity = async (resource, id, event, successMessage) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/league/${resource}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...Object.fromEntries(new FormData(event.currentTarget).entries()) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η επεξεργασία απέτυχε.");
      setNotice(successMessage);
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η επεξεργασία απέτυχε.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteEntity: DeleteEntity = async (resource, id, successMessage) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/league/${resource}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η διαγραφή απέτυχε.");
      setNotice(successMessage);
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η διαγραφή απέτυχε.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const depart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "departure", ...Object.fromEntries(new FormData(form).entries()) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Η αποχώρηση απέτυχε.");
      setNotice("Η αποχώρηση καταγράφηκε χωρίς να διαγραφεί το ιστορικό του παίκτη.");
      form.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Η αποχώρηση απέτυχε.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!data || !competitionWorkspaceId) return;
    if (data.competitions.some((competition) => String(competition.id) === competitionWorkspaceId)) return;
    setWorkspaceCompetitionId("");
  }, [competitionWorkspaceId, data, setWorkspaceCompetitionId]);

  const isPlatform = view === "platform";

  const handleTabChange = (nextTab: (typeof tabs)[number][0]) => {
    setTab(nextTab);
    if (nextTab === "competitions") {
      setWorkspaceCompetitionId("");
      setCompetitionWorkspaceMode("settings");
    }
  };

  if (view === "home") return <AdminHome />;
  if (view === "news") return <NewsAdmin />;

  return <div className="min-h-screen bg-zinc-100">
    <AdminHeader view="platform" onRefresh={() => void load()} />
    <div className="mx-auto grid max-w-[1500px] gap-6 px-4 py-6 lg:grid-cols-[270px_1fr] lg:px-7">
      <nav className="h-fit rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm lg:sticky lg:top-5">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold transition ${tab === id ? "bg-zinc-950 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
          >
            <Icon size={19} className={tab === id ? "text-orange-500" : "text-zinc-500"} />
            {label}
          </button>
        ))}
      </nav>
      <main className="min-w-0 space-y-5">
        {loading && <div className="rounded-2xl bg-white p-8 text-center text-zinc-500">Φόρτωση δεδομένων…</div>}
        {error && <Message text={error} kind="error" />}
        {notice && <Message text={notice} kind="notice" />}
        {!loading && data && (
          <>
            {isPlatform && data.mode === "preview" && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                Τοπική προεπισκόπηση με τα υπάρχοντα αρχεία. Η μόνιμη αποθήκευση ενεργοποιείται στην εγκατάσταση D1.
              </div>
            )}
            {tab === "overview" && <Overview data={data} />}
            {tab === "seasons" && <Seasons data={data} submit={submit} updateEntity={updateEntity} deleteEntity={deleteEntity} busy={busy} />}
            {tab === "competitions" && (
              <CompetitionWorkspaceManager
                data={data}
                submit={submit}
                updateEntity={updateEntity}
                deleteEntity={deleteEntity}
                busy={busy}
                workspaceCompetitionId={competitionWorkspaceId}
                setWorkspaceCompetitionId={setWorkspaceCompetitionId}
                workspaceMode={competitionWorkspaceMode}
                setWorkspaceMode={setCompetitionWorkspaceMode}
                onRefreshCompetitionData={load}
              />
            )}
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
            {tab === "movements" && <Movements data={data} depart={depart} busy={busy} />}
          </>
        )}
      </main>
    </div>
  </div>;
}

