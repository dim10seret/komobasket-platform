import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Field,
  Panel,
  SearchAthleteResult,
  SearchStaffResult,
  RosterActionKind,
  compareNullable,
  Row,
  SortState,
  Snapshot,
  TeamRosterAthleteWithIndex,
  TeamRosterManagementView,
  TeamRosterStaffWithIndex,
  TeamRosterViewRole,
  buttonClass,
  inputClass,
  parseDateForDisplay,
  staffRoleLabels,
  clearBlobPreviewUrl,
} from "../shared/admin-core";


export function Players({data}:{data:Snapshot}) {
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
  const [newAthletePhotoPreview, setNewAthletePhotoPreview] = useState("");
  const [newAthletePhotoFileName, setNewAthletePhotoFileName] = useState("");
  const [newAthleteShirtNumber, setNewAthleteShirtNumber] = useState("");
  const [newAthleteUploadMessage, setNewAthleteUploadMessage] = useState("");
  const [newAthleteUploadBusy, setNewAthleteUploadBusy] = useState(false);
  const [newStaffFirstName, setNewStaffFirstName] = useState("");
  const [newStaffLastName, setNewStaffLastName] = useState("");
  const [newStaffBirthDate, setNewStaffBirthDate] = useState("");
  const [newStaffPhotoPreview, setNewStaffPhotoPreview] = useState("");
  const [newStaffPhotoFileName, setNewStaffPhotoFileName] = useState("");
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
  const [editingAthletePhotoPreview, setEditingAthletePhotoPreview] = useState("");
  const [editingAthletePhotoFileName, setEditingAthletePhotoFileName] = useState("");
  const [editingAthleteShirtNumber, setEditingAthleteShirtNumber] = useState("");
  const [editingAthleteUploadBusy, setEditingAthleteUploadBusy] = useState(false);
  const [editingAthleteUploadMessage, setEditingAthleteUploadMessage] = useState("");
  const [editingStaff, setEditingStaff] = useState<TeamRosterStaffWithIndex | null>(null);
  const [editingStaffFirstName, setEditingStaffFirstName] = useState("");
  const [editingStaffLastName, setEditingStaffLastName] = useState("");
  const [editingStaffBirthDate, setEditingStaffBirthDate] = useState("");
  const [editingStaffPhotoUrl, setEditingStaffPhotoUrl] = useState("");
  const [editingStaffPhotoPreview, setEditingStaffPhotoPreview] = useState("");
  const [editingStaffPhotoFileName, setEditingStaffPhotoFileName] = useState("");
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
    clearBlobPreviewUrl(newAthletePhotoPreview);
    setNewAthletePhotoPreview("");
    setNewAthletePhotoFileName("");
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
    clearBlobPreviewUrl(newStaffPhotoPreview);
    setNewStaffPhotoPreview("");
    setNewStaffPhotoFileName("");
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

  const handleNewAthletePhotoSelect = (file: File) => {
    clearBlobPreviewUrl(newAthletePhotoPreview);
    setNewAthletePhotoFileName(file.name);
    setNewAthletePhotoPreview(URL.createObjectURL(file));
    setNewAthleteUploadMessage("Φόρτωση εικόνας...");
    void uploadEntityPhoto(file, setNewAthletePhotoUrl, setNewAthleteUploadBusy, setNewAthleteUploadMessage);
  };

  const handleNewStaffPhotoSelect = (file: File) => {
    clearBlobPreviewUrl(newStaffPhotoPreview);
    setNewStaffPhotoFileName(file.name);
    setNewStaffPhotoPreview(URL.createObjectURL(file));
    setNewStaffUploadMessage("Φόρτωση εικόνας...");
    void uploadEntityPhoto(file, setNewStaffPhotoUrl, setNewStaffUploadBusy, setNewStaffUploadMessage);
  };

  const handleEditingAthletePhotoSelect = (file: File) => {
    clearBlobPreviewUrl(editingAthletePhotoPreview);
    setEditingAthletePhotoFileName(file.name);
    setEditingAthletePhotoPreview(URL.createObjectURL(file));
    setEditingAthleteUploadMessage("Φόρτωση εικόνας...");
    void uploadEntityPhoto(file, setEditingAthletePhotoUrl, setEditingAthleteUploadBusy, setEditingAthleteUploadMessage);
  };

  const handleEditingStaffPhotoSelect = (file: File) => {
    clearBlobPreviewUrl(editingStaffPhotoPreview);
    setEditingStaffPhotoFileName(file.name);
    setEditingStaffPhotoPreview(URL.createObjectURL(file));
    setEditingStaffUploadMessage("Φόρτωση εικόνας...");
    void uploadEntityPhoto(file, setEditingStaffPhotoUrl, setEditingStaffUploadBusy, setEditingStaffUploadMessage);
  };

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

    clearBlobPreviewUrl(editingAthletePhotoPreview);
    setEditingAthletePhotoPreview("");
    setEditingAthletePhotoFileName("");
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

    clearBlobPreviewUrl(editingStaffPhotoPreview);
    setEditingStaffPhotoPreview("");
    setEditingStaffPhotoFileName("");
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500"><tr>
                  <th className="px-3 py-3">#</th><th className="px-3 py-3">Φωτό</th>
                  <th className="px-3 py-3"><button type="button" onClick={() => sortAthleteColumn("first_name")} className="text-left hover:text-zinc-900">Όνομα{athleteSort.key === "first_name" ? (athleteSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
                  <th className="px-3 py-3"><button type="button" onClick={() => sortAthleteColumn("last_name")} className="text-left hover:text-zinc-900">Επώνυμο{athleteSort.key === "last_name" ? (athleteSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
                  <th className="px-3 py-3"><button type="button" onClick={() => sortAthleteColumn("birth_date")} className="text-left hover:text-zinc-900">Ημ. Γέννησης{athleteSort.key === "birth_date" ? (athleteSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
                  <th className="px-3 py-3"><button type="button" onClick={() => sortAthleteColumn("shirt_number")} className="text-left hover:text-zinc-900">Νο. Φανέλας{athleteSort.key === "shirt_number" ? (athleteSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
                  <th className="px-3 py-3">Ενέργειες</th>
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
                              clearBlobPreviewUrl(editingAthletePhotoPreview);
                              setEditingAthletePhotoPreview(String(athlete.photo_url ?? ""));
                              setEditingAthletePhotoFileName("");
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500"><tr>
                  <th className="px-3 py-3">Φωτό</th>
                  <th className="px-3 py-3"><button type="button" onClick={() => sortStaffColumn("staff_first_name")} className="text-left hover:text-zinc-900">Όνομα{staffSort.key === "staff_first_name" ? (staffSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
                  <th className="px-3 py-3"><button type="button" onClick={() => sortStaffColumn("staff_last_name")} className="text-left hover:text-zinc-900">Επώνυμο{staffSort.key === "staff_last_name" ? (staffSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
                  <th className="px-3 py-3"><button type="button" onClick={() => sortStaffColumn("staff_role")} className="text-left hover:text-zinc-900">Ρόλος{staffSort.key === "staff_role" ? (staffSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
                  <th className="px-3 py-3">Ενέργειες</th>
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
                              clearBlobPreviewUrl(editingStaffPhotoPreview);
                              setEditingStaffPhotoPreview(String(member.photo_url ?? ""));
                              setEditingStaffPhotoFileName("");
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
                    <div className="mt-1 flex items-center gap-3">
                      <div className="h-16 w-16 overflow-hidden rounded-full bg-zinc-100">
                        {(newAthletePhotoPreview || newAthletePhotoUrl)
                          ? <img src={newAthletePhotoPreview || newAthletePhotoUrl} alt="Άσκηση προεπισκόπησης" className="h-full w-full object-cover" />
                          : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">—</div>}
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:bg-zinc-100">
                        <span>📷 {newAthletePhotoPreview || newAthletePhotoUrl ? "Αλλαγή φωτογραφίας" : "Επιλογή φωτογραφίας"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (!file) return;
                            handleNewAthletePhotoSelect(file);
                          }}
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">{newAthleteUploadBusy ? "Φόρτωση εικόνας..." : (newAthletePhotoFileName ? `Επιλεγμένο αρχείο: ${newAthletePhotoFileName}` : newAthleteUploadMessage || "Επίλεξε φωτογραφία από τον υπολογιστή.")}</p>
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
                    <div className="mt-1 flex items-center gap-3">
                      <div className="h-16 w-16 overflow-hidden rounded-full bg-zinc-100">
                        {(newStaffPhotoPreview || newStaffPhotoUrl)
                          ? <img src={newStaffPhotoPreview || newStaffPhotoUrl} alt="Άσκηση προεπισκόπησης" className="h-full w-full object-cover" />
                          : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">—</div>}
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:bg-zinc-100">
                        <span>📷 {newStaffPhotoPreview || newStaffPhotoUrl ? "Αλλαγή φωτογραφίας" : "Επιλογή φωτογραφίας"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (!file) return;
                            handleNewStaffPhotoSelect(file);
                          }}
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">{newStaffUploadBusy ? "Φόρτωση εικόνας..." : (newStaffPhotoFileName ? `Επιλεγμένο αρχείο: ${newStaffPhotoFileName}` : newStaffUploadMessage || "Επίλεξε φωτογραφία από τον υπολογιστή.")}</p>
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
                  <div className="mt-1 flex items-center gap-3">
                    <div className="h-16 w-16 overflow-hidden rounded-full bg-zinc-100">
                      {(editingAthletePhotoPreview || editingAthletePhotoUrl)
                        ? <img src={editingAthletePhotoPreview || editingAthletePhotoUrl} alt="Άσκηση προεπισκόπησης" className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">—</div>}
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:bg-zinc-100">
                      <span>📷 {editingAthletePhotoPreview || editingAthletePhotoUrl ? "Αλλαγή φωτογραφίας" : "Επιλογή φωτογραφίας"}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (!file) return;
                          handleEditingAthletePhotoSelect(file);
                        }}
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{editingAthleteUploadBusy ? "Φόρτωση εικόνας..." : (editingAthletePhotoFileName ? `Επιλεγμένο αρχείο: ${editingAthletePhotoFileName}` : editingAthleteUploadMessage || "Επίλεξε φωτογραφία από τον υπολογιστή.")}</p>
                </Field>
                <div className="mt-1 flex gap-2">
                  <button type="button" className={buttonClass} onClick={() => void saveAthleteEdits()} disabled={actionBusy}>
                    Αποθήκευση
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearBlobPreviewUrl(editingAthletePhotoPreview);
                      setEditingAthletePhotoPreview("");
                      setEditingAthletePhotoFileName("");
                      setEditingAthlete(null);
                    }}
                    className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black"
                  >
                    Ακύρωση
                  </button>
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
                  <div className="mt-1 flex items-center gap-3">
                    <div className="h-16 w-16 overflow-hidden rounded-full bg-zinc-100">
                      {(editingStaffPhotoPreview || editingStaffPhotoUrl)
                        ? <img src={editingStaffPhotoPreview || editingStaffPhotoUrl} alt="Άσκηση προεπισκόπησης" className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">—</div>}
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-black text-zinc-800 transition hover:bg-zinc-100">
                      <span>📷 {editingStaffPhotoPreview || editingStaffPhotoUrl ? "Αλλαγή φωτογραφίας" : "Επιλογή φωτογραφίας"}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (!file) return;
                          handleEditingStaffPhotoSelect(file);
                        }}
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{editingStaffUploadBusy ? "Φόρτωση εικόνας..." : (editingStaffPhotoFileName ? `Επιλεγμένο αρχείο: ${editingStaffPhotoFileName}` : editingStaffUploadMessage || "Επίλεξε φωτογραφία από τον υπολογιστή.")}</p>
                </Field>
                <div className="mt-1 flex gap-2">
                  <button type="button" className={buttonClass} onClick={() => void saveStaffEdits()} disabled={actionBusy}>
                    Αποθήκευση
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearBlobPreviewUrl(editingStaffPhotoPreview);
                      setEditingStaffPhotoPreview("");
                      setEditingStaffPhotoFileName("");
                      setEditingStaff(null);
                    }}
                    className="rounded-xl border border-zinc-300 px-4 py-2.5 font-black"
                  >
                    Ακύρωση
                  </button>
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

