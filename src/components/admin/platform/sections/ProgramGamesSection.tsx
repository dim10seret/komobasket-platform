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

export function ProgramGamesSection({
  data,
  competitionId,
  submit,
  deleteEntity,
  busy,
}: {
  data: Snapshot;
  competitionId: string;
  submit: (resource: string, event: FormEvent<HTMLFormElement>) => Promise<boolean>;
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

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPhaseId, setSelectedPhaseId] = useState("");
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

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await submit("phase-schedules", event);
    if (!ok) return;
    setShowCreateModal(false);
    setSelectedPhaseId("");
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
          <button type="button" onClick={openCreateModal} disabled={!competitionPhases.length} className={buttonClass}>
            + Δημιουργία Προγράμματος
          </button>
        </div>

        {!schedules.length ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
            Δεν έχει δημιουργηθεί πρόγραμμα για κάποια φάση.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {schedules.map((schedule) => {
              const phase = competitionPhases.find((entry) => String(entry.id) === String(schedule.phase_id ?? "")) ?? null;
              const summary = buildPhaseSummary(data, phase);
              const lifecycle = String(schedule.lifecycle_status ?? "draft");
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
                    {summary.map((line) => <p key={line}>{line}</p>)}
                    <p className="pt-1 text-xs font-black uppercase tracking-wide text-zinc-500">
                      {lifecycle === "published" ? "Δημοσιευμένο πρόγραμμα" : "Αναμονή δημιουργίας αγώνων"}
                    </p>
                  </div>
                  {lifecycle === "draft" && (
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
                  )}
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
    </Panel>
  );
}
