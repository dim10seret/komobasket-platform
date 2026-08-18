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

export function ProgramGamesSection({
  data,
  competitionId,
  submit,
  deleteEntity,
  updateEntity,
  busy,
}: {
  data: Snapshot;
  competitionId: string;
  submit: (resource: string, event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  updateEntity: (resource: string, id: string, event: FormEvent<HTMLFormElement>, successMessage: string) => Promise<boolean>;
  deleteEntity: DeleteEntity;
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
          <div className="grid gap-4 xl:grid-cols-2">
            {schedules.map((schedule) => {
              const phase = competitionPhases.find((entry) => String(entry.id) === String(schedule.phase_id ?? "")) ?? null;
              const phaseRules = parseStandingsRules(phase?.rule_settings_json);
              const structure = roundRobinStructureFromTeams(competitionTeams.length, phaseRules.gamesPerPairing);
              const scheduleGames = (data.games as GeneratedGameRow[]).filter((game) => String(game.schedule_id ?? "") === String(schedule.id));
              const completedGames = scheduleGames.filter((game) => String(game.status ?? "") === "completed").length;
              const generatedRounds = buildGeneratedRounds(scheduleGames, competitionTeams);
              const lifecycle = String(schedule.lifecycle_status ?? "draft");
              const hasGames = scheduleGames.length > 0;
              const activeRoundNumber = selectedRoundByScheduleId[String(schedule.id)] ?? generatedRounds[0]?.roundNumber ?? 0;
              const activeRound = generatedRounds.find((round) => round.roundNumber === activeRoundNumber) ?? generatedRounds[0] ?? null;
              const canGenerate = lifecycle === "draft" && !hasGames && String(phase?.format ?? phase?.phase_kind ?? "").toLowerCase() === "standings" && competitionTeams.length >= 2;
              const totalGames = hasGames ? scheduleGames.length : structure.totalGames;
              const statusLine = hasGames
                ? `${totalGames} αγώνες • ${generatedRounds.length} αγωνιστικές • ${completedGames}/${totalGames} ολοκληρωμένοι`
                : `${structure.totalGames} προβλεπόμενοι αγώνες • ${structure.rounds} αγωνιστικές`;
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
                          <p className="text-sm font-black text-zinc-900">Αγωνιστικές</p>
                          <select
                            className={inputClass}
                            value={String(activeRoundNumber || "")}
                            onChange={(event) => setSelectedRoundByScheduleId((current) => ({
                              ...current,
                              [String(schedule.id)]: Number(event.target.value),
                            }))}
                          >
                            {generatedRounds.map((round) => (
                              <option key={round.roundNumber} value={round.roundNumber}>
                                {round.roundLabel}
                              </option>
                            ))}
                          </select>
                        </div>
                        {activeRound ? (
                          <div className="mt-4 space-y-2">
                            {activeRound.games.map((game) => (
                              <div key={String(game.id)} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800">
                                <p className="font-black text-zinc-900">
                                  {String(game.home_team_name ?? "—")} — {String(game.away_team_name ?? "—")}
                                </p>
                                <p className="mt-1 text-xs font-black uppercase tracking-wide text-zinc-500">
                                  {String(game.round_label ?? activeRound.roundLabel)} · αγώνας {String(game.game_order ?? "—")}
                                </p>
                              </div>
                            ))}
                            {activeRound.byeTeam ? (
                              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                                Ρεπό: <span className="font-black text-zinc-900">{activeRound.byeTeam.name}</span>
                              </div>
                            ) : null}
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
