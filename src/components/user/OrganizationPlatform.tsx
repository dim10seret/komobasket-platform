"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { OrganizationUserIdentity, UserOrganizationMembership } from "@/types/organization-user";
import { PlatformProvider, createUserPlatformApi } from "@/components/admin/platform/shared/platform-context";
import type { CompetitionWorkspaceMode, Snapshot } from "@/components/admin/platform/shared/admin-core";
import { Overview } from "@/components/admin/platform/sections/OverviewSection";
import { Seasons, CompetitionWorkspaceManager } from "@/components/admin/platform/sections/CompetitionSection";
import { Teams } from "@/components/admin/platform/sections/TeamsSection";
import { Players } from "@/components/admin/platform/sections/PlayersSection";
import { Movements } from "@/components/admin/platform/sections/MovementsSection";
import OrganizationPublicPageManagement from "@/components/admin/platform/OrganizationPublicPageManagement";
import { PlatformKomoControlManagement } from "@/components/admin/platform/PlatformKomoControlManagement";

const tabs=[
  ["overview","Επισκόπηση"],["seasons","Σεζόν"],["competitions","Προγραμματισμός Διοργανώσεων"],
  ["teams","Ομάδες & Συμμετοχές"],["players","Παίκτες & Ρόστερ"],["movements","Μεταγραφές & Αποχωρήσεις"],
  ["public-page","Δημόσια Σελίδα"],["komocontrol","KomoControl"],
] as const;
type Tab=typeof tabs[number][0];
const button="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-black text-zinc-800 hover:border-orange-500 disabled:opacity-50";

