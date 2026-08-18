"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Field,
  Panel,
  Row,
  Snapshot,
  DeleteEntity,
  buttonClass,
  getCompetitionTeamsForStandings,
  inputClass,
  parseDateForDisplay,
  parseStandingsRules,
  phaseFormatLabel,
  roundRobinStructureFromTeams,
  scheduleLifecycleLabels,
} from "../shared/admin-core";

type PhaseScheduleRow = Row & {
  id: string;
  competition_id: string | null;
  phase_id: string | null;
  lifecycle_status: string | null;
  phase_name: string | null;
  phase_format: string | null;
  phase_type: string | null;
  phase_order: number | string | null;
  wins_required: number | string | null;
  carry_over_enabled: number | string | null;
  carry_over_source_phase_id: string | null;
  carry_over_source_name: string | null;
};

type GeneratedGameRow = Row & {
  id: string;
  schedule_id: string | null;
  round_number: number | string | null;
  game_order: number | string | null;
  round_label: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | string | null;
  away_score: number | string | null;
  status: string | null;
};

type CompetitionVenueRow = Row & {
  id: string;
  competition_id: string | null;
  name: string | null;
  address: string | null;
  map_url: string | null;
  sort_order: number | string | null;
};

type SchedulingMode = "keep" | "set" | "clear";

type ScheduleEditorState = {
  scheduledDateMode: SchedulingMode;
  scheduledDate: string;
  scheduledTimeMode: SchedulingMode;
  scheduledTime: string;
  venueMode: SchedulingMode;
  venueId: string;
};

