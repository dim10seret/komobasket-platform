"use client";

import type { FormEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Row,
  Snapshot,
  TeamRosterViewRole,
  TeamRosterManagementView,
  TeamRosterAthleteWithIndex,
  TeamRosterAthlete,
  inputClass,
  buttonClass,
  parseDateForDisplay,
  CompetitionWorkspaceMode,
  UpdateEntity,
  DeleteEntity,
  CreateEntity,
  Field,
  Panel,
  seasonStatusLabels,
  competitionLifecycleLabels,
  getCompetitionTypeLabel,
  staffRoleLabels,
  phaseFormatLabel,
  isCompletedCompetition,
  clearBlobPreviewUrl,
} from "../shared/admin-core";
import { PhaseFields, StandingsPhasePreview } from "./PhaseScheduleSection";
import { describeSeriesMatchupsFromPhase } from "../phases/PhaseParticipantsBuilder";
import {
  resolveFinalizedStandingsPositions,
  resolveSeriesParticipantSourcePhaseId,
} from "@/lib/series-carry-over";
import { deriveSeriesPhaseCompletion } from "@/lib/series-phase-completion";
import { ProgramGamesSection } from "./ProgramGamesSection";

export function CompetitionFields({
  competition,
  includeName = true,
  includeStatus = false,
}: {
  competition?: Row;
  includeName?: boolean;
  includeStatus?: boolean;
}) {
  const [selectedType,setSelectedType]=useState(String(competition?.type ?? "league"));

  return <>
    {includeName && <Field label="Όνομα Διοργάνωσης"><input required name="name" defaultValue={String(competition?.name ?? "")} placeholder="KomoBasket League" className={inputClass}/></Field>}
    <Field label="Τύπος"><select name="type" defaultValue={String(competition?.type ?? "league")} onChange={(event)=>setSelectedType(String(event.target.value))} className={inputClass}>
      <option value="league">Πρωτάθλημα</option>
      <option value="cup">Κύπελλο</option>
      <option value="tournament">Τουρνουά</option>
      <option value="custom">Custom</option>
    </select></Field>
    {selectedType === "custom" && (
      <Field label="Ονομασία τύπου"><input name="customTypeLabel" defaultValue={String(competition?.custom_type_label ?? "")} placeholder="Παραδείγματος χάρη: Βασιλικό Κύπελλο" className={inputClass}/></Field>
    )}
    {includeStatus && <Field label="Κατάσταση"><select name="lifecycleStatus" defaultValue={String(competition?.lifecycle_status ?? "under_construction")} className={inputClass}><option value="under_construction">Under Construction</option><option value="online">Online</option><option value="complete">Complete</option></select></Field>}
    <Field label="Αναμενόμενες ομάδες"><input name="expectedTeamCount" type="number" min="2" defaultValue={String(competition?.expected_team_count ?? "")} placeholder="16" className={inputClass}/></Field>
  </>;
}

export function Seasons({data,submit,updateEntity,deleteEntity,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;updateEntity:UpdateEntity;deleteEntity:DeleteEntity;busy:boolean}) {
  const [editingId, setEditingId] = useState<string | null>(null);

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
  </>;
}