export default function OrganizationPlatform({identity,membership,csrf,onLogout,logoutBusy,authError}:{
  identity:OrganizationUserIdentity;membership:UserOrganizationMembership;csrf:string;
  onLogout:()=>void;logoutBusy:boolean;authError:string;
}) {
  const [tab,setTab]=useState<Tab>("overview");
  const [data,setData]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [competitionId,setCompetitionId]=useState("");
  const [workspaceMode,setWorkspaceMode]=useState<CompetitionWorkspaceMode>("settings");
  const [teamSeasonFilter,setTeamSeasonFilter]=useState("all");
  const [selectedParticipationTeamIds,setSelectedParticipationTeamIds]=useState<string[]>([]);
  const mutationInFlight=useRef(false);
  const readSequence=useRef(0);
  const api=useMemo(()=>createUserPlatformApi(membership.organizationId,membership.role,csrf),[membership.organizationId,membership.role,csrf]);
  const load=useCallback(async()=>{
    if(tab==="public-page" || tab==="komocontrol"){setLoading(false);return;}
    const sequence=++readSequence.current;
    setLoading(true);setError("");
    try {
      const query=new URLSearchParams({section:tab});
      if(tab==="competitions" && competitionId)query.set("competitionId",competitionId);
      const response=await api.request(`/api/admin/league?${query}`);
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error || "Αποτυχία φόρτωσης.");
      if(sequence===readSequence.current)setData(payload);
    } catch(caught) {if(sequence===readSequence.current)setError(caught instanceof Error?caught.message:"Αποτυχία φόρτωσης.");}
    finally {if(sequence===readSequence.current)setLoading(false);}
  },[api,tab,competitionId]);
  useEffect(()=>{void load();return()=>{readSequence.current++;};},[load]);

  async function mutate(path:string,method:"POST"|"PATCH"|"DELETE",input:Record<string,unknown>,message="Η αλλαγή αποθηκεύτηκε.") {
    if(!api.canManage || mutationInFlight.current)return false;
    mutationInFlight.current=true;setBusy(true);setError("");setNotice("");
    try {
      const response=await api.request(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error || "Η ενέργεια απέτυχε.");
      setNotice(message);await load();return true;
    } catch(caught){setError(caught instanceof Error?caught.message:"Η ενέργεια απέτυχε.");return false;}
    finally{mutationInFlight.current=false;setBusy(false);}
  }
  const create=(resource:string,input:Record<string,unknown>)=>mutate(`/api/admin/league/${resource}`,"POST",input);
  const submit=(resource:string,event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();const form=event.currentTarget;const input=Object.fromEntries(new FormData(form));
    return create(resource,input).then(ok=>{if(ok)form.reset();return ok;});
  };
  const update=(resource:string,id:string,event:FormEvent<HTMLFormElement>,message:string)=>{
    event.preventDefault();const input={...Object.fromEntries(new FormData(event.currentTarget)),id};
    return mutate(`/api/admin/league/${resource}`,"PATCH",input,message);
  };
  const remove=(resource:string,id:string,message:string)=>mutate(`/api/admin/league/${resource}`,"DELETE",{id},message);
  const action=(actionName:string,input:Record<string,unknown>)=>mutate("/api/admin/league","PATCH",{...input,action:actionName});
  function selectTab(next:Tab) {readSequence.current++;setTab(next);setData(null);setCompetitionId("");setWorkspaceMode("settings");setNotice("");setError("");}

  return <PlatformProvider value={api}>
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {membership.logoUrl && <img src={membership.logoUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl object-contain" />}
            <div><a href="/" className="text-xs font-black uppercase tracking-widest text-orange-700">KomoBasket Platform</a><h1 className="mt-1 text-xl font-black sm:text-2xl">{membership.organizationName}</h1><p className="mt-1 text-sm text-zinc-600">{identity.user.displayName || identity.user.email} · {membership.role==="admin"?"Διαχειριστής":"Προβολή"}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {identity.memberships.length>1 && <a href="/user" className={button}>Επιλογή Οργανισμού</a>}
            <button type="button" className={button} disabled={loading} onClick={()=>void load()}>Ανανέωση</button>
            <button type="button" className={button} disabled={logoutBusy || !csrf} onClick={onLogout}>{logoutBusy?"Αποσύνδεση…":"Αποσύνδεση"}</button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Organization Platform" className="flex flex-wrap content-start gap-2 lg:flex-col">
          {tabs.map(([id,label])=><button key={id} type="button" aria-current={tab===id?"page":undefined} onClick={()=>selectTab(id)} className={`rounded-xl px-4 py-3 text-left text-sm font-black ${tab===id?"bg-zinc-950 text-white":"border border-zinc-200 bg-white text-zinc-700 hover:border-orange-400"}`}>{label}</button>)}
        </nav>
        <section className="min-w-0 space-y-5" aria-busy={loading}>
          {!api.canManage && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">Πρόσβαση μόνο για προβολή. Οι αλλαγές δεν επιτρέπονται.</p>}
          {authError && <p role="alert" className="rounded-xl bg-red-50 p-4 font-bold text-red-700">{authError}</p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-4 font-bold text-red-700">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 font-bold text-emerald-800">{notice}</p>}
          {loading && <p role="status" className="text-sm font-bold text-zinc-500">Φόρτωση…</p>}
          {data && tab==="overview" && <Overview data={data}/>}
          {data && tab==="seasons" && <PlatformProvider value={{...api,canManage:false}}><p className="mb-4 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">Οι Σεζόν είναι κοινός κατάλογος. Δημιουργούνται και αλλάζουν μόνο από τον Super Admin.</p><Seasons data={data} submit={submit} updateEntity={update} deleteEntity={remove} busy={busy}/></PlatformProvider>}
          {data && tab==="competitions" && <CompetitionWorkspaceManager data={data} submit={submit} updateEntity={update} deleteEntity={remove} bulkScheduleGames={(input)=>action("bulkScheduleGames",input)} busy={busy} workspaceCompetitionId={competitionId} setWorkspaceCompetitionId={setCompetitionId} workspaceMode={workspaceMode} setWorkspaceMode={setWorkspaceMode} onRefreshCompetitionData={load}/>}
          {data && tab==="teams" && <Teams data={data} submit={submit} updateEntity={update} deleteEntity={remove} createEntity={create} busy={busy} teamSeasonFilter={teamSeasonFilter} setTeamSeasonFilter={setTeamSeasonFilter} selectedParticipationTeamIds={selectedParticipationTeamIds} setSelectedParticipationTeamIds={setSelectedParticipationTeamIds}/>}
          {data && tab==="players" && <Players data={data} onRefreshSnapshot={load}/>}
          {data && tab==="movements" && <Movements data={data} add={(input)=>action("addAthleteMovement",input)} depart={(input)=>action("departure",input)} transfer={(input)=>action("transferAthlete",input)} busy={busy}/>}
          {tab==="public-page" && <OrganizationPublicPageManagement organizationId={membership.organizationId} role={membership.role}/>}
          {tab==="komocontrol" && <PlatformKomoControlManagement organizationId={membership.organizationId} isSuperAdmin={false}/>}
        </section>
      </div>
    </main>
  </PlatformProvider>;
}