const parseObject = (value: unknown) => {
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

const buildPhaseSummary = (data: Snapshot, phase?: Row | null) => {
  if (!phase) return [] as string[];
  const competitionId = String(phase.competition_id ?? "");
  const format = String(phase.format ?? phase.phase_kind ?? "standings").trim().toLowerCase();
  if (format === "standings") {
    const teams = getCompetitionTeamsForStandings(data, competitionId);
    const rules = parseStandingsRules(phase.rule_settings_json);
    const structure = roundRobinStructureFromTeams(teams.length, rules.gamesPerPairing);
    return [
      "Τύπος: Βαθμολογική σειρά",
      `Ομάδες: ${teams.length}`,
      `Αγωνιστικές: ${structure.rounds}`,
      `Αγώνες ανά αγωνιστική: ${structure.gamesPerRound}`,
      `Συνολικοί αγώνες: ${structure.totalGames}`,
      `Ρεπό ανά αγωνιστική: ${structure.byesPerRound}`,
    ];
  }

  if (format === "series") {
    const phaseSettings = parseObject(phase.rule_settings_json);
    const bracketConfig = parseObject(phaseSettings.bracketConfiguration);
    const matchups = Array.isArray(bracketConfig.matchups) ? bracketConfig.matchups : [];
    const winsRequired = Math.max(1, Math.floor(Number(phase.wins_required ?? 0) || 0));
    const carryOverEnabled = Boolean(Number(phase.carry_over_enabled ?? 0));
    const maxTotalResults = winsRequired * 2 - 1;
    const previousCounted = carryOverEnabled ? 1 : 0;
    const maxNewGames = Math.max(0, maxTotalResults - previousCounted);
    return [
      "Τύπος: Σειρά αγώνων",
      `Matchups: ${matchups.length}`,
      `Νίκες για πρόκριση: ${winsRequired}`,
      `Μεταφορά προηγούμενου αγώνα: ${carryOverEnabled ? "Ναι" : "Όχι"}`,
      carryOverEnabled ? `Φάση προέλευσης: ${String(phase.carry_over_source_name ?? "—")}` : "Φάση προέλευσης: —",
      `Μέγιστο συνολικό πλήθος αποτελεσμάτων σειράς: ${maxTotalResults}`,
      `Προηγούμενοι αγώνες που προσμετρώνται: ${previousCounted}`,
      `Μέγιστοι νέοι αγώνες προς προγραμματισμό: ${maxNewGames}`,
    ];
  }

  return [`Τύπος: ${phaseFormatLabel(format)}`];
};

const buildGeneratedRounds = (games: GeneratedGameRow[], teams: { id: string; name: string }[]) => {
  const byRound = new Map<number, GeneratedGameRow[]>();
  for (const game of games) {
    const roundNumber = Number(game.round_number ?? 0) || 0;
    if (!byRound.has(roundNumber)) byRound.set(roundNumber, []);
    byRound.get(roundNumber)?.push(game);
  }
  const rounds = [...byRound.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([roundNumber, roundGames]) => {
      const sortedGames = [...roundGames].sort((left, right) => Number(left.game_order ?? 0) - Number(right.game_order ?? 0));
      const usedTeams = new Set<string>();
      for (const game of sortedGames) {
        if (game.home_team_id) usedTeams.add(String(game.home_team_id));
        if (game.away_team_id) usedTeams.add(String(game.away_team_id));
      }
      const byeTeam = teams.find((team) => !usedTeams.has(team.id)) ?? null;
      return {
        roundNumber,
        roundLabel: String(sortedGames[0]?.round_label ?? `${roundNumber}η Αγωνιστική`),
        games: sortedGames,
        byeTeam,
      };
    });
  return rounds;
};

const createDefaultScheduleEditorState = (): ScheduleEditorState => ({
  scheduledDateMode: "keep",
  scheduledDate: "",
  scheduledTimeMode: "keep",
  scheduledTime: "",
  venueMode: "keep",
  venueId: "",
});

const normalizeTimeEditorValue = (value: string) => {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

const formatGameScheduleLabel = (game: GeneratedGameRow) => {
  const scheduledDate = String(game.scheduled_date ?? "").trim();
  const scheduledTime = String(game.scheduled_time ?? "").trim();
  if (scheduledDate && scheduledTime) return `${scheduledDate} • ${scheduledTime}`;
  if (scheduledDate) return `${scheduledDate} · Ώρα: —`;
  return "Δεν έχει προγραμματιστεί";
};

const sortRoundsForDisplay = (games: GeneratedGameRow[]) => {
  return [...games].sort((left, right) => {
    const leftDate = String(left.scheduled_date ?? "").trim();
    const rightDate = String(right.scheduled_date ?? "").trim();
    const leftTime = String(left.scheduled_time ?? "").trim();
    const rightTime = String(right.scheduled_time ?? "").trim();
    const leftHasDateTime = Boolean(leftDate && leftTime);
    const rightHasDateTime = Boolean(rightDate && rightTime);
    if (leftHasDateTime !== rightHasDateTime) return leftHasDateTime ? -1 : 1;
    if (leftHasDateTime && rightHasDateTime) {
      const byDate = leftDate.localeCompare(rightDate);
      if (byDate) return byDate;
      const byTime = leftTime.localeCompare(rightTime);
      if (byTime) return byTime;
    }
    const leftHasDate = Boolean(leftDate);
    const rightHasDate = Boolean(rightDate);
    if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
    if (leftHasDate && rightHasDate) {
      const byDate = leftDate.localeCompare(rightDate);
      if (byDate) return byDate;
    }
    const leftHasTime = Boolean(leftTime);
    const rightHasTime = Boolean(rightTime);
    if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
    if (leftHasTime && rightHasTime) {
      const byTime = leftTime.localeCompare(rightTime);
      if (byTime) return byTime;
    }
    return Number(left.game_order ?? 0) - Number(right.game_order ?? 0);
  });
};

export function ProgramGamesSection({
  data,
  competitionId,
  submit,
  updateEntity,
  deleteEntity,
  bulkScheduleGames,
  busy,
}: {
  data: Snapshot;
  competitionId: string;
  submit: (resource: string, event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  updateEntity: (resource: string, id: string, event: FormEvent<HTMLFormElement>, successMessage: string) => Promise<boolean>;
  deleteEntity: DeleteEntity;
  bulkScheduleGames: (payload: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const competitionPhases = useMemo(() => {
    return data.phases
      .filter((phase) => String(phase.competition_id ?? "") === competitionId)
      .sort((left, right) => {
        const leftOrder = Number(left.phase_order ?? left.order_index ?? 0);
        const rightOrder = Number(right.phase_order ?? right.order_index ?? 0);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.id).localeCompare(String(right.id));
      });
  }, [data.phases, competitionId]);

  const schedules = useMemo(() => {
    return (data.phaseSchedules as PhaseScheduleRow[])
      .filter((schedule) => String(schedule.competition_id ?? "") === competitionId)
      .sort((left, right) => {
        const leftPhase = competitionPhases.find((phase) => String(phase.id) === String(left.phase_id ?? ""));
        const rightPhase = competitionPhases.find((phase) => String(phase.id) === String(right.phase_id ?? ""));
        const leftOrder = Number(leftPhase?.phase_order ?? leftPhase?.order_index ?? left.phase_order ?? 0);
        const rightOrder = Number(rightPhase?.phase_order ?? rightPhase?.order_index ?? right.phase_order ?? 0);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.id).localeCompare(String(right.id));
      });
  }, [competitionId, competitionPhases, data.phaseSchedules]);

  const scheduledPhaseIds = useMemo(() => new Set(schedules.map((schedule) => String(schedule.phase_id ?? "")).filter(Boolean)), [schedules]);
  const availablePhases = useMemo(() => competitionPhases.filter((phase) => !scheduledPhaseIds.has(String(phase.id))), [competitionPhases, scheduledPhaseIds]);
  const competitionTeams = useMemo(() => {
    return getCompetitionTeamsForStandings(data, competitionId).map((team) => ({
      id: String(team.team_id ?? ""),
      name: String(team.team_name ?? "—"),
    })).filter((team) => team.id && team.name);
  }, [data, competitionId]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPhaseId, setSelectedPhaseId] = useState("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [selectedRoundByScheduleId, setSelectedRoundByScheduleId] = useState<Record<string, number>>({});
  const [showVenueManager, setShowVenueManager] = useState(false);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [editingVenueId, setEditingVenueId] = useState("");
  const [selectedGameIdsByScheduleId, setSelectedGameIdsByScheduleId] = useState<Record<string, string[]>>({});
  const [scheduleEditorByScheduleId, setScheduleEditorByScheduleId] = useState<Record<string, ScheduleEditorState>>({});
  const selectedPhase = availablePhases.find((phase) => String(phase.id) === selectedPhaseId) ?? availablePhases[0] ?? null;

  useEffect(() => {
    if (!showCreateModal) return;
    if (selectedPhase && availablePhases.some((phase) => String(phase.id) === String(selectedPhase.id))) return;
    setSelectedPhaseId(String(availablePhases[0]?.id ?? ""));
  }, [availablePhases, selectedPhase, showCreateModal]);

  const openCreateModal = () => {
    setSelectedPhaseId(String(availablePhases[0]?.id ?? ""));
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
  };

  const selectedSchedule = schedules.find((schedule) => String(schedule.id) === selectedScheduleId) ?? null;
  const competitionVenues = useMemo(() => {
    return (data.competitionVenues as CompetitionVenueRow[])
      .filter((venue) => String(venue.competition_id ?? "") === competitionId)
      .sort((left, right) => {
        const leftOrder = Number(left.sort_order ?? 0) || 0;
        const rightOrder = Number(right.sort_order ?? 0) || 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.name ?? "").localeCompare(String(right.name ?? ""), "el-GR");
      });
  }, [competitionId, data.competitionVenues]);
  const selectedVenue = competitionVenues.find((venue) => String(venue.id) === editingVenueId) ?? null;

  const selectedScheduleGames = useMemo(() => {
    if (!selectedSchedule) return [] as GeneratedGameRow[];
    return (data.games as GeneratedGameRow[])
      .filter((game) => String(game.schedule_id ?? "") === String(selectedSchedule.id))
      .sort((left, right) => {
        const leftRound = Number(left.round_number ?? 0);
        const rightRound = Number(right.round_number ?? 0);
        if (leftRound !== rightRound) return leftRound - rightRound;
        return Number(left.game_order ?? 0) - Number(right.game_order ?? 0);
      });
  }, [data.games, selectedSchedule]);

  const selectedScheduleRounds = useMemo(() => {
    return buildGeneratedRounds(selectedScheduleGames, competitionTeams);
  }, [competitionTeams, selectedScheduleGames]);

  useEffect(() => {
    if (!selectedSchedule) return;
    if (!selectedScheduleGames.length) return;
    const currentRound = selectedRoundByScheduleId[String(selectedSchedule.id)] ?? Number(selectedScheduleGames[0]?.round_number ?? 0);
    if (currentRound && selectedScheduleRounds.some((round) => round.roundNumber === currentRound)) return;
    const firstRound = selectedScheduleRounds[0]?.roundNumber ?? 0;
    if (firstRound) {
      setSelectedRoundByScheduleId((current) => ({ ...current, [String(selectedSchedule.id)]: firstRound }));
    }
  }, [selectedSchedule, selectedScheduleGames.length, selectedScheduleRounds, selectedRoundByScheduleId]);

  const openGenerateModal = (scheduleId: string) => {
    setSelectedScheduleId(scheduleId);
    setShowGenerateModal(true);
  };

  const closeGenerateModal = () => {
    setShowGenerateModal(false);
    setSelectedScheduleId("");
  };

  const openVenueManager = () => {
    setShowVenueForm(competitionVenues.length === 0);
    setEditingVenueId("");
    setShowVenueManager(true);
  };

  const closeVenueManager = () => {
    setShowVenueManager(false);
    setShowVenueForm(false);
    setEditingVenueId("");
  };

  const handleVenueDelete = async (venue: CompetitionVenueRow) => {
    if (!window.confirm(`Να αφαιρεθεί το γήπεδο «${String(venue.name ?? "—")}» από τη λίστα της διοργάνωσης;`)) return;
    await deleteEntity("competition-venues", String(venue.id), `Το γήπεδο «${String(venue.name ?? "—")}» αφαιρέθηκε από τη διοργάνωση.`);
  };

  const startVenueForm = (venueId = "") => {
    setEditingVenueId(venueId);
    setShowVenueForm(true);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await submit("phase-schedules", event);
    if (!ok) return;
    setShowCreateModal(false);
    setSelectedPhaseId("");
  };

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await submit("phase-schedules", event);
    if (!ok) return;
    setShowGenerateModal(false);
    setSelectedScheduleId("");
  };

  const getSelectedGameIds = (scheduleKey: string) => selectedGameIdsByScheduleId[scheduleKey] ?? [];
  const getScheduleEditor = (scheduleKey: string) => scheduleEditorByScheduleId[scheduleKey] ?? createDefaultScheduleEditorState();
  const updateScheduleEditor = (scheduleKey: string, patch: Partial<ScheduleEditorState>) => {
    setScheduleEditorByScheduleId((current) => ({
      ...current,
      [scheduleKey]: {
        ...createDefaultScheduleEditorState(),
        ...(current[scheduleKey] ?? createDefaultScheduleEditorState()),
        ...patch,
      },
    }));
  };
  const clearScheduleSelection = (scheduleKey: string) => {
    setSelectedGameIdsByScheduleId((current) => ({ ...current, [scheduleKey]: [] }));
    setScheduleEditorByScheduleId((current) => ({ ...current, [scheduleKey]: createDefaultScheduleEditorState() }));
  };
  const toggleScheduleGame = (scheduleKey: string, gameId: string) => {
    setSelectedGameIdsByScheduleId((current) => {
      const existing = current[scheduleKey] ?? [];
      const next = existing.includes(gameId) ? existing.filter((value) => value !== gameId) : [...existing, gameId];
      return { ...current, [scheduleKey]: next };
    });
  };
  const setAllScheduleGames = (scheduleKey: string, gameIds: string[]) => {
    setSelectedGameIdsByScheduleId((current) => ({ ...current, [scheduleKey]: [...gameIds] }));
  };
  const saveScheduleSelection = async (scheduleKey: string, scheduleCompetitionId: string, selectedGameIds: string[], editor: ScheduleEditorState) => {
    if (!selectedGameIds.length) return false;
    const ok = await bulkScheduleGames({
      competitionId: scheduleCompetitionId,
      gameIds: selectedGameIds,
      scheduledDateMode: editor.scheduledDateMode,
      scheduledDate: editor.scheduledDateMode === "set" ? editor.scheduledDate : null,
      scheduledTimeMode: editor.scheduledTimeMode,
      scheduledTime: editor.scheduledTimeMode === "set" ? editor.scheduledTime : null,
      venueMode: editor.venueMode,
      venueId: editor.venueMode === "set" ? editor.venueId : null,
    });
    if (!ok) return false;
    clearScheduleSelection(scheduleKey);
    return true;
  };

  return (
    <Panel
      title="Πρόγραμμα & Αγώνες"
      description="Δημιουργία και διαχείριση του προγράμματος αγώνων ανά φάση της διοργάνωσης."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-zinc-900">Πρόγραμμα & Αγώνες</p>
            <p className="mt-1 text-sm text-zinc-600">
              {schedules.length
                ? "Υπάρχουν καταχωρημένα προγράμματα φάσεων."
                : "Δεν έχει δημιουργηθεί πρόγραμμα για κάποια φάση."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={openVenueManager} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700 transition hover:bg-zinc-50">
              Διαχείριση γηπέδων
            </button>
            <button type="button" onClick={openCreateModal} disabled={!competitionPhases.length} className={buttonClass}>
              + Δημιουργία Προγράμματος
            </button>
          </div>
        </div>

        {!schedules.length ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
            Δεν έχει δημιουργηθεί πρόγραμμα για κάποια φάση.
          </div>
        ) : (
          <div className="grid gap-4">
            {schedules.map((schedule) => {
              const scheduleKey = String(schedule.id);
              const phase = competitionPhases.find((entry) => String(entry.id) === String(schedule.phase_id ?? "")) ?? null;
              const phaseRules = parseStandingsRules(phase?.rule_settings_json);
              const structure = roundRobinStructureFromTeams(competitionTeams.length, phaseRules.gamesPerPairing);
              const scheduleGames = (data.games as GeneratedGameRow[]).filter((game) => String(game.schedule_id ?? "") === scheduleKey);
              const completedGames = scheduleGames.filter((game) => String(game.status ?? "") === "completed").length;
              const generatedRounds = buildGeneratedRounds(scheduleGames, competitionTeams);
              const lifecycle = String(schedule.lifecycle_status ?? "draft");
              const hasGames = scheduleGames.length > 0;
              const activeRoundNumber = selectedRoundByScheduleId[scheduleKey] ?? generatedRounds[0]?.roundNumber ?? 0;
              const activeRound = generatedRounds.find((round) => round.roundNumber === activeRoundNumber) ?? generatedRounds[0] ?? null;
              const canGenerate = lifecycle === "draft" && !hasGames && String(phase?.format ?? phase?.phase_kind ?? "").toLowerCase() === "standings" && competitionTeams.length >= 2;
              const totalGames = hasGames ? scheduleGames.length : structure.totalGames;
              const statusLine = hasGames
                ? `${totalGames} αγώνες • ${generatedRounds.length} αγωνιστικές • ${completedGames}/${totalGames} ολοκληρωμένοι`
                : `${structure.totalGames} προβλεπόμενοι αγώνες • ${structure.rounds} αγωνιστικές`;
              const selectedGameIds = getSelectedGameIds(scheduleKey);
              const selectedGameSet = new Set(selectedGameIds);
              const displayedRoundGames = activeRound ? sortRoundsForDisplay(activeRound.games) : [];
              const selectedRoundGames = displayedRoundGames.filter((game) => selectedGameSet.has(String(game.id)));
              const allRoundSelected = displayedRoundGames.length > 0 && displayedRoundGames.every((game) => selectedGameSet.has(String(game.id)));
              const editor = getScheduleEditor(scheduleKey);
              const selectedDateValues = [...new Set(selectedRoundGames.map((game) => String(game.scheduled_date ?? "").trim()).filter(Boolean))];
              const selectedTimeValues = [...new Set(selectedRoundGames.map((game) => String(game.scheduled_time ?? "").trim()).filter(Boolean))];
              const selectedVenueValues = [...new Set(selectedRoundGames.map((game) => String(game.venue ?? "").trim()).filter(Boolean))];
              const commonDateValue = selectedDateValues.length === 1 ? selectedDateValues[0] : "";
              const commonTimeValue = selectedTimeValues.length === 1 ? selectedTimeValues[0] : "";
              const commonVenueValue = selectedVenueValues.length === 1 ? selectedVenueValues[0] : "";
              const commonVenueId = commonVenueValue
                ? competitionVenues.find((venue) => String(venue.name ?? "") === commonVenueValue)?.id ?? ""
                : "";
              const dateInputValue = editor.scheduledDateMode === "set"
                ? editor.scheduledDate
                : editor.scheduledDateMode === "clear"
                  ? ""
                  : commonDateValue;
              const timeInputValue = editor.scheduledTimeMode === "set"
                ? editor.scheduledTime
                : editor.scheduledTimeMode === "clear"
                  ? ""
                  : commonTimeValue;
              const venueSelectValue = editor.venueMode === "set"
                ? editor.venueId
                : editor.venueMode === "clear"
                  ? ""
                  : commonVenueId;
              const canSaveSelection = selectedGameIds.length > 0
                && !(editor.scheduledDateMode === "set" && !dateInputValue)
                && !(editor.scheduledTimeMode === "set" && !timeInputValue)
                && !(editor.venueMode === "set" && (!competitionVenues.length || !venueSelectValue));
              const dateDisplayMode = selectedDateValues.length > 1 ? "Διαφορετικές τιμές" : commonDateValue || "—";
              const timeDisplayMode = selectedTimeValues.length > 1 ? "Διαφορετικές τιμές" : commonTimeValue || "—";
              const venueDisplayMode = selectedVenueValues.length > 1 ? "Διαφορετικές τιμές" : commonVenueValue || "—";
              return (
                <article key={String(schedule.id)} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black text-zinc-950">{String(schedule.phase_name ?? phase?.name ?? "—")}</h3>
                      <p className="mt-1 text-sm text-zinc-600">
                        {phaseFormatLabel(String(schedule.phase_format ?? phase?.format ?? phase?.phase_kind ?? ""))}
                        {typeof schedule.phase_order !== "undefined" ? ` · σειρά ${String(schedule.phase_order ?? phase?.phase_order ?? phase?.order_index ?? "—")}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${lifecycle === "published" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {scheduleLifecycleLabels[lifecycle] ?? lifecycle}
                    </span>
                  </div>
                  <div className="mt-4 space-y-1.5 text-sm text-zinc-700">
                    {buildPhaseSummary(data, phase).map((line) => <p key={line}>{line}</p>)}
                    <p className="pt-1 text-xs font-black uppercase tracking-wide text-zinc-500">{statusLine}</p>
                    {hasGames ? (
                      <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-black text-zinc-900">Αγωνιστικές</p>
                            <button
                              type="button"
                              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                              onClick={() => {
                                if (!displayedRoundGames.length) return;
                                if (allRoundSelected) {
                                  clearScheduleSelection(scheduleKey);
                                  return;
                                }
                                setAllScheduleGames(scheduleKey, displayedRoundGames.map((game) => String(game.id)));
                                if (!selectedGameIdsByScheduleId[scheduleKey]?.length) {
                                  setScheduleEditorByScheduleId((current) => ({
                                    ...current,
                                    [scheduleKey]: current[scheduleKey] ?? createDefaultScheduleEditorState(),
                                  }));
                                }
                              }}
                            >
                              Επιλογή όλων
                            </button>
                          </div>
                          <select
                            className={inputClass}
                            value={String(activeRoundNumber || "")}
                            onChange={(event) => {
                              const nextRoundNumber = Number(event.target.value);
                              setSelectedRoundByScheduleId((current) => ({
                                ...current,
                                [scheduleKey]: nextRoundNumber,
                              }));
                              clearScheduleSelection(scheduleKey);
                            }}
                          >
                            {generatedRounds.map((round) => (
                              <option key={round.roundNumber} value={round.roundNumber}>
                                {round.roundLabel}
                              </option>
                            ))}
                          </select>
                        </div>
                        {activeRound ? (
                          <div className="mt-4">
                        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
                              <table className="w-full min-w-full table-fixed text-left text-sm">
                                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                                  <tr>
                                    <th className="w-12 px-4 py-3" aria-label="Selection"></th>
                                    <th className="w-28 px-4 py-3">Match Report</th>
                                    <th className="px-4 py-3">Γηπεδούχος</th>
                                    <th className="w-24 px-4 py-3">Αποτέλεσμα</th>
                                    <th className="px-4 py-3">Φιλοξενούμενος</th>
                                    <th className="w-32 px-4 py-3">Ημερομηνία</th>
                                    <th className="w-24 px-4 py-3">Ώρα</th>
                                    <th className="px-4 py-3">Γήπεδο</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {displayedRoundGames.map((game) => {
                                    const gameId = String(game.id);
                                    const isSelected = selectedGameSet.has(gameId);
                                    const date = String(game.scheduled_date ?? "").trim();
                                    const time = String(game.scheduled_time ?? "").trim();
                                    const hasScore = String(game.home_score ?? "").trim() || String(game.away_score ?? "").trim();
                                    return (
                                      <tr key={gameId} className={`border-t border-zinc-100 ${isSelected ? "bg-orange-50" : "bg-white"}`}>
                                        <td className="px-4 py-3 align-top">
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleScheduleGame(scheduleKey, gameId)}
                                            className="mt-1 h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                                          />
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                          <button
                                            type="button"
                                            disabled
                                            aria-disabled="true"
                                            className="inline-flex rounded-full border border-zinc-300 bg-zinc-100 px-3 py-1 text-xs font-black text-zinc-500"
                                          >
                                            —
                                          </button>
                                        </td>
                                        <td className="px-4 py-3 align-top text-zinc-800">{String(game.home_team_name ?? "—")}</td>
                                        <td className="px-4 py-3 align-top font-black text-zinc-900">{hasScore ? `${String(game.home_score ?? "—")} – ${String(game.away_score ?? "—")}` : "—"}</td>
                                        <td className="px-4 py-3 align-top text-zinc-800">{String(game.away_team_name ?? "—")}</td>
                                        <td className="px-4 py-3 align-top text-zinc-800">
                                          {date ? parseDateForDisplay(date) : "—"}
                                        </td>
                                        <td className="px-4 py-3 align-top text-zinc-800">
                                          {time || "—"}
                                        </td>
                                        <td className="px-4 py-3 align-top text-zinc-800">
                                          <span className="block max-w-[280px] whitespace-normal break-words">
                                            {String(game.venue ?? "").trim() || "—"}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {activeRound.byeTeam ? (
                              <div className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                                Ρεπό: <span className="font-black text-zinc-900">{activeRound.byeTeam.name}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {!!selectedGameIds.length ? (
                          <div className="mt-4 rounded-2xl border border-orange-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm font-black text-zinc-900">Επιλεγμένοι αγώνες: {selectedGameIds.length}</p>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!selectedGameIds.length) return;
                                  await saveScheduleSelection(scheduleKey, competitionId, selectedGameIds, editor);
                                }}
                                disabled={busy || !canSaveSelection}
                                className={buttonClass}
                              >
                                Επεξεργασία επιλεγμένων
                              </button>
                            </div>

                            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.6fr)]">
                              <Field label="Ημερομηνία">
                                <div className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="date"
                                    value={dateInputValue}
                                    onChange={(event) => updateScheduleEditor(scheduleKey, { scheduledDateMode: "set", scheduledDate: event.target.value })}
                                    className={`${inputClass} min-w-0 flex-1`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateScheduleEditor(scheduleKey, { scheduledDateMode: "clear", scheduledDate: "" })}
                                    className="shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                                  >
                                    Καθαρισμός
                                  </button>
                                </div>
                                <p className="mt-2 text-xs text-zinc-500">
                                  {selectedRoundGames.length
                                    ? `Τρέχουσα τιμή: ${dateDisplayMode || "—"}`
                                    : "Δεν υπάρχουν επιλεγμένοι αγώνες."}
                                </p>
                              </Field>

                              <Field label="Ώρα">
                                <div className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="^([01]\\d|2[0-3]):[0-5]\\d$"
                                    placeholder="18:00"
                                    value={timeInputValue}
                                    onChange={(event) => updateScheduleEditor(scheduleKey, { scheduledTimeMode: "set", scheduledTime: normalizeTimeEditorValue(event.target.value) })}
                                    onBlur={(event) => {
                                      const normalized = normalizeTimeEditorValue(event.target.value);
                                      if (normalized !== event.target.value) {
                                        updateScheduleEditor(scheduleKey, { scheduledTimeMode: "set", scheduledTime: normalized });
                                      }
                                    }}
                                    maxLength={5}
                                    className={`${inputClass} min-w-0 flex-1`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateScheduleEditor(scheduleKey, { scheduledTimeMode: "clear", scheduledTime: "" })}
                                    className="shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                                  >
                                    Καθαρισμός
                                  </button>
                                </div>
                                <p className="mt-2 text-xs text-zinc-500">
                                  {selectedRoundGames.length
                                    ? `Τρέχουσα τιμή: ${timeDisplayMode || "—"}`
                                    : "Δεν υπάρχουν επιλεγμένοι αγώνες."}
                                </p>
                              </Field>

                              <Field label="Γήπεδο">
                                <div className="flex min-w-0 items-center gap-2">
                                  {competitionVenues.length ? (
                                    <select
                                      className={`${inputClass} min-w-0 flex-1 truncate`}
                                      value={venueSelectValue}
                                      onChange={(event) => updateScheduleEditor(scheduleKey, { venueMode: "set", venueId: event.target.value })}
                                    >
                                      <option value="">—</option>
                                      {competitionVenues.map((venue) => (
                                        <option key={String(venue.id)} value={String(venue.id)}>
                                          {String(venue.name ?? "—")}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <p className="min-w-0 flex-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                                      Δεν υπάρχουν διαθέσιμα γήπεδα στη διοργάνωση.
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => updateScheduleEditor(scheduleKey, { venueMode: "clear", venueId: "" })}
                                    className="shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                                  >
                                    Καθαρισμός
                                  </button>
                                </div>
                                <p className="mt-2 text-xs text-zinc-500">
                                  {selectedRoundGames.length
                                    ? `Τρέχουσα τιμή: ${venueDisplayMode || "—"}`
                                    : "Δεν υπάρχουν επιλεγμένοι αγώνες."}
                                </p>
                              </Field>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="pt-1 text-xs font-black uppercase tracking-wide text-zinc-500">
                        {lifecycle === "published" ? "Δημοσιευμένο πρόγραμμα" : "Αναμονή δημιουργίας αγώνων"}
                      </p>
                    )}
                  </div>
                  {canGenerate ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openGenerateModal(String(schedule.id))}
                        className="rounded-xl border border-orange-300 bg-white px-4 py-2.5 text-sm font-black text-orange-700 transition hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Δημιουργία Αγώνων
                      </button>
                    </div>
                  ) : lifecycle === "draft" && hasGames ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled
                        className="rounded-xl border border-red-200 bg-zinc-50 px-4 py-2.5 text-sm font-black text-red-400"
                      >
                        Το πρόγραμμα περιέχει αγώνες και δεν μπορεί να διαγραφεί.
                      </button>
                    </div>
                  ) : lifecycle === "draft" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          const phaseName = String(schedule.phase_name ?? phase?.name ?? "—");
                          if (!window.confirm(`Να διαγραφεί το πρόχειρο πρόγραμμα της φάσης «${phaseName}»;`)) return;
                          await deleteEntity("phase-schedules", String(schedule.id), `Το πρόχειρο πρόγραμμα της φάσης «${phaseName}» διαγράφηκε.`);
                        }}
                        className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Διαγραφή Προχείρου
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-zinc-950">Δημιουργία Προγράμματος</h3>
                <p className="mt-1 text-sm text-zinc-600">Επίλεξε μια ήδη αποθηκευμένη φάση της τρέχουσας διοργάνωσης.</p>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
              >
                Ακύρωση
              </button>
            </div>
            <form onSubmit={handleCreate} className="mt-5 space-y-4">
              <input type="hidden" name="competitionId" value={competitionId} />
              {availablePhases.length ? (
                <Field label="Φάση">
                  <select
                    name="phaseId"
                    required
                    value={selectedPhaseId}
                    onChange={(event) => setSelectedPhaseId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Επιλογή φάσης</option>
                    {availablePhases.map((phase) => (
                      <option key={String(phase.id)} value={String(phase.id)}>
                        {String(phase.name ?? "—")}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {selectedPhase ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm font-black text-zinc-900">Σύνοψη φάσης</p>
                  <div className="mt-3 space-y-1.5 text-sm text-zinc-700">
                    {buildPhaseSummary(data, selectedPhase).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              ) : availablePhases.length ? null : (
                <p className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-bold text-zinc-700">
                  Όλες οι αποθηκευμένες φάσεις έχουν ήδη πρόγραμμα.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700"
                >
                  Ακύρωση
                </button>
                <button disabled={busy || !selectedPhaseId || !availablePhases.length} className={buttonClass}>
                  Δημιουργία Προγράμματος Φάσης
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGenerateModal && selectedSchedule && (() => {
        const phase = competitionPhases.find((entry) => String(entry.id) === String(selectedSchedule.phase_id ?? "")) ?? null;
        const phaseRules = parseStandingsRules(phase?.rule_settings_json);
        const structure = roundRobinStructureFromTeams(competitionTeams.length, phaseRules.gamesPerPairing);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black text-zinc-950">Δημιουργία Αγώνων</h3>
                  <p className="mt-1 text-sm text-zinc-600">
                    Θα δημιουργηθούν {structure.totalGames} αγώνες σε {structure.rounds} αγωνιστικές.
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">Οι αγώνες θα δημιουργηθούν χωρίς ημερομηνία, ώρα και γήπεδο.</p>
                </div>
                <button
                  type="button"
                  onClick={closeGenerateModal}
                  className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                >
                  Ακύρωση
                </button>
              </div>
              <form onSubmit={handleGenerate} className="mt-5 space-y-4">
                <input type="hidden" name="action" value="generateRoundRobinGames" />
                <input type="hidden" name="scheduleId" value={selectedSchedule.id} />
                <input type="hidden" name="id" value={selectedSchedule.id} />
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  <p className="font-black text-zinc-900">{String(selectedSchedule.phase_name ?? phase?.name ?? "—")}</p>
                  <p className="mt-1">Πρόχειρο πρόγραμμα · {structure.totalGames} προβλεπόμενοι αγώνες · {structure.rounds} αγωνιστικές</p>
                </div>
                <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                  <button type="button" onClick={closeGenerateModal} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700">
                    Ακύρωση
                  </button>
                  <button disabled={busy} className={buttonClass}>
                    Δημιουργία Αγώνων
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {showVenueManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-zinc-950">Γήπεδα διοργάνωσης</h3>
                <p className="mt-1 text-sm text-zinc-600">Διαχείριση γηπέδων για τη συγκεκριμένη διοργάνωση.</p>
              </div>
              <button type="button" onClick={closeVenueManager} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700">
                ← Επιστροφή
              </button>
            </div>

            {!competitionVenues.length ? (
              <div className="mt-5 space-y-4">
                <p className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                  Δεν έχουν προστεθεί γήπεδα για αυτή τη διοργάνωση.
                </p>
                <button type="button" onClick={() => startVenueForm("")} className={buttonClass}>
                  + Προσθήκη γηπέδου
                </button>
                {showVenueForm ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-zinc-900">Προσθήκη γηπέδου</p>
                        <p className="mt-1 text-sm text-zinc-600">Τα ιστορικά παιχνίδια διατηρούν το κείμενο γηπέδου που έχουν ήδη αποθηκεύσει.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVenueId("");
                          setShowVenueForm(false);
                        }}
                        className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                      >
                        Κλείσιμο
                      </button>
                    </div>
                    <form
                      className="mt-4 space-y-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const ok = selectedVenue
                          ? await updateEntity("competition-venues", String(selectedVenue.id), event, `Το γήπεδο «${String(selectedVenue.name ?? "—")}» ενημερώθηκε.`)
                          : await submit("competition-venues", event);
                        if (!ok) return;
                        setEditingVenueId("");
                        setShowVenueForm(false);
                      }}
                    >
                      <input type="hidden" name="competitionId" value={competitionId} />
                      <Field label="Όνομα γηπέδου">
                        <input name="name" required className={inputClass} />
                      </Field>
                      <Field label="Διεύθυνση">
                        <input name="address" className={inputClass} />
                      </Field>
                      <Field label="Σύνδεσμος χάρτη">
                        <input name="mapUrl" placeholder="https://..." className={inputClass} />
                      </Field>
                      <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingVenueId("");
                            setShowVenueForm(false);
                          }}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700"
                        >
                          Καθαρισμός
                        </button>
                        <button disabled={busy} className={buttonClass}>
                          Προσθήκη γηπέδου
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  {competitionVenues.map((venue) => (
                    <article key={String(venue.id)} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-zinc-950">{String(venue.name ?? "—")}</p>
                          {String(venue.address ?? "").trim() ? <p className="mt-1 text-sm text-zinc-600">{String(venue.address)}</p> : null}
                          {String(venue.map_url ?? "").trim() ? (
                            <a
                              href={String(venue.map_url)}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="mt-2 inline-flex text-sm font-black text-orange-700 underline decoration-orange-300 underline-offset-2"
                            >
                              Προβολή στον χάρτη
                            </a>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => startVenueForm(String(venue.id))}
                            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                          >
                            Επεξεργασία
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleVenueDelete(venue)}
                            className="rounded-xl border border-red-300 bg-white px-3 py-2 text-sm font-black text-red-700"
                          >
                            Αφαίρεση
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {showVenueForm ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-zinc-900">{selectedVenue ? "Επεξεργασία γηπέδου" : "Προσθήκη γηπέδου"}</p>
                        <p className="mt-1 text-sm text-zinc-600">Τα ιστορικά παιχνίδια διατηρούν το κείμενο γηπέδου που έχουν ήδη αποθηκεύσει.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVenueId("");
                          setShowVenueForm(false);
                        }}
                        className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                      >
                        Κλείσιμο
                      </button>
                    </div>
                    <form
                      className="mt-4 space-y-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const ok = editingVenueId
                          ? await updateEntity("competition-venues", editingVenueId, event, `Το γήπεδο «${String(selectedVenue?.name ?? "—")}» ενημερώθηκε.`)
                          : await submit("competition-venues", event);
                        if (!ok) return;
                        setEditingVenueId("");
                        setShowVenueForm(false);
                      }}
                    >
                      <input type="hidden" name="competitionId" value={competitionId} />
                      <Field label="Όνομα γηπέδου">
                        <input
                          name="name"
                          defaultValue={String(selectedVenue?.name ?? "")}
                          required
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Διεύθυνση">
                        <input
                          name="address"
                          defaultValue={String(selectedVenue?.address ?? "")}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Σύνδεσμος χάρτη">
                        <input
                          name="mapUrl"
                          defaultValue={String(selectedVenue?.map_url ?? "")}
                          placeholder="https://..."
                          className={inputClass}
                        />
                      </Field>
                      <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingVenueId("");
                            setShowVenueForm(false);
                          }}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700"
                        >
                          Καθαρισμός
                        </button>
                        <button disabled={busy} className={buttonClass}>
                          {selectedVenue ? "Αποθήκευση αλλαγών" : "Προσθήκη γηπέδου"}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
                    Επιλέξτε ένα γήπεδο για επεξεργασία ή πατήστε «+ Προσθήκη γηπέδου» για νέο.
                  </div>
                )}
              </div>
            )}

            {competitionVenues.length ? (
              <div className="mt-5 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                <p className="font-black text-zinc-900">Προσθήκη γηπέδου</p>
                <p className="mt-1">Το ίδιο γήπεδο μπορεί να χρησιμοποιηθεί αργότερα στο Πρόγραμμα & Αγώνες ως απλό κείμενο.</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