export function CompetitionWorkspaceManager({
  data,
  submit,
  updateEntity,
  deleteEntity,
  bulkScheduleGames,
  busy,
  workspaceCompetitionId,
  setWorkspaceCompetitionId,
  workspaceMode,
  setWorkspaceMode,
  onRefreshCompetitionData,
}: {
  data: Snapshot;
  submit: (r:string, e:FormEvent<HTMLFormElement>) => Promise<boolean>;
  updateEntity: UpdateEntity;
  deleteEntity: DeleteEntity;
  bulkScheduleGames: (payload: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  workspaceCompetitionId: string;
  setWorkspaceCompetitionId: (value: string) => void;
  workspaceMode: CompetitionWorkspaceMode;
  setWorkspaceMode: (value: CompetitionWorkspaceMode) => void;
  onRefreshCompetitionData?: () => Promise<void> | void;
}) {
  const [selectedExistingSeasonId, setSelectedExistingSeasonId] = useState("");
  const [showNewCompetitionForm, setShowNewCompetitionForm] = useState(false);
  const [selectedNewSeasonId, setSelectedNewSeasonId] = useState("");
  const [newCompetitionLogoUrl, setNewCompetitionLogoUrl] = useState("");
  const [newCompetitionLogoFileName, setNewCompetitionLogoFileName] = useState("");
  const [newCompetitionLogoBusy, setNewCompetitionLogoBusy] = useState(false);
  const newCompetitionLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [editCompetitionLogoUrl, setEditCompetitionLogoUrl] = useState("");
  const [editCompetitionLogoFileName, setEditCompetitionLogoFileName] = useState("");
  const [editCompetitionLogoBusy, setEditCompetitionLogoBusy] = useState(false);
  const editCompetitionLogoInputRef = useRef<HTMLInputElement | null>(null);

  const seasonById = new Map(data.seasons.map((season) => [String(season.id), season]));
  const participationCountByCompetition = new Map<string, number>();
  for (const participation of data.participations) {
    const competitionId = String(participation.competition_id ?? "");
    const status = String(participation.status ?? "active");
    if (competitionId && status === "active") participationCountByCompetition.set(competitionId, (participationCountByCompetition.get(competitionId) ?? 0) + 1);
  }

  const selectedCompetition = data.competitions.find((competition)=>String(competition.id)===workspaceCompetitionId);
  const selectedSeason = selectedCompetition
    ? seasonById.get(String(selectedCompetition.season_id ?? ""))
    : null;
  const selectedCompetitionPhases = useMemo(() => {
    return data.phases
      .filter((phase) => String(phase.competition_id ?? "") === String(workspaceCompetitionId))
      .sort((left, right) => {
        const leftOrder = Number(left.phase_order ?? left.order_index ?? 0);
        const rightOrder = Number(right.phase_order ?? right.order_index ?? 0);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.id).localeCompare(String(right.id));
      });
  }, [data.phases, workspaceCompetitionId]);
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(null);
  const hasInitializedOpenPhase = useRef(false);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [activePhaseId, setActivePhaseId] = useState<string>("");
  const [showAddPhaseForm, setShowAddPhaseForm] = useState(false);
  const [addPhaseChoice, setAddPhaseChoice] = useState<"continuations" | "new" | null>(null);
  const [activateLatestPhaseAfterAdd, setActivateLatestPhaseAfterAdd] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [newPhaseFormat, setNewPhaseFormat] = useState<"standings" | "series">("standings");
  const [newPhasePreviousId, setNewPhasePreviousId] = useState("");
  const [finalizePhaseDialog, setFinalizePhaseDialog] = useState<{ phaseId: string; phaseName: string; competitionId: string; phaseFormat: string } | null>(null);
  const [finalizePhaseConfirmation, setFinalizePhaseConfirmation] = useState("");
  const [teamRoster,setTeamRoster]=useState<TeamRosterManagementView | null>(null);
  const [teamRosterLoading,setTeamRosterLoading]=useState(false);
  const [teamRosterError,setTeamRosterError]=useState("");
  const [teamRosterNotice,setTeamRosterNotice]=useState("");
  const [editingAthlete,setEditingAthlete]=useState<TeamRosterAthleteWithIndex | null>(null);
  const [editingAthleteFirstName,setEditingAthleteFirstName]=useState("");
  const [editingAthleteLastName,setEditingAthleteLastName]=useState("");
  const [editingAthleteBirthDate,setEditingAthleteBirthDate]=useState("");
  const [editingAthletePhotoUrl,setEditingAthletePhotoUrl]=useState("");
  const [editingAthletePhotoPreview,setEditingAthletePhotoPreview]=useState("");
  const [editingAthletePhotoFileName,setEditingAthletePhotoFileName]=useState("");
  const [editingAthleteUploadBusy,setEditingAthleteUploadBusy]=useState(false);
  const [editingAthleteUploadMessage,setEditingAthleteUploadMessage]=useState("");
  const [editingAthleteShirtNumber,setEditingAthleteShirtNumber]=useState("");
  const [seriesContinuationSeed,setSeriesContinuationSeed]=useState<{ sourcePhaseId: string; sourceName: string; from?: number; to?: number } | null>(null);
  const [rosterActionBusy,setRosterActionBusy]=useState(false);
  const [cleanupBusy,setCleanupBusy]=useState(false);
  const [cleanupNotice,setCleanupNotice]=useState("");
  const [cleanupError,setCleanupError]=useState("");

  useEffect(() => {
    if (!selectedCompetitionPhases.length) {
      hasInitializedOpenPhase.current = false;
      setOpenPhaseId(null);
      return;
    }
    if (hasInitializedOpenPhase.current) {
      if (openPhaseId === null) return;
      if (selectedCompetitionPhases.some((phase) => String(phase.id) === openPhaseId)) return;
    }
    const preferredPhase = selectedCompetitionPhases.find((phase) => String((phase as Row).lifecycle_status ?? "active") === "active")
      ?? selectedCompetitionPhases[0];
    hasInitializedOpenPhase.current = true;
    setOpenPhaseId(String(preferredPhase?.id ?? "") || null);
  }, [openPhaseId, selectedCompetitionPhases]);

  const rosterPlayers = useMemo(() => (teamRoster?.athletes ?? []).map((athlete,index)=>({ ...athlete, rowIndex:index + 1 })), [teamRoster?.athletes]);

  const parseShirtNumber = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Μη έγκυρος αριθμός φανέλας.");
    return parsed;
  };

  const parsePhaseRuleSettings = (value: unknown) => {
    if (!value) return {};
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    return {};
  };

  const formatParticipantRangeFromPhase = (phase: Row | undefined) => {
    if (!phase) return { from: 1, to: 1 };
    const settings = parsePhaseRuleSettings(phase.rule_settings_json);
    const participantConfiguration = parsePhaseRuleSettings(settings.participantConfiguration);
    const from = Number(participantConfiguration.standingFrom);
    const to = Number(participantConfiguration.standingTo);
    const safeFrom = Number.isFinite(from) ? Math.max(1, Math.floor(from)) : 1;
    const safeTo = Number.isFinite(to) ? Math.max(safeFrom, Math.floor(to)) : safeFrom;
    return { from: safeFrom, to: safeTo };
  };

  const showTeamRosterPopup = async (teamId:string, competitionId:string, seasonId:string) => {
    if (!teamId || !competitionId || !seasonId) return;
    setTeamRosterLoading(true);
    setTeamRosterError("");
    setTeamRosterNotice("");
    try {
      const request = await fetch(`/api/admin/league?view=team-roster&seasonId=${seasonId}&competitionId=${competitionId}&teamId=${teamId}`, { cache: "no-store" });
      const payload = await request.json();
      if (!request.ok || payload?.view !== "team-roster") throw new Error(payload?.error || "Αποτυχία φόρτωσης ρόστερ.");
      setTeamRoster(payload.data as TeamRosterManagementView);
    } catch (error) {
      setTeamRosterError(error instanceof Error ? error.message : "Αποτυχία φόρτωσης ρόστερ.");
      setTeamRoster(null);
    } finally {
      setTeamRosterLoading(false);
    }
  };

  const closeTeamRosterPopup = () => {
    if (editingAthletePhotoPreview && editingAthletePhotoPreview.startsWith("blob:")) URL.revokeObjectURL(editingAthletePhotoPreview);
    setTeamRoster(null);
    setTeamRosterError("");
    setTeamRosterNotice("");
    setEditingAthlete(null);
    setEditingAthleteFirstName("");
    setEditingAthleteLastName("");
    setEditingAthleteBirthDate("");
    setEditingAthletePhotoUrl("");
    setEditingAthletePhotoPreview("");
    setEditingAthletePhotoFileName("");
    setEditingAthleteUploadBusy(false);
    setEditingAthleteUploadMessage("");
    setEditingAthleteShirtNumber("");
  };

  const openAthleteEdit = (athlete: TeamRosterAthleteWithIndex) => {
    setEditingAthlete(athlete);
    setEditingAthleteFirstName(athlete.first_name ?? "");
    setEditingAthleteLastName(athlete.last_name ?? "");
    setEditingAthleteBirthDate(String(athlete.birth_date ?? ""));
    setEditingAthletePhotoUrl(String(athlete.photo_url ?? ""));
    if (editingAthletePhotoPreview && editingAthletePhotoPreview.startsWith("blob:")) URL.revokeObjectURL(editingAthletePhotoPreview);
    setEditingAthletePhotoPreview(String(athlete.photo_url ?? ""));
    setEditingAthletePhotoFileName("");
    setEditingAthleteUploadMessage("");
    setEditingAthleteShirtNumber(String(athlete.shirt_number ?? ""));
  };

  const runStandingsRosterPatch = async (payload: Record<string, unknown>, successMessage:string) => {
    if (!teamRoster) return;
    setRosterActionBusy(true);
    setTeamRosterError("");
    try {
      const response = await fetch("/api/admin/league", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const payloadResponse = await response.json();
      if (!response.ok) throw new Error(payloadResponse.error || "Η ενέργεια απέτυχε.");
      setTeamRosterNotice(successMessage);
      await showTeamRosterPopup(teamRoster.teamId, teamRoster.competitionId, teamRoster.seasonId);
    } catch (error) {
      setTeamRosterError(error instanceof Error ? error.message : "Η ενέργεια απέτυχε.");
    } finally {
      setRosterActionBusy(false);
    }
  };

  const handleAthletePhotoSelect = (file: File) => {
    if (editingAthletePhotoPreview && editingAthletePhotoPreview.startsWith("blob:")) URL.revokeObjectURL(editingAthletePhotoPreview);
    setEditingAthletePhotoFileName(file.name);
    setEditingAthletePhotoPreview(URL.createObjectURL(file));
    setEditingAthleteUploadMessage("Φόρτωση εικόνας...");
    setEditingAthleteUploadBusy(true);
    void (async () => {
      const payload = new FormData();
      payload.append("logo", file);
      payload.append("teamId", "");
      try {
        const response = await fetch("/api/admin/team-logo-route", { method: "POST", body: payload });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || "Το upload απέτυχε.");
        const uploadedPhoto = String(result.logoUrl ?? "");
        if (!uploadedPhoto) throw new Error("Δεν αποθηκεύτηκε φωτογραφία.");
        setEditingAthletePhotoUrl(uploadedPhoto);
        setEditingAthleteUploadMessage("Η φωτογραφία ανέβηκε.");
      } catch (error) {
        setEditingAthleteUploadMessage(error instanceof Error ? error.message : "Η φωτογραφία απέτυχε.");
      } finally {
        setEditingAthleteUploadBusy(false);
      }
    })();
  };

  const saveAthleteEditsFromRoster = async () => {
    if (!editingAthlete) return;
    await runStandingsRosterPatch({
      action: "updateAthleteCanonical",
      playerId: editingAthlete.player_id,
      firstName: editingAthleteFirstName.trim() || null,
      lastName: editingAthleteLastName.trim() || null,
      birthDate: editingAthleteBirthDate || null,
      photoUrl: editingAthletePhotoUrl || null,
    }, "Οι αλλαγές αθλητή αποθηκεύτηκαν.");
    await runStandingsRosterPatch({
      action: "updateAthleteShirt",
      rosterId: editingAthlete.roster_id,
      shirtNumber: parseShirtNumber(editingAthleteShirtNumber),
    }, "Τα στοιχεία ρόστερ αποθηκεύτηκαν.");
    if (editingAthletePhotoPreview && editingAthletePhotoPreview.startsWith("blob:")) URL.revokeObjectURL(editingAthletePhotoPreview);
    setEditingAthletePhotoPreview("");
    setEditingAthletePhotoFileName("");
    setEditingAthlete(null);
  };

  useEffect(() => {
    setShowAddPhaseForm(false);
    setEditingPhaseId(null);
    setActivePhaseId("");
    setSeriesContinuationSeed(null);
    setTeamRoster(null);
    setTeamRosterError("");
    setTeamRosterNotice("");
    setEditingAthlete(null);
  }, [workspaceCompetitionId]);

  useEffect(() => {
    if (!selectedCompetitionPhases.length) {
      setActivePhaseId("");
      return;
    }

    if (activateLatestPhaseAfterAdd) {
      const latestPhase = selectedCompetitionPhases[selectedCompetitionPhases.length - 1];
      if (latestPhase) {
        setActivePhaseId(String(latestPhase.id));
      }
      setActivateLatestPhaseAfterAdd(false);
      return;
    }

    const exists = selectedCompetitionPhases.some((phase) => String(phase.id) === activePhaseId);
    if (!exists) {
      setActivePhaseId(String(selectedCompetitionPhases[0].id));
    }
  }, [activePhaseId, activateLatestPhaseAfterAdd, selectedCompetitionPhases]);

  useEffect(() => {
    if (!showAddPhaseForm || addPhaseChoice !== "new") return;
    if (newPhasePreviousId && selectedCompetitionPhases.some((phase) => String(phase.id) === newPhasePreviousId)) return;
    const fallbackPrevious = selectedCompetitionPhases[selectedCompetitionPhases.length - 1];
    setNewPhasePreviousId(fallbackPrevious ? String(fallbackPrevious.id) : "");
  }, [addPhaseChoice, newPhasePreviousId, selectedCompetitionPhases, showAddPhaseForm]);

  useEffect(() => {
    if (workspaceCompetitionId) {
      const current = data.competitions.find((competition)=>String(competition.id)===workspaceCompetitionId);
      setEditCompetitionLogoUrl(String(current?.logo_url ?? ""));
      setEditCompetitionLogoFileName("");
      return;
    }
    setEditCompetitionLogoUrl("");
    setEditCompetitionLogoFileName("");
    setEditCompetitionLogoBusy(false);
  }, [workspaceCompetitionId, data.competitions]);

  useEffect(() => {
    if (!selectedExistingSeasonId && data.seasons[0]) {
      setSelectedExistingSeasonId(String(data.seasons[0].id));
    }
  }, [data.seasons, selectedExistingSeasonId]);

  const uploadCompetitionLogo = async (
    file: File,
    setLogoUrl: (value: string) => void,
    setBusyState: (value: boolean) => void,
    setFileName: (value: string) => void,
  ) => {
    const previousFile = file.name;
    setBusyState(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      fd.append("teamId", "");
      const response = await fetch("/api/admin/team-logo-route", { method: "POST", body: fd });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Αποτυχία μεταφόρτωσης.");
      setLogoUrl(String(payload.logoUrl ?? ""));
      setFileName(previousFile);
    } finally {
      setBusyState(false);
    }
  };

  const openCompetitionWorkspace = (competitionId:string) => {
    setWorkspaceCompetitionId(competitionId);
    setWorkspaceMode("settings");
  };

  const clearCompetitionWorkspace = useCallback(() => {
    setWorkspaceCompetitionId("");
    setWorkspaceMode("settings");
    setEditingPhaseId(null);
  }, [setWorkspaceMode, setWorkspaceCompetitionId]);

  return (
    <div className="space-y-5">
      {!workspaceCompetitionId && (
        <Panel title="Διοργανώσεις">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <Field label="Σεζόν">
              <select value={selectedExistingSeasonId} onChange={(event) => setSelectedExistingSeasonId(event.target.value)} className={inputClass}>
                <option value="">Όλες οι σεζόν</option>
                {data.seasons.map((season) => <option key={String(season.id)} value={String(season.id)}>{season.name}</option>)}
              </select>
            </Field>
            <button
              type="button"
              onClick={() => setShowNewCompetitionForm((current) => !current)}
              className={buttonClass}
            >
              + Νέα Διοργάνωση
            </button>
          </div>
          {showNewCompetitionForm && (
            <form onSubmit={(event)=>void submit("competitions", event)} className="mb-6 grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <CompetitionFields />
              <Field label="Σεζόν">
                <select required name="seasonId" value={selectedNewSeasonId} onChange={(event) => setSelectedNewSeasonId(event.target.value)} className={inputClass}>
                  <option value="">Επιλογή</option>
                  {data.seasons.map((season)=><option key={String(season.id)} value={String(season.id)}>{season.name}</option>)}
                </select>
              </Field>
              <Field label="Λογότυπο">
                <div className="mt-1 flex items-center gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-xl bg-zinc-100">
                    {newCompetitionLogoUrl ? <img src={newCompetitionLogoUrl} alt="Προεπισκόπηση λογοτύπου" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">—</div>}
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:bg-zinc-100">
                    <span>📷 {newCompetitionLogoUrl ? "Αλλαγή λογότυπου" : "Επιλογή λογότυπου"}</span>
                    <input
                      ref={newCompetitionLogoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (!file) return;
                        void uploadCompetitionLogo(file, setNewCompetitionLogoUrl, setNewCompetitionLogoBusy, setNewCompetitionLogoFileName);
                      }}
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-zinc-500">{newCompetitionLogoBusy ? "Μεταφόρτωση λογοτύπου…" : newCompetitionLogoFileName ? `Επιλεγμένο αρχείο: ${newCompetitionLogoFileName}` : "Επίλεξε λογότυπο από τον υπολογιστή."}</p>
              </Field>
              <input type="hidden" name="logoUrl" value={newCompetitionLogoUrl} />
              <div className="sm:col-span-2 xl:col-span-4 flex items-center gap-3">
                <button disabled={busy} className={buttonClass}>Δημιουργία Διοργάνωσης</button>
                <button type="button" onClick={() => setShowNewCompetitionForm(false)} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700">Ακύρωση</button>
              </div>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200">
                <tr>
                  <th className="pb-2 pr-3 font-black text-zinc-700">Διοργάνωση</th>
                  <th className="pb-2 px-3 font-black text-zinc-700">Σεζόν</th>
                  <th className="pb-2 px-3 font-black text-zinc-700">Τύπος</th>
                  <th className="pb-2 px-3 font-black text-zinc-700">Ομάδες</th>
                  <th className="pb-2 px-3 font-black text-zinc-700">Κατάσταση</th>
                </tr>
              </thead>
              <tbody>
                {data.competitions
                  .filter((competition) => !selectedExistingSeasonId || String(competition.season_id) === selectedExistingSeasonId)
                  .map((competition) => {
                    const competitionId = String(competition.id);
                    const lifecycle = String(competition.lifecycle_status ?? "under_construction");
                    const competitionTypeDisplay = getCompetitionTypeLabel(String(competition.type), String(competition.custom_type_label ?? ""));
                    const participationCount = participationCountByCompetition.get(competitionId) ?? 0;
                    const expected = competition.expected_team_count;
                    const expectedForDisplay = expected == null || expected === "" ? participationCount : Number(expected);
                    return <tr
                      key={competitionId}
                      role="button"
                      onClick={() => openCompetitionWorkspace(competitionId)}
                      className="border-b border-zinc-100 transition hover:bg-zinc-50"
                    >
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openCompetitionWorkspace(competitionId);
                          }}
                          className="text-left text-lg font-black text-zinc-950 underline-offset-4 transition hover:text-orange-700 hover:underline"
                        >
                          {competition.name}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-zinc-700">{competition.season_name}</td>
                      <td className="py-3 px-3 text-zinc-700">{competitionTypeDisplay}</td>
                      <td className="py-3 px-3 text-zinc-700">{`${participationCount} / ${expectedForDisplay}`}</td>
                      <td className="py-3 px-3 text-zinc-700">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${lifecycle==="online"?"bg-emerald-100 text-emerald-800":lifecycle==="complete"?"bg-zinc-200 text-zinc-700":"bg-amber-100 text-amber-800"}`}>
                          {competitionLifecycleLabels[lifecycle] ?? lifecycle}
                        </span>
                      </td>
                    </tr>;
                  })}
                {!data.competitions.filter((competition) => !selectedExistingSeasonId || String(competition.season_id) === selectedExistingSeasonId).length && (
                  <tr><td colSpan={5} className="py-5 text-zinc-500">Δεν υπάρχουν διοργανώσεις για αυτή τη σεζόν.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {workspaceCompetitionId && selectedCompetition && (
        <Panel title={`Ρύθμιση Διοργάνωσης`}>
          <button
            type="button"
            onClick={clearCompetitionWorkspace}
            className="mb-4 inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700 transition hover:border-orange-500"
          >
            ← Διοργανώσεις
          </button>
          <p className="text-sm text-zinc-700">{selectedCompetition.name} — {selectedSeason?.name ?? "—"}</p>
          <div className="mt-4 mb-4 flex gap-2 border-b border-zinc-200 pb-4">
            <button type="button" onClick={() => setWorkspaceMode("settings")} className={`rounded-xl border px-3 py-2 text-sm font-black ${workspaceMode === "settings" ? "bg-zinc-950 text-white" : "bg-white text-zinc-700"}`}>Ρύθμιση Διοργάνωσης</button>
            <button type="button" onClick={() => setWorkspaceMode("phases")} className={`rounded-xl border px-3 py-2 text-sm font-black ${workspaceMode === "phases" ? "bg-zinc-950 text-white" : "bg-white text-zinc-700"}`}>Φάσεις</button>
            <button type="button" onClick={() => setWorkspaceMode("program")} className={`rounded-xl border px-3 py-2 text-sm font-black ${workspaceMode === "program" ? "bg-zinc-950 text-white" : "bg-white text-zinc-700"}`}>Πρόγραμμα & Αγώνες</button>
          </div>
          {workspaceMode === "settings" ? (
            <form
              onSubmit={(event)=>{ if (!window.confirm("Θέλεις να αποθηκεύσεις τις αλλαγές στη ρύθμιση της διοργάνωσης;")) return; void updateEntity("competitions", workspaceCompetitionId, event, "Η ρύθμιση της διοργάνωσης αποθηκεύτηκε."); }}
              className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            >
              <Field label="Λογότυπο">
                <div className="mt-1 flex items-center gap-3">
                  <div className="h-16 w-16 overflow-hidden rounded-xl bg-zinc-100">
                    {editCompetitionLogoUrl
                      ? <img src={editCompetitionLogoUrl} alt="Λογότυπο διοργάνωσης" className="h-full w-full object-cover" />
                      : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">—</div>}
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:bg-zinc-100">
                    <span>📷 {editCompetitionLogoUrl ? "Αλλαγή λογότυπου" : "Επιλογή λογότυπου"}</span>
                    <input
                      ref={editCompetitionLogoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (!file) return;
                        void uploadCompetitionLogo(file, setEditCompetitionLogoUrl, setEditCompetitionLogoBusy, setEditCompetitionLogoFileName);
                      }}
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-zinc-500">{editCompetitionLogoBusy ? "Μεταφόρτωση λογότυπου…" : editCompetitionLogoFileName ? `Επιλεγμένο αρχείο: ${editCompetitionLogoFileName}` : "Επίλεξε λογότυπο από τον υπολογιστή."}</p>
              </Field>
              <input type="hidden" name="logoUrl" value={editCompetitionLogoUrl} />
              <Field label="Όνομα"><input required name="name" defaultValue={String(selectedCompetition.name ?? "")} className={inputClass}/></Field>
                <Field label="Σεζόν"><input required disabled value={String(selectedSeason?.name ?? "")} className={inputClass}/></Field>
                <input type="hidden" name="seasonId" value={String(selectedCompetition.season_id ?? "")} />
                <CompetitionFields competition={selectedCompetition} includeName={false} includeStatus />
              <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-4">
                <button disabled={busy} className={buttonClass}>Αποθήκευση</button>
                <button
                  type="button"
                  onClick={() => clearCompetitionWorkspace()}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-black text-zinc-700"
                >
                  Πίσω
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Πρόκειται να διαγράψεις τη διοργάνωση «${String(selectedCompetition.name)}». Θέλεις να συνεχίσεις;`)) return;
                    void deleteEntity("competitions", workspaceCompetitionId, `Η διοργάνωση «${String(selectedCompetition.name)}» διαγράφηκε.`);
                  }}
                  className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Διαγραφή
                </button>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:col-span-2 xl:col-span-4">
                <p className="text-sm font-black text-zinc-900">Καθαρισμός δεδομένων διοργάνωσης</p>
                <p className="mt-2 text-sm text-zinc-700">
                  Ο καθαρισμός αφαιρεί μόνο τις συμμετοχές και τα roster αυτής της διοργάνωσης. Οι ομάδες και οι παίκτες παραμένουν στο Μητρώο τους.
                </p>
                <p className="mt-2 text-sm text-zinc-700">
                  Πριν τον καθαρισμό πρέπει να έχουν διαγραφεί όλες οι Φάσεις. Διοργάνωση με αγώνες ή στατιστικά δεν μπορεί να καθαριστεί από αυτή τη λειτουργία.
                </p>
                {cleanupError && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{cleanupError}</p>}
                {cleanupNotice && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{cleanupNotice}</p>}
                {String(selectedCompetition.lifecycle_status ?? "under_construction") === "under_construction" ? (
                  <button
                    type="button"
                    disabled={busy || cleanupBusy}
                    onClick={async () => {
                      if (!workspaceCompetitionId || busy || cleanupBusy) return;
                      const competitionName = String(selectedCompetition.name ?? "");
                      if (!window.confirm(
                        `Θέλετε να καθαρίσετε τα δεδομένα της διοργάνωσης «${competitionName}»;\n\n` +
                        "Θα αφαιρεθούν μόνο οι συμμετοχές ομάδων και τα roster/συσχετίσεις αυτής της διοργάνωσης.\n" +
                        "Οι ομάδες και οι παίκτες στο Μητρώο παραμένουν.\n" +
                        "Η διοργάνωση η ίδια παραμένει.",
                      )) return;
                      setCleanupBusy(true);
                      setCleanupError("");
                      setCleanupNotice("");
                      try {
                        const response = await fetch("/api/admin/league/competitions", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ id: workspaceCompetitionId, action: "cleanup" }),
                        });
                        const payload = await response.json();
                        if (!response.ok) throw new Error(payload.error || "Ο καθαρισμός απέτυχε.");
                        const removed = payload?.removed ?? {};
                        setCleanupNotice(`Ο καθαρισμός ολοκληρώθηκε: αφαιρέθηκαν ${Number(removed.competitionTeams ?? 0)} συμμετοχές ομάδων και ${Number(removed.rosterMemberships ?? 0)} εγγραφές roster.`);
                        await onRefreshCompetitionData?.();
                      } catch (caught) {
                        setCleanupError(caught instanceof Error ? caught.message : "Ο καθαρισμός απέτυχε.");
                      } finally {
                        setCleanupBusy(false);
                      }
                    }}
                    className="mt-3 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-black text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Καθαρισμός δεδομένων διοργάνωσης
                  </button>
                ) : (
                  <p className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-600">
                    Ο καθαρισμός είναι διαθέσιμος μόνο όταν η διοργάνωση είναι Under Construction και έχει αποθηκευτεί πρώτα.
                  </p>
                )}
              </div>
            </form>
          ) : workspaceMode === "phases" ? (
            <article className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              {!showAddPhaseForm && (
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSeriesContinuationSeed(null);
                      setAddPhaseChoice("new");
                      setShowAddPhaseForm(true);
                    }}
                    disabled={!!editingPhaseId}
                    className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                      editingPhaseId ? "cursor-not-allowed border-zinc-300 bg-zinc-50 text-zinc-400" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
                    }`}
                  >
                    + Προσθήκη Φάσης
                  </button>
                </div>
              )}
              {showAddPhaseForm && (
                <>
                <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-zinc-700">Προσθήκη Φάσης</p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddPhaseForm(false);
                        setAddPhaseChoice(null);
                        setSeriesContinuationSeed(null);
                      }}
                      className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                    >
                      Ακύρωση
                    </button>
                  </div>
                  {addPhaseChoice === "new" ? (
                      <form
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const ok = await submit("phases", event);
                          if (!ok) return;
                          setShowAddPhaseForm(false);
                          setAddPhaseChoice(null);
                          setSeriesContinuationSeed(null);
                          setNewPhaseName("");
                          setNewPhaseFormat("standings");
                          setNewPhasePreviousId("");
                          setActivateLatestPhaseAfterAdd(true);
                        }}
                        className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2"
                      >
                        <input type="hidden" name="competitionId" value={String(workspaceCompetitionId)} />
                        <Field label="Ονομασία">
                          <input
                            required
                            name="name"
                            value={newPhaseName}
                            onChange={(event) => setNewPhaseName(event.target.value)}
                            className={inputClass}
                            placeholder="Προημιτελικά"
                          />
                        </Field>
                        <Field label="Μορφή">
                          <select
                            name="format"
                            value={newPhaseFormat}
                            onChange={(event) => setNewPhaseFormat(event.target.value === "series" ? "series" : "standings")}
                            className={inputClass}
                          >
                            <option value="standings">Βαθμολογική</option>
                            <option value="series">Σειρά αγώνων</option>
                          </select>
                        </Field>
                        <Field label="Ακολουθεί τη Φάση">
                          <select
                            name="previousPhaseId"
                            value={newPhasePreviousId}
                            onChange={(event) => setNewPhasePreviousId(event.target.value)}
                            className={inputClass}
                          >
                            <option value="">Κανονική Περίοδος</option>
                            {selectedCompetitionPhases.map((phase) => (
                              <option key={String(phase.id)} value={String(phase.id)}>
                                {phase.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <input
                          type="hidden"
                          name="orderIndex"
                          value={String((Number(selectedCompetitionPhases[selectedCompetitionPhases.length - 1]?.phase_order ?? selectedCompetitionPhases[selectedCompetitionPhases.length - 1]?.order_index ?? 0) + 1))}
                        />
                        <div className="flex flex-wrap gap-3 sm:col-span-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddPhaseForm(false);
                              setAddPhaseChoice(null);
                              setSeriesContinuationSeed(null);
                              setNewPhaseName("");
                              setNewPhaseFormat("standings");
                              setNewPhasePreviousId("");
                            }}
                            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                          >
                            Ακύρωση
                          </button>
                          <button type="submit" disabled={busy} className={buttonClass}>
                            Δημιουργία Φάσης
                          </button>
                        </div>
                      </form>
                  ) : (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                      <p className="font-black text-zinc-900">Νέα Φάση</p>
                      <p className="mt-1 text-zinc-600">Η λειτουργία δημιουργίας θα ενεργοποιηθεί στο επόμενο βήμα.</p>
                    </div>
                  )}
                </>
              )}
              {!selectedCompetitionPhases.length && <p className="text-sm text-zinc-500">Δεν έχουν δημιουργηθεί ακόμη Φάσεις.</p>}
              {selectedCompetitionPhases.map((phase, index) => {
                const phaseIdValue = String(phase.id);
                const isExpanded = openPhaseId === phaseIdValue;
                const isEditingPhase = editingPhaseId === phaseIdValue;
                const phaseOrder = Number(phase.phase_order ?? phase.order_index ?? 0) || index + 1;
                const phaseFormat = String(phase.format ?? phase.phase_kind ?? "standings");
                const lifecycleStatus = String((phase as Row).lifecycle_status ?? "active");
                const isFinalized = lifecycleStatus === "finalized";
                const phaseGames = data.games.filter((game) => String(game.phase_id ?? "") === phaseIdValue);
                const seriesCompletion = phaseFormat === "series"
                  ? deriveSeriesPhaseCompletion(data.phases, data.games, data.teams, phase)
                  : null;
                const completedGames = phaseGames.filter((game) => String(game.status ?? "") === "completed").length;
                const totalGames = phaseGames.length;
                const headerSummary = totalGames ? `${isFinalized ? "Οριστικοποιημένη" : "Σε εξέλιξη"} · ${completedGames}/${totalGames}` : (isFinalized ? "Οριστικοποιημένη" : "Σε εξέλιξη");
                const fallbackPhaseId = (() => {
                  const currentIndex = selectedCompetitionPhases.findIndex((entry) => String(entry.id) === phaseIdValue);
                  if (currentIndex > 0) return String(selectedCompetitionPhases[currentIndex - 1].id);
                  return String(selectedCompetitionPhases[0]?.id ?? "");
                })();
                const handlePhaseSave = async (event: MouseEvent<HTMLButtonElement>) => {
                  const form = event.currentTarget.form;
                  if (!form) return;
                  const syntheticEvent = ({
                    preventDefault: () => {},
                    currentTarget: form,
                  } as unknown) as FormEvent<HTMLFormElement>;
                  if (await updateEntity("phases", phaseIdValue, syntheticEvent, "Η φάση ενημερώθηκε.")) {
                    if (phaseFormat !== "series") {
                      setEditingPhaseId(null);
                    }
                  }
                };
                const handleContinueSeries = () => {
                  if (!isEditingPhase) return;
                  const { from, to } = formatParticipantRangeFromPhase(phase);
                  setSeriesContinuationSeed({
                    sourcePhaseId: phaseIdValue,
                    sourceName: String(phase.name ?? ""),
                    from,
                    to,
                  });
                  setShowAddPhaseForm(true);
                  setEditingPhaseId(null);
                  setOpenPhaseId(phaseIdValue);
                };
                const phaseBody = (() => {
                  if (!isExpanded) return null;
                  const shouldUseC4Save = String(phaseFormat) === "series";
                  const rawPhase = data.phases.find((entry) => String(entry.id) === phaseIdValue) ?? phase;
                  const seriesSummaryPhase = {
                    ...rawPhase,
                    previous_phase_id: String(
                      (rawPhase as Record<string, unknown>).previous_phase_id
                      ?? (rawPhase as Record<string, unknown>).previousPhaseId
                      ?? "",
                    ).trim(),
                  };
                  const ruleSettings = (() => {
                    try {
                      const raw = String((rawPhase as Record<string, unknown>).rule_settings_json ?? "");
                      const parsed = raw ? JSON.parse(raw) : {};
                      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
                    } catch {
                      return {};
                    }
                  })();
                  const summaries = describeSeriesMatchupsFromPhase(data, seriesSummaryPhase);
                  return (
                    <>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <span className={isFinalized ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-700" : "inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-700"}>
                          {isFinalized ? "Οριστικοποιημένη" : "Σε εξέλιξη"}
                        </span>
                        {!isFinalized && (phaseFormat === "standings" || phaseFormat === "series") && (
                          <button
                            type="button"
                            disabled={phaseFormat === "series" && !seriesCompletion?.competitivelyComplete}
                            title={phaseFormat === "series" && !seriesCompletion?.competitivelyComplete
                              ? seriesCompletion?.blockers.map((entry) => entry.message).join(" ")
                              : undefined}
                            onClick={() => {
                              setFinalizePhaseConfirmation("");
                              setFinalizePhaseDialog({
                                phaseId: phaseIdValue,
                                phaseName: String(phase.name ?? ""),
                                competitionId: String(phase.competition_id ?? ""),
                                phaseFormat,
                              });
                            }}
                            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-black text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Οριστικοποίηση φάσης
                          </button>
                        )}
                        {!isFinalized && phaseFormat === "series" && seriesCompletion && !seriesCompletion.competitivelyComplete && (
                          <span className="text-xs font-semibold text-amber-800">
                            {seriesCompletion.blockers[0]?.message ?? "Η σειρά δεν έχει ολοκληρωθεί ανταγωνιστικά."}
                          </span>
                        )}
                        {isFinalized ? <span className="text-sm font-black text-zinc-600">{headerSummary}</span> : <span className="text-sm text-zinc-600">{headerSummary}</span>}
                      </div>
                      {isEditingPhase ? (
                        <form
                          onSubmit={async (event) => {
                            if (await updateEntity("phases", phaseIdValue, event, "Η φάση ενημερώθηκε.")) {
                              setEditingPhaseId(null);
                            }
                          }}
                          className="mt-4 w-full min-w-0 space-y-4 border-t border-zinc-200 pt-4"
                        >
                          <PhaseFields
                            data={data}
                            phase={phase}
                            competitionId={String(phase.competition_id ?? "")}
                            editing
                            onExplicitSave={shouldUseC4Save ? handlePhaseSave : undefined}
                            onContinueSeries={shouldUseC4Save ? handleContinueSeries : undefined}
                            onCancel={() => setEditingPhaseId(null)}
                          />
                          <input type="hidden" name="competitionId" value={String(phase.competition_id ?? "")} />
                          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                            <p className="text-sm font-black text-red-800">Επικίνδυνες ενέργειες</p>
                            <p className="mt-1 text-sm text-red-700">Η διαγραφή επιτρέπεται μόνο όταν δεν υπάρχουν επόμενες φάσεις που εξαρτώνται από αυτή.</p>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                const phaseName = String(phase.name ?? "");
                                if (!window.confirm(`Θέλετε σίγουρα να διαγράψετε τη φάση «${phaseName}»;`)) return;
                                if (await deleteEntity("phases", phaseIdValue, `Η φάση «${phaseName}» διαγράφηκε.`)) {
                                  setEditingPhaseId(null);
                                  setOpenPhaseId(fallbackPhaseId);
                                }
                              }}
                              className="mt-3 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Διαγραφή Φάσης
                            </button>
                          </div>
                        </form>
                      ) : phaseFormat === "series" ? (
                        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                          <p className="text-sm font-black text-zinc-900">Διασταυρώσεις</p>
                          <div className="mt-3 space-y-2">
                            {summaries.length ? summaries.map((summary) => (
                              <div key={summary.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                                <p>{summary.label}</p>
                              </div>
                            )) : <p className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500">Δεν έχουν οριστεί ακόμη διασταυρώσεις.</p>}
                          </div>
                        </div>
                      ) : (
                        <StandingsPhasePreview data={data} phase={phase} openTeamRoster={showTeamRosterPopup} />
                      )}
                    </>
                  );
                })();

                return (
                  <article key={`phase-${phaseIdValue}`} className={`rounded-2xl border ${isExpanded ? "border-orange-300 bg-white" : "border-zinc-200 bg-zinc-50"} p-4 sm:p-5`}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenPhaseId(isExpanded ? null : phaseIdValue);
                        setEditingPhaseId(null);
                      }}
                      className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
                    >
                      <div className="space-y-1">
                        <p className="text-xs font-black uppercase tracking-wider text-orange-600">{phaseOrder}. {String(phase.name ?? "—")}</p>
                        <p className={`text-sm font-black ${isExpanded ? "text-zinc-900" : "text-zinc-700"}`}>{headerSummary}</p>
                      </div>
                      <span className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500">
                        {isExpanded ? "Σύμπτυξη" : "Άνοιγμα"}
                      </span>
                    </button>
                    {isExpanded ? (
                      <div className="mt-4 border-t border-zinc-200 pt-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <p className="text-sm text-zinc-700">{phaseFormatLabel(phaseFormat)} · σειρά {phaseOrder}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingPhaseId(isEditingPhase ? null : phaseIdValue)}
                            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500"
                          >
                            {isEditingPhase ? "Αρχικό μενού Φάσεων" : "Edit Φάσης"}
                          </button>
                        </div>
                        {phaseBody}
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {finalizePhaseDialog && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
                  <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wider text-orange-600">Οριστικοποίηση φάσης</p>
                        <h3 className="mt-1 text-xl font-black text-zinc-950">{finalizePhaseDialog.phaseName}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFinalizePhaseDialog(null);
                          setFinalizePhaseConfirmation("");
                        }}
                        className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-black text-zinc-700 transition hover:border-orange-500"
                      >
                        Ακύρωση
                      </button>
                    </div>
                    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      {finalizePhaseDialog.phaseFormat === "series"
                        ? "Όλα τα αποτελέσματα της σειράς έχουν επιλυθεί. Οι ομάδες που προκρίθηκαν θα γίνουν οριστικές για τις επόμενες φάσεις. Τα αποτελέσματα, οι διασταυρώσεις και οι ρυθμίσεις μεταφοράς θα κλειδωθούν."
                        : "Η οριστικοποίηση της φάσης καθιστά την τελική κατάταξη διαθέσιμη στις επόμενες φάσεις και κλειδώνει βασικές ρυθμίσεις της φάσης."}
                    </p>
                    <form
                      className="mt-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (String(finalizePhaseConfirmation).trim() !== "ΟΡΙΣΤΙΚΟΠΟΙΗΣΗ") return;
                        const ok = await updateEntity("phases", finalizePhaseDialog.phaseId, event, "Η φάση οριστικοποιήθηκε.");
                        if (ok) {
                          setFinalizePhaseDialog(null);
                          setFinalizePhaseConfirmation("");
                        }
                      }}
                    >
                      <input type="hidden" name="action" value="finalizePhase" />
                      <input type="hidden" name="phaseId" value={finalizePhaseDialog.phaseId} />
                      <input type="hidden" name="competitionId" value={finalizePhaseDialog.competitionId} />
                      <label className="block text-sm font-black text-zinc-800">
                        Πληκτρολόγησε ακριβώς <span className="text-orange-600">ΟΡΙΣΤΙΚΟΠΟΙΗΣΗ</span>
                        <input
                          value={finalizePhaseConfirmation}
                          onChange={(event) => setFinalizePhaseConfirmation(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-zinc-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                          placeholder="ΟΡΙΣΤΙΚΟΠΟΙΗΣΗ"
                        />
                      </label>
                      <div className="mt-5 flex flex-wrap items-center gap-3">
                        <button
                          type="submit"
                          disabled={String(finalizePhaseConfirmation).trim() !== "ΟΡΙΣΤΙΚΟΠΟΙΗΣΗ" || busy}
                          className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Οριστικοποίηση φάσης
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFinalizePhaseDialog(null);
                            setFinalizePhaseConfirmation("");
                          }}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:border-orange-500"
                        >
                          Ακύρωση
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {teamRosterLoading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div className="max-w-sm rounded-2xl bg-white p-6 text-center text-zinc-700">Φόρτωση ρόστερ…</div>
                </div>
              )}
              {teamRosterError && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div className="w-full max-w-xl rounded-2xl bg-white p-4">
                    <div className="text-sm font-black text-red-700">{teamRosterError}</div>
                    <button type="button" onClick={closeTeamRosterPopup} className="mt-4 rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Κλείσιμο</button>
                  </div>
                </div>
              )}
              {teamRoster && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-4 sm:p-6">
                    <div className="mb-4 flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-xl font-black text-zinc-950">{teamRoster.teamName}</h3>
                        <p className="text-sm text-zinc-600">{teamRoster.competitionName} · {teamRoster.seasonName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" className={`${buttonClass} text-sm`}>Επεξεργασία Ρόστερ</button>
                        <button type="button" onClick={closeTeamRosterPopup} className="rounded-xl border border-zinc-300 px-3 py-2.5 font-black">Κλείσιμο</button>
                      </div>
                    </div>
                    {teamRosterNotice ? <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{teamRosterNotice}</p> : null}
                    <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                      <h4 className="font-black text-zinc-800">Αθλητές</h4>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left text-sm">
                          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                            <tr>
                              <th className="px-3 py-2">#</th><th className="px-3 py-2">Φωτογραφία</th><th className="px-3 py-2">Όνομα</th><th className="px-3 py-2">Επώνυμο</th><th className="px-3 py-2">Ημ. Γέννησης</th><th className="px-3 py-2">Νο. Φανέλας</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rosterPlayers.map((athlete) => (
                              <tr key={athlete.roster_id} className="border-b border-zinc-100 last:border-0">
                                <td className="px-3 py-2">{athlete.rowIndex}</td>
                                <td className="px-3 py-2">
                                  {athlete.photo_url ? <img src={athlete.photo_url} alt={`${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`} className="h-8 w-8 rounded-full object-cover" /> : <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500">—</span>}
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    className="text-blue-700 underline decoration-blue-300 hover:text-blue-900"
                                    onClick={() => openAthleteEdit(athlete)}
                                    disabled={rosterActionBusy}
                                  >
                                    {athlete.first_name || athlete.display_name || "—"}
                                  </button>
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    className="text-blue-700 underline decoration-blue-300 hover:text-blue-900"
                                    onClick={() => openAthleteEdit(athlete)}
                                    disabled={rosterActionBusy}
                                  >
                                    {athlete.last_name || athlete.display_name || "—"}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-zinc-700">{parseDateForDisplay(String(athlete.birth_date ?? ""))}</td>
                                <td className="px-3 py-2 text-zinc-700">{athlete.shirt_number ?? "—"}</td>
                              </tr>
                            ))}
                            {!rosterPlayers.length && <tr><td className="px-3 py-4 text-zinc-500" colSpan={6}>Δεν υπάρχουν αθλητές στο roster.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <section className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                      <h4 className="font-black text-zinc-800">Staff</h4>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[680px] text-left text-sm">
                          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                            <tr><th className="px-3 py-2">Φωτογραφία</th><th className="px-3 py-2">Όνομα</th><th className="px-3 py-2">Επώνυμο</th><th className="px-3 py-2">Ρόλος</th></tr>
                          </thead>
                          <tbody>
                            {teamRoster.staff.map((member) => {
                              const firstName = member.first_name?.trim() ? member.first_name : member.display_name;
                              const lastName = member.last_name?.trim() ? member.last_name : member.display_name;
                              return (
                                <tr key={member.membership_id} className="border-b border-zinc-100 last:border-0">
                                  <td className="px-3 py-2">
                                    {member.photo_url ? <img src={member.photo_url} alt={firstName ?? ""} className="h-8 w-8 rounded-full object-cover" /> : <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-zinc-700">{firstName || "—"}</td>
                                  <td className="px-3 py-2 text-zinc-700">{lastName || "—"}</td>
                                  <td className="px-3 py-2 text-zinc-700">{member.role === "other" ? (member.custom_role_label || staffRoleLabels.other) : staffRoleLabels[member.role as TeamRosterViewRole] || member.role}</td>
                                </tr>
                              );
                            })}
                            {!teamRoster.staff.length && <tr><td className="px-3 py-4 text-zinc-500" colSpan={4}>Δεν υπάρχουν staff μέλη στο roster.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                </div>
              )}
              {editingAthlete && (
                <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
                  <div className="w-full max-w-xl rounded-2xl bg-white p-4 sm:p-6">
                    <h3 className="text-lg font-black text-zinc-950">Athlete Edit</h3>
                    <p className="mt-1 text-sm text-zinc-600">Φωτογραφία • Όνομα • Επώνυμο • Ημ. Γέννησης • Νο. Φανέλας</p>
                    <div className="mt-4 grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Όνομα"><input value={editingAthleteFirstName} onChange={(event)=>setEditingAthleteFirstName(event.target.value)} className={inputClass} /></Field>
                        <Field label="Επώνυμο"><input value={editingAthleteLastName} onChange={(event)=>setEditingAthleteLastName(event.target.value)} className={inputClass} /></Field>
                      </div>
                      <Field label="Ημερομηνία γέννησης"><input type="date" value={editingAthleteBirthDate} onChange={(event)=>setEditingAthleteBirthDate(event.target.value)} className={inputClass} /></Field>
                      <Field label="Νο. Φανέλας"><input value={editingAthleteShirtNumber} onChange={(event)=>setEditingAthleteShirtNumber(event.target.value)} className={inputClass} /></Field>
                      <Field label="Φωτογραφία">
                        <div className="mt-1 flex items-center gap-3">
                          <div className="h-16 w-16 overflow-hidden rounded-full bg-zinc-100">
                            {(editingAthletePhotoPreview || editingAthletePhotoUrl)
                              ? <img src={editingAthletePhotoPreview || editingAthletePhotoUrl} alt="Athlete photo preview" className="h-full w-full object-cover" />
                              : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">—</div>}
                          </div>
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:bg-zinc-100">
                            <span>📷 {editingAthletePhotoPreview || editingAthletePhotoUrl ? "Αλλαγή φωτογραφίας" : "Επιλογή φωτογραφίας"}</span>
                            <input type="file" accept="image/*" className="hidden" onChange={(event)=>{ const file = event.currentTarget.files?.[0]; if (!file) return; handleAthletePhotoSelect(file); }} />
                          </label>
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">{editingAthleteUploadBusy ? "Φόρτωση εικόνας..." : (editingAthletePhotoFileName ? `Επιλεγμένο αρχείο: ${editingAthletePhotoFileName}` : editingAthleteUploadMessage || "Επίλεξε φωτογραφία από τον υπολογιστή.")}</p>
                      </Field>
                      <div className="mt-1 flex gap-2">
                        <button type="button" className={buttonClass} onClick={() => void saveAthleteEditsFromRoster()} disabled={rosterActionBusy}>Αποθήκευση</button>
                        <button type="button" onClick={() => { if (editingAthletePhotoPreview && editingAthletePhotoPreview.startsWith("blob:")) URL.revokeObjectURL(editingAthletePhotoPreview); setEditingAthletePhotoPreview(""); setEditingAthletePhotoFileName(""); setEditingAthlete(null); }} className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Ακύρωση</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </article>
          ) : (
            <ProgramGamesSection
              data={data}
              competitionId={workspaceCompetitionId}
              submit={submit}
              updateEntity={updateEntity}
              deleteEntity={deleteEntity}
              bulkScheduleGames={bulkScheduleGames}
              busy={busy}
              onRefreshCompetitionData={onRefreshCompetitionData}
            />
          )}
        </Panel>
      )}
    </div>
  );
}


