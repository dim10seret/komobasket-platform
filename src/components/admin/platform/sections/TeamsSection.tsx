"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompetitionWorkspaceMode, CreateEntity, DeleteEntity, Field, Panel, Row, Snapshot, UpdateEntity, inputClass, buttonClass, isCompletedCompetition, parseDateForDisplay, participationStatusLabels } from "../shared/admin-core";

export function Teams({data,submit,updateEntity,deleteEntity,createEntity,busy,teamSeasonFilter,setTeamSeasonFilter,selectedParticipationTeamIds,setSelectedParticipationTeamIds}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;updateEntity:UpdateEntity;deleteEntity:DeleteEntity;createEntity:CreateEntity;busy:boolean;teamSeasonFilter:string;setTeamSeasonFilter:(value:string)=>void;selectedParticipationTeamIds:string[];setSelectedParticipationTeamIds:(ids:string[])=>void}) {
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



