"use client";

import { usePlatformContext, PlatformButton, PlatformForm, PlatformFileInput } from "@/components/admin/platform/shared/platform-context";

import type { FormEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Field,
  Panel,
  Row,
  Snapshot,
  UpdateEntity,
  TeamRosterAthleteWithIndex,
  TeamRosterManagementView,
  TeamRosterViewRole,
  buttonClass,
  getCompetitionTeamsForStandings,
  inputClass,
  parseDateForDisplay,
  parseStandingsRules,
  phaseFormatLabel,
  phaseFormatOptions,
  SimpleTable,
  roundRobinStructureFromTeams,
  normalizeStandingsTieBreakers,
  staffRoleLabels,
  standingsTieBreakerLabel,
} from "../shared/admin-core";
import { calculateStandings } from "../../../../lib/standings-calculator";
import { PhaseParticipantsBuilder } from "../phases/PhaseParticipantsBuilder";

export function PhaseFields({
  data,
  phase,
  competitionId,
  editing,
  onExplicitSave,
  onContinueSeries,
  onCancel,
  initialName,
  initialFormat,
  lockedFormat,
  lockedSeriesSourcePhaseId,
  lockedSeriesRangeFrom,
  lockedSeriesRangeTo,
  isContinuationSeries,
}: {
  data: Snapshot;
  phase?: Row;
  competitionId?: string;
  editing?: boolean;
  onExplicitSave?: (event: MouseEvent<HTMLButtonElement>) => Promise<void> | void;
  onContinueSeries?: () => void;
  onCancel?: () => void;
  initialName?: string;
  initialFormat?: string;
  lockedFormat?: boolean;
  lockedSeriesSourcePhaseId?: string;
  lockedSeriesRangeFrom?: number;
  lockedSeriesRangeTo?: number;
  isContinuationSeries?: boolean;
}) {
  type StandingsPresentationCategory = "direct_qualification" | "play_out" | "eliminated";
  type StandingsPresentation = Record<StandingsPresentationCategory, number[]>;
  const emptyStandingsPresentation = (): StandingsPresentation => ({
    direct_qualification: [],
    play_out: [],
    eliminated: [],
  });
  const parseStandingsPresentation = (value: unknown): StandingsPresentation => {
    const next = emptyStandingsPresentation();
    try {
      const entries = JSON.parse(String(value ?? "[]"));
      if (!Array.isArray(entries)) return next;
      for (const entry of entries) {
        const category = String(entry?.category ?? "") as StandingsPresentationCategory;
        const position = Number(entry?.position);
        if (!(category in next) || !Number.isInteger(position) || position < 1) continue;
        if (!next[category].includes(position)) next[category].push(position);
      }
    } catch {
      return next;
    }
    return next;
  };
  const canonicalFormat = (value: string) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "knockout" ? "series" : normalized;
  };
  const [selectedFormat,setSelectedFormat]=useState(canonicalFormat(String(String(phase?.format ?? phase?.phase_kind ?? initialFormat ?? "standings"))));
  const [phaseNameInput, setPhaseNameInput] = useState(String(initialName ?? phase?.name ?? ""));
  const [isSaving, setIsSaving] = useState(false);
  const rules = parseStandingsRules(phase?.rule_settings_json);
  const [tieBreakers,setTieBreakers]=useState<string[]>(() => normalizeStandingsTieBreakers(rules.tieBreakers));
  const [standingsPresentation, setStandingsPresentation] = useState<StandingsPresentation>(() => parseStandingsPresentation(phase?.standings_presentation_json));
  const [activeStep,setActiveStep]=useState(1);
  const isC4Format = ["series"].includes(selectedFormat);
  const shouldUseStepper = Boolean(editing && isC4Format);
  const canGoPrevious = activeStep > 1;

  const selectedFormatLabel = phaseFormatOptions.find((format) => format.value === selectedFormat)?.label ?? selectedFormat;
  const phaseName = String(phase?.name ?? "Φάση");
  const phaseContextHeader = `${phaseNameInput || phaseName} · ${selectedFormatLabel}`;

  useEffect(() => {
    if (!shouldUseStepper) {
      setActiveStep(1);
      return;
    }
    if (activeStep < 1) setActiveStep(1);
    if (activeStep > 3) setActiveStep(3);
  }, [shouldUseStepper, activeStep]);

  const standingsTieBreakers = normalizeStandingsTieBreakers(["head_to_head","head_to_head_point_diff","overall_point_diff","points_for","alphabetical"]);
  const canMoveUp = (index:number) => index > 0 && tieBreakers[index] !== "alphabetical";
  const canMoveDown = (index:number) => (
    tieBreakers[index] !== "alphabetical" && index < tieBreakers.length - 2
  );
  const isEnabled = (key:string) => tieBreakers.includes(key);
  const moveTieBreaker = (index:number, direction:-1|1) => {
    const next = [...tieBreakers];
    const target = index + direction;
    if (target < 0 || target >= next.length - 1) return;
    if (next[index] === "alphabetical" || next[target] === "alphabetical") return;
    [next[index], next[target]] = [next[target], next[index]];
    setTieBreakers(next);
  };
  const toggleTieBreaker = (key:string) => {
    if (key === "alphabetical") return;
    const next = [...tieBreakers];
    const index = next.indexOf(key);
    if (index === -1) {
      const hasAlphabetical = next.includes("alphabetical");
      const insertIndex = hasAlphabetical ? next.length - 1 : next.length;
      next.splice(insertIndex, 0, key);
      setTieBreakers(next);
      return;
    }
    const filtered = next.filter((item) => item !== key);
    setTieBreakers([...filtered]);
  };
  useEffect(() => {
    const normalized = normalizeStandingsTieBreakers(rules.tieBreakers);
    setTieBreakers(normalized);
    if (selectedFormat !== "standings") setActiveStep((current) => Math.min(current, 1));
  }, [phase?.rule_settings_json, selectedFormat]);

  useEffect(() => {
    setPhaseNameInput(String(phase?.name ?? ""));
  }, [phase?.id, phase?.name]);

  useEffect(() => {
    setStandingsPresentation(parseStandingsPresentation(phase?.standings_presentation_json));
  }, [phase?.id, phase?.standings_presentation_json]);

  const standingsPositionCount = Math.max(
    0,
    Number(data.competitions.find((competition) => String(competition.id) === String(competitionId ?? phase?.competition_id ?? ""))?.expected_team_count ?? 0),
  );
  const toggleStandingsPresentationPosition = (category: StandingsPresentationCategory, position: number) => {
    setStandingsPresentation((current) => {
      const selected = current[category].includes(position);
      const next = emptyStandingsPresentation();
      for (const currentCategory of Object.keys(next) as StandingsPresentationCategory[]) {
        next[currentCategory] = current[currentCategory].filter((value) => value !== position);
      }
      next[category] = selected ? current[category].filter((value) => value !== position) : [...current[category], position].sort((left, right) => left - right);
      return next;
    });
  };
  const renderStandingsPresentation = () => {
    const categories: Array<{ key: StandingsPresentationCategory; label: string }> = [
      { key: "direct_qualification", label: "Απευθείας πρόκριση" },
      { key: "play_out", label: "Play Out" },
      { key: "eliminated", label: "Εκτός συνέχειας" },
    ];
    return <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
      <p className="text-sm font-black text-zinc-800">ΔΗΜΟΣΙΑ ΑΠΕΙΚΟΝΙΣΗ ΒΑΘΜΟΛΟΓΙΑΣ</p>
      <p className="mt-1 text-sm text-zinc-700">Οι επιλογές χρησιμοποιούνται μόνο για την παρουσίαση της βαθμολογίας στο site και δεν επηρεάζουν την εξέλιξη της διοργάνωσης.</p>
      {standingsPositionCount > 0 ? <div className="mt-3 space-y-3">
        {categories.map(({ key, label }) => <div key={key}>
          <p className="mb-1 text-sm font-black text-zinc-800">{label}</p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: standingsPositionCount }, (_, index) => index + 1).map((position) => {
              const assignedCategory = (Object.keys(standingsPresentation) as StandingsPresentationCategory[]).find((candidate) => standingsPresentation[candidate].includes(position));
              const checked = assignedCategory === key;
              return <label key={position} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm ${assignedCategory && !checked ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400" : "border-sky-200 bg-white text-zinc-800"}`}>
                <input type="checkbox" checked={checked} disabled={Boolean(assignedCategory && !checked)} onChange={() => toggleStandingsPresentationPosition(key, position)} />
                Θέση {position}
              </label>;
            })}
          </div>
        </div>)}
      </div> : <p className="mt-3 text-sm text-zinc-600">Οι διαθέσιμες θέσεις θα εμφανιστούν όταν είναι γνωστός ο αριθμός ομάδων της διοργάνωσης.</p>}
      <input type="hidden" name="standingsPresentation" value={JSON.stringify(standingsPresentation)} />
    </div>;
  };

  useEffect(() => {
    if (initialName !== undefined) {
      setPhaseNameInput(initialName);
    } else if (!phase) {
      setPhaseNameInput("");
    }
    const normalized = canonicalFormat(String(phase?.format ?? phase?.phase_kind ?? initialFormat ?? selectedFormat));
    setSelectedFormat(lockedFormat ? "series" : normalized);
  }, [initialFormat, initialName, lockedFormat, phase?.format, phase?.phase_kind]);

  const renderStepperHeader = () => {
    if (!shouldUseStepper) return null;
    const steps = ["1. Συμμετοχή", "2. Διασταυρώσεις", "3. Προεπισκόπηση"];
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
        <div className="flex flex-wrap gap-2">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const isActive = activeStep === stepNumber;
            return (
              <PlatformButton
                key={step}
                type="button"
                onClick={() => setActiveStep(stepNumber)}
                className={`rounded-lg px-3 py-2 text-xs font-black ${isActive ? "bg-orange-600 text-white" : "bg-white text-zinc-700"}`}
              >
                {step}
              </PlatformButton>
            );
          })}
        </div>
      </div>
    );
  };

  const renderStepContent = () => {
    if (!shouldUseStepper) return (
      <>
        <Field label="Ονομασία">
          <input
            required
            name="name"
            value={phaseNameInput}
            onChange={(event)=>setPhaseNameInput(event.target.value)}
            placeholder="Κανονική περίοδος / Final Four"
            className={inputClass}
          />
        </Field>
        <Field label="Μορφή Φάσης">
          {lockedFormat ? (
            <input type="text" readOnly value={phaseFormatOptions.find((format) => format.value === "series")?.label ?? "Σειρά αγώνων"} className={inputClass} />
          ) : (
            <select name="format" value={selectedFormat} onChange={(event)=>setSelectedFormat(event.target.value)} className={inputClass}>
              {phaseFormatOptions.map((format)=><option key={format.value} value={format.value}>{format.label}</option>)}
            </select>
          )}
          <input type="hidden" name="format" value={selectedFormat} />
        </Field>
        <input type="hidden" name="phaseEditStep" value="0" />
        <PhaseParticipantsBuilder
          data={data}
          phase={phase}
          competitionId={competitionId ?? String(phase?.competition_id ?? "")}
          selectedFormat={selectedFormat}
          lockedSeriesSourcePhaseId={lockedSeriesSourcePhaseId}
          lockedSeriesRangeFrom={lockedSeriesRangeFrom}
          lockedSeriesRangeTo={lockedSeriesRangeTo}
          seriesContinuationMode={Boolean(lockedSeriesSourcePhaseId) || Boolean(isContinuationSeries)}
          onContinueSeries={onContinueSeries}
        />
        {selectedFormat === "standings" && <>
          <div className="rounded-xl border border-zinc-200 p-3">
            <p className="mb-3 text-sm font-black text-zinc-800">ΣΥΣΤΗΜΑ ΒΑΘΜΟΛΟΓΙΑΣ</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Βαθμοί νίκης"><input type="number" min={0} step={1} required name="pointsForWin" defaultValue={rules.pointsForWin} className={inputClass}/></Field>
              <Field label="Βαθμοί ήττας"><input type="number" min={0} step={1} required name="pointsForLoss" defaultValue={rules.pointsForLoss} className={inputClass}/></Field>
            </div>
          </div>
          <Field label="Αγώνες ανά ζευγάρι"><input type="number" min={1} step={1} required name="gamesPerPairing" defaultValue={rules.gamesPerPairing} className={inputClass}/></Field>
          <div className="rounded-xl border border-zinc-200 p-3">
            <p className="mb-3 text-sm font-black text-zinc-800">Κριτήρια Κατάταξης</p>
            <p className="mb-2 text-sm text-zinc-700">Βασικό κριτήριο: <span className="font-black">Σύστημα βαθμολογίας 🔒</span></p>
            <div className="space-y-2">
              {standingsTieBreakers.map((key) => {
                if (key === "alphabetical") {
                  return <label key={key} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-sm">
                    <input type="checkbox" checked readOnly disabled className="h-4 w-4" />
                    <span>Αλφαβητικά (σταθερό fallback)</span>
                  </label>;
                }
                const checked = isEnabled(key);
                const index = tieBreakers.indexOf(key);
                return <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-2 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTieBreaker(key)}
                    />
                    <span>{standingsTieBreakerLabel[key] ?? key}</span>
                  </span>
                  <span className="inline-flex gap-1">
                    <PlatformButton
                      type="button"
                      disabled={!canMoveUp(index)}
                      onClick={() => moveTieBreaker(index, -1)}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-bold disabled:opacity-30"
                    >
                      ↑
                    </PlatformButton>
                    <PlatformButton
                      type="button"
                      disabled={!canMoveDown(index)}
                      onClick={() => moveTieBreaker(index, 1)}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-bold disabled:opacity-30"
                    >
                      ↓
                    </PlatformButton>
                  </span>
                </label>;
              })}
            </div>
            <input type="hidden" name="tieBreakers" value={JSON.stringify(tieBreakers)} />
          </div>
          {renderStandingsPresentation()}
        </>}
      </>
    );

  const showSave = activeStep === 3;
    const isStep1 = activeStep === 1;
    const isStep2 = activeStep === 2;
    const isStep3 = activeStep === 3;
    return (
      <div className="space-y-4">
        <input type="hidden" name="phaseEditStep" value={String(activeStep)} />
        {isStep1 ? (
          <>
            <Field label="Ονομασία">
              <input
                required
                name="name"
                value={phaseNameInput}
                onChange={(event)=>setPhaseNameInput(event.target.value)}
                placeholder="Κανονική περίοδος / Final Four"
                className={inputClass}
              />
            </Field>
            <Field label="Μορφή Φάσης">
              {lockedFormat ? (
                <input type="text" readOnly value={phaseFormatOptions.find((format) => format.value === "series")?.label ?? "Σειρά αγώνων"} className={inputClass} />
              ) : (
                <select name="format" value={selectedFormat} onChange={(event)=>setSelectedFormat(event.target.value)} className={inputClass}>
                  {phaseFormatOptions.map((format)=><option key={format.value} value={format.value}>{format.label}</option>)}
                </select>
              )}
              <input type="hidden" name="format" value={selectedFormat} />
            </Field>
          </>
        ) : (
          <>
            <input type="hidden" name="name" value={phaseNameInput} />
            <input type="hidden" name="format" value={selectedFormat} />
          </>
        )}
        {(isStep2 || isStep3) ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2">
            <p className="text-xs font-black uppercase tracking-[0.08em] text-zinc-600">PLAY OUT</p>
            <p className="mt-1 font-black text-zinc-900">{phaseContextHeader}</p>
          </div>
        ) : null}
        <PhaseParticipantsBuilder
          data={data}
          phase={phase}
          competitionId={competitionId ?? String(phase?.competition_id ?? "")}
          selectedFormat={selectedFormat}
          activeStep={activeStep}
          lockedSeriesSourcePhaseId={lockedSeriesSourcePhaseId}
          lockedSeriesRangeFrom={lockedSeriesRangeFrom}
          lockedSeriesRangeTo={lockedSeriesRangeTo}
          seriesContinuationMode={Boolean(lockedSeriesSourcePhaseId) || Boolean(isContinuationSeries)}
          onContinueSeries={onContinueSeries}
        />

        {selectedFormat === "standings" && (
          <div>
            <div className="rounded-xl border border-zinc-200 p-3">
              <p className="mb-3 text-sm font-black text-zinc-800">ΣΥΣΤΗΜΑ ΒΑΘΜΟΛΟΓΙΑΣ</p>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Βαθμοί νίκης"><input type="number" min={0} step={1} required name="pointsForWin" defaultValue={rules.pointsForWin} className={inputClass}/></Field>
                <Field label="Βαθμοί ήττας"><input type="number" min={0} step={1} required name="pointsForLoss" defaultValue={rules.pointsForLoss} className={inputClass}/></Field>
              </div>
            </div>
            <Field label="Αγώνες ανά ζευγάρι"><input type="number" min={1} step={1} required name="gamesPerPairing" defaultValue={rules.gamesPerPairing} className={inputClass}/></Field>
            <div className="rounded-xl border border-zinc-200 p-3">
              <p className="mb-3 text-sm font-black text-zinc-800">Κριτήρια Κατάταξης</p>
              <p className="mb-2 text-sm text-zinc-700">Βασικό κριτήριο: <span className="font-black">Βαθμοί 🔒</span></p>
              <div className="space-y-2">
                {standingsTieBreakers.map((key) => {
                  if (key === "alphabetical") {
                    return <label key={key} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-sm">
                      <input type="checkbox" checked readOnly disabled className="h-4 w-4" />
                      <span>Αλφαβητικά (σταθερό fallback)</span>
                    </label>;
                  }
                  const checked = isEnabled(key);
                  const index = tieBreakers.indexOf(key);
                  return <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-2 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTieBreaker(key)}
                      />
                      <span>{standingsTieBreakerLabel[key] ?? key}</span>
                    </span>
                    <span className="inline-flex gap-1">
                      <PlatformButton
                        type="button"
                        disabled={!canMoveUp(index)}
                        onClick={() => moveTieBreaker(index, -1)}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-bold disabled:opacity-30"
                      >
                        ↑
                      </PlatformButton>
                      <PlatformButton
                        type="button"
                        disabled={!canMoveDown(index)}
                        onClick={() => moveTieBreaker(index, 1)}
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-bold disabled:opacity-30"
                      >
                        ↓
                      </PlatformButton>
                    </span>
                  </label>;
                })}
              </div>
              <input type="hidden" name="tieBreakers" value={JSON.stringify(tieBreakers)} />
            </div>
            {renderStandingsPresentation()}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 pt-4">
          <PlatformButton type="button" className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black" onClick={() => onCancel?.()}>Ακύρωση</PlatformButton>
          {canGoPrevious && <PlatformButton type="button" className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black" onClick={() => setActiveStep((current) => Math.max(1, current - 1))}>Προηγούμενο</PlatformButton>}
          {showSave ? (
            <PlatformButton
              type="button"
              disabled={isSaving}
              className="rounded-xl border border-orange-600 bg-orange-600 px-4 py-2.5 font-black text-white transition duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={(event) => {
                if (onExplicitSave) {
                  setIsSaving(true);
                  void (async () => {
                    try {
                      await onExplicitSave(event);
                    } finally {
                      setIsSaving(false);
                    }
                  })();
                }
              }}
            >
              {isSaving ? "Αποθήκευση..." : "Αποθήκευση Φάσης"}
            </PlatformButton>
          ) : <PlatformButton type="button" className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black" onClick={() => setActiveStep((current) => Math.min(4, current + 1))}>Επόμενο</PlatformButton>}
        </div>
      </div>
    );
  };

  return <div className="space-y-4">
    {renderStepperHeader()}
    {renderStepContent()}
    {!shouldUseStepper && (
      <PlatformButton mutation type="submit" name="phaseSave" data-c4-save="1" className="rounded-xl border border-orange-600 bg-orange-600 px-4 py-2.5 font-black text-white disabled:opacity-60">Αποθήκευση Φάσης</PlatformButton>
    )}
  </div>;
}

export function StandingsPhasePreview({
  data,
  phase,
  openTeamRoster,
}: {
  data:Snapshot;
  phase:Row;
  openTeamRoster?: (teamId: string, competitionId: string, seasonId: string) => void;
}) {
  const competitionId = String(phase.competition_id ?? "");
  const competition = data.competitions.find((entry) => String(entry.id) === competitionId);
  const seasonId = String(competition?.season_id ?? "");
  const expectedTeamCount = Number(competition?.expected_team_count ?? 0);
  const teams = getCompetitionTeamsForStandings(data, competitionId);
  const actualTeamCount = teams.length;
  const rules = parseStandingsRules(phase.rule_settings_json);
  const standings = calculateStandings({
    phaseId: String(phase.id ?? ""),
    teams: teams.map((team) => ({
      id: String(team.team_id ?? ""),
      name: String(team.team_name ?? "—"),
    })),
    games: data.games.map((game) => ({
      id: String(game.id ?? ""),
      phaseId: String(game.phase_id ?? null),
      homeTeamId: String(game.home_team_id ?? ""),
      awayTeamId: String(game.away_team_id ?? ""),
      homeScore: (game.home_score ?? null) as number | string | null,
      awayScore: (game.away_score ?? null) as number | string | null,
      status: String(game.status ?? null),
      resultSource: String(game.result_source ?? null),
    })),
    rules: {
      pointsForWin: rules.pointsForWin,
      pointsForLoss: rules.pointsForLoss,
    },
    tieBreakers: normalizeStandingsTieBreakers(rules.tieBreakers) as Array<
      "head_to_head" | "head_to_head_point_diff" | "overall_point_diff" | "points_for" | "alphabetical"
    >,
  });
  const previewTeamCount = expectedTeamCount > 0 && actualTeamCount < expectedTeamCount
    ? expectedTeamCount
    : actualTeamCount;
  const structure = roundRobinStructureFromTeams(actualTeamCount, rules.gamesPerPairing);
  const standingsRows = standings.orderedRows.map((entry) => {
    const row = standings.rows.find((item) => item.teamId === entry.teamId);
    return {
      rank: entry.rank,
      teamId: entry.teamId,
      team: entry.teamName,
      gamesPlayed: row?.gamesPlayed ?? 0,
      standingsPoints: row?.standingsPoints ?? 0,
      wins: row?.wins ?? 0,
      losses: row?.losses ?? 0,
      pointsFor: row?.pointsFor ?? 0,
      pointsAgainst: row?.pointsAgainst ?? 0,
      pointDifference: row?.pointDifference ?? 0,
      placeholder: false,
      tieResolved: entry.tieResolved,
    };
  });
  const rowWidth = standingsRows.length ? standingsRows : Array.from({ length: previewTeamCount }, (_, index) => {
    const team = teams[index];
    return {
      rank: index + 1,
      teamId: team ? String(team.team_id ?? "") : "",
      team: team ? String(team.team_name ?? "—") : "—",
      gamesPlayed: 0,
      standingsPoints: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifference: 0,
      placeholder: !team,
      tieResolved: true,
    };
  });
  const isIncomplete = expectedTeamCount > 0 && actualTeamCount > 0 && actualTeamCount < expectedTeamCount;
  const previewHeader = expectedTeamCount ? `Δομή Προγράμματος` : "Δομή Προγράμματος";

  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-sm font-black text-zinc-700">{previewHeader}</p>
      <p className="mt-2 text-sm text-zinc-700">{`Ομάδες: ${actualTeamCount} / ${expectedTeamCount || actualTeamCount}`}</p>
      <div className="mt-2 grid gap-1 text-sm text-zinc-700 sm:grid-cols-2">
        <p>{`${structure.rounds} αγωνιστικές`}</p>
        <p>{`${structure.gamesPerRound} αγώνες ανά αγωνιστική`}</p>
        {structure.byesPerRound > 0 ? <p>{`${structure.byesPerRound} ρεπό ανά αγωνιστική`}</p> : null}
        <p>{`${structure.totalGames} συνολικοί αγώνες`}</p>
      </div>
      {isIncomplete && <p className="mt-2 text-xs text-amber-700">Η διοργάνωση έχει {actualTeamCount}/{expectedTeamCount} ομάδες. Η τελική δομή προγράμματος θα υπολογιστεί με τις πραγματικές συμμετοχές.</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500"><tr>
            <th className="px-2 py-2 text-left">#</th>
            <th className="px-2 py-2 text-left">Ομάδα</th>
            <th className="px-2 py-2 text-right">Αγώνες</th>
            <th className="px-2 py-2 text-right">Βαθμοί</th>
            <th className="px-2 py-2 text-right">Νίκες</th>
            <th className="px-2 py-2 text-right">Ήττες</th>
            <th className="px-2 py-2 text-right">Πόντοι Υπέρ</th>
            <th className="px-2 py-2 text-right">Πόντοι Κατά</th>
            <th className="px-2 py-2 text-right">Διαφορά</th>
          </tr></thead>
          <tbody>
            {rowWidth.map((row) => (
              <tr key={row.rank} className="border-b border-zinc-100 last:border-0">
                <td className="px-2 py-2 text-zinc-700">{row.rank}</td>
                <td className="px-2 py-2 text-zinc-700">
                  {row.placeholder || !openTeamRoster || !row.teamId ? row.team : (
                    <PlatformButton
                      type="button"
                      className="text-left font-black text-blue-700 underline decoration-blue-300 hover:text-blue-900"
                      onClick={() => openTeamRoster(row.teamId, competitionId, seasonId)}
                    >
                      {row.team}
                    </PlatformButton>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-zinc-700">{row.gamesPlayed}</td>
                <td className="px-2 py-2 text-right text-zinc-700">{row.standingsPoints}</td>
                <td className="px-2 py-2 text-right text-zinc-700">{row.wins}</td>
                <td className="px-2 py-2 text-right text-zinc-700">{row.losses}</td>
                <td className="px-2 py-2 text-right text-zinc-700">{row.pointsFor}</td>
                <td className="px-2 py-2 text-right text-zinc-700">{row.pointsAgainst}</td>
                <td className={`px-2 py-2 text-right font-black ${row.pointDifference > 0 ? "text-emerald-700" : row.pointDifference < 0 ? "text-red-600" : "text-zinc-700"}`}>{row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}</td>
              </tr>
            ))}
            {!rowWidth.length && <tr><td className="px-2 py-3 text-zinc-500" colSpan={9}>Δεν υπάρχουν ακόμα συμμετοχές.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Schedule({data,submit,updateEntity,busy}:{data:Snapshot;submit:(r:string,e:FormEvent<HTMLFormElement>)=>void;updateEntity:UpdateEntity;busy:boolean}) {
  const { request: fetch, url: platformUrl } = usePlatformContext();
  const [selectedCompetitionId,setSelectedCompetitionId]=useState("");
  const [editingPhaseId,setEditingPhaseId]=useState<string|null>(null);
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
  const [rosterActionBusy,setRosterActionBusy]=useState(false);
  const phaseEditFormRef = useRef<HTMLFormElement | null>(null);
  const rosterPlayers = useMemo(() => {
    return (teamRoster?.athletes ?? []).map((athlete,index)=>({ ...athlete, rowIndex:index + 1 }));
  }, [teamRoster?.athletes]);

  const clearBlobPreviewUrl = (previewUrl: string) => {
    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  };

  const parseShirtNumber = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Μη έγκυρος αριθμός φανέλας.");
    return parsed;
  };

  const showTeamRosterPopup = async (teamId:string, competitionId:string, seasonId:string) => {
    if (!teamId || !competitionId || !seasonId) return;
    setTeamRosterLoading(true);
    setTeamRosterError("");
    setTeamRosterNotice("");
    try {
      const request = await fetch(`/api/admin/league?view=team-roster&organizationId=${encodeURIComponent(data.organizationContext.organizationId)}&seasonId=${seasonId}&competitionId=${competitionId}&teamId=${teamId}`, { cache: "no-store" });
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
    clearBlobPreviewUrl(editingAthletePhotoPreview);
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
    clearBlobPreviewUrl(editingAthletePhotoPreview);
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
    clearBlobPreviewUrl(editingAthletePhotoPreview);
    setEditingAthletePhotoFileName(file.name);
    setEditingAthletePhotoPreview(URL.createObjectURL(file));
    setEditingAthleteUploadMessage("Φόρτωση εικόνας...");
    setEditingAthleteUploadBusy(true);
    void (async () => {
      const payload = new FormData();
      payload.append("logo", file);
      payload.append("teamId", "");
      payload.append("organizationId", data.organizationContext.organizationId);
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
    clearBlobPreviewUrl(editingAthletePhotoPreview);
    setEditingAthletePhotoPreview("");
    setEditingAthletePhotoFileName("");
    setEditingAthlete(null);
  };

  return <>
    <Panel title="Competition Format & φάσεις" description="Κάθε διοργάνωση μπορεί να έχει το δικό της format. Οι φάσεις και οι κανόνες τους μπορούν να αλλάξουν οποιαδήποτε στιγμή χωρίς να διαγράφεται το ιστορικό.">
      <PlatformForm onSubmit={(event)=>void submit("phases",event)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Διοργάνωση"><select required name="competitionId" value={selectedCompetitionId} onChange={(event)=>setSelectedCompetitionId(event.target.value)} className={inputClass}><option value="">Επιλογή</option>{data.competitions.map((competition)=><option key={String(competition.id)} value={String(competition.id)}>{competition.season_name} · {competition.name}</option>)}</select></Field>
        <PhaseFields data={data} competitionId={selectedCompetitionId}/>
        <PlatformButton mutation disabled={busy} className={`${buttonClass} sm:col-span-2 xl:col-span-4 xl:justify-self-start`}>Προσθήκη φάσης</PlatformButton>
      </PlatformForm>
          <div className="mt-7 grid gap-4 xl:grid-cols-2">
        {data.phases.map((phase)=>{
          const id=String(phase.id);
          const isEditing=editingPhaseId===id;
          const phaseFormat = String(phase.format ?? phase.phase_kind ?? "standings");
          const lifecycleStatus = String((phase as { lifecycle_status?: string }).lifecycle_status ?? "active");
          const isFinalized = lifecycleStatus === "finalized";
          const handleEditFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
            const payload = new FormData(event.currentTarget);
            const activeStep = String(payload.get("phaseEditStep") || "0");
            if (activeStep === "0") {
              return updateEntity("phases", id, event, "Οι αλλαγές στη φάση και στους κανόνες της αποθηκεύτηκαν.");
            }
            event.preventDefault();
            return Promise.resolve(false);
          };
          const handlePhaseSave = async (event: MouseEvent<HTMLButtonElement>) => {
            const form = event.currentTarget.form || phaseEditFormRef.current;
            if (!form) return;
            const syntheticEvent = ({
              preventDefault: () => {},
              currentTarget: form,
            } as unknown) as FormEvent<HTMLFormElement>;
            if (await updateEntity("phases", id, syntheticEvent, "Οι αλλαγές στη φάση και στους κανόνες της αποθηκεύτηκαν.")) {
              setEditingPhaseId(null);
            }
          };
          return <article key={id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-black uppercase tracking-wider text-orange-600">{phase.season_name} · {phase.competition_name}</p>
                  <span className={isFinalized ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-700" : "inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-700"}>
                    {isFinalized ? "Οριστικοποιημένη" : "Σε εξέλιξη"}
                  </span>
                </div>
                <h3 className="mt-1 text-lg font-black text-zinc-950">{phase.name}</h3>
                <p className="mt-2 text-sm text-zinc-600">{phaseFormatLabel(phaseFormat)} · σειρά {phase.order_index ?? 0}</p>
              </div>
              <PlatformButton mutation type="button" onClick={()=>setEditingPhaseId(isEditing?null:id)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500">{isEditing?"Αρχικό μενού Φάσεων":"Edit"}</PlatformButton>
            </div>
            {!isEditing && phaseFormat === "standings" && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm">
                <span className={isFinalized ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-700" : "inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-amber-700"}>
                  {isFinalized ? "Οριστικοποιημένη" : "Σε εξέλιξη"}
                </span>
                {!isFinalized && (
                  <PlatformForm onSubmit={(event) => void updateEntity("phases", id, event, "Η φάση οριστικοποιήθηκε.")}>
                    <input type="hidden" name="action" value="finalizePhase" />
                    <input type="hidden" name="phaseId" value={id} />
                    <input type="hidden" name="competitionId" value={String(phase.competition_id)} />
                    <PlatformButton mutation type="submit" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-black text-amber-800 transition hover:bg-amber-100">Οριστικοποίηση φάσης</PlatformButton>
                  </PlatformForm>
                )}
              </div>
            )}
            {!isEditing && phaseFormat === "standings" && !isFinalized && (
              <PlatformForm onSubmit={(event) => void updateEntity("phases", id, event, "Η φάση οριστικοποιήθηκε.")} className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <input type="hidden" name="action" value="finalizePhase" />
                <input type="hidden" name="phaseId" value={id} />
                <input type="hidden" name="competitionId" value={String(phase.competition_id)} />
                <p className="text-sm font-semibold text-amber-900">Η οριστικοποίηση της φάσης επιτρέπει στην τελική κατάταξη να χρησιμοποιηθεί από επόμενες φάσεις.</p>
                <PlatformButton mutation type="submit" className="mt-3 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-amber-700">Οριστικοποίηση φάσης</PlatformButton>
              </PlatformForm>
            )}
            {!isEditing && phaseFormat === "standings" && <StandingsPhasePreview data={data} phase={phase} openTeamRoster={showTeamRosterPopup} />}
            {isEditing && <PlatformForm
              ref={phaseEditFormRef}
              onSubmit={(event)=>void handleEditFormSubmit(event)}
              className="mt-5 w-full space-y-4 border-t border-zinc-200 pt-5"
            >
              <input type="hidden" name="competitionId" value={String(phase.competition_id)}/>
              <PhaseFields
                data={data}
                phase={phase}
                competitionId={String(phase.competition_id)}
                editing
                onExplicitSave={handlePhaseSave}
                onCancel={() => setEditingPhaseId(null)}
              />
            </PlatformForm>}
          </article>;
        })}
        {!data.phases.length && <p className="text-sm text-zinc-500">Δεν έχουν δημιουργηθεί ακόμη φάσεις.</p>}
      </div>
    </Panel>
    <Panel title="Νέος αγώνας"><PlatformForm onSubmit={(e)=>void submit("games",e)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Διοργάνωση"><select required name="competitionId" className={inputClass}><option value="">Επιλογή</option>{data.competitions.map(c=><option key={String(c.id)} value={String(c.id)}>{c.season_name} · {c.name}</option>)}</select></Field><Field label="Φάση"><select name="phaseId" className={inputClass}><option value="">Χωρίς φάση</option>{data.phases.map(p=><option key={String(p.id)} value={String(p.id)}>{p.competition_name} · {p.name}</option>)}</select></Field><Field label="Γύρος / αγωνιστική"><input name="roundLabel" className={inputClass}/></Field><Field label="Ημερομηνία & ώρα"><input name="scheduledAt" type="datetime-local" className={inputClass}/></Field><Field label="Γηπεδούχος"><select required name="homeTeamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Φιλοξενούμενος"><select required name="awayTeamId" className={inputClass}><option value="">Επιλογή</option>{data.teams.map(t=><option key={String(t.id)} value={String(t.id)}>{t.name}</option>)}</select></Field><Field label="Γήπεδο"><input name="venue" className={inputClass}/></Field><PlatformButton mutation disabled={busy} className={`${buttonClass} self-end`}>Προσθήκη αγώνα</PlatformButton></PlatformForm></Panel>
    <Panel title="Αγώνες"><SimpleTable rows={data.games} columns={[["scheduled_at","Ημερομηνία"],["phase_name","Φάση"],["round_label","Γύρος"],["home_team_name","Γηπεδούχος"],["away_team_name","Φιλοξενούμενος"],["status","Κατάσταση"]]}/></Panel>

    {teamRosterLoading && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center text-zinc-700">Φόρτωση ρόστερ…</div>
      </div>
    )}

    {teamRosterError && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-xl rounded-2xl bg-white p-4">
          <div className="text-sm font-black text-red-700">{teamRosterError}</div>
          <PlatformButton type="button" onClick={closeTeamRosterPopup} className="mt-4 rounded-xl border border-zinc-300 px-4 py-2.5 font-black">Κλείσιμο</PlatformButton>
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
              <PlatformButton type="button" className={`${buttonClass} text-sm`}>Επεξεργασία Ρόστερ</PlatformButton>
              <PlatformButton type="button" onClick={closeTeamRosterPopup} className="rounded-xl border border-zinc-300 px-3 py-2.5 font-black">Κλείσιμο</PlatformButton>
            </div>
          </div>
          {teamRosterNotice ? <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{teamRosterNotice}</p> : null}

          <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <h4 className="font-black text-zinc-800">Αθλητές</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Φωτογραφία</th>
                    <th className="px-3 py-2">Όνομα</th>
                    <th className="px-3 py-2">Επώνυμο</th>
                    <th className="px-3 py-2">Ημ. Γέννησης</th>
                    <th className="px-3 py-2">Νο. Φανέλας</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterPlayers.map((athlete) => (
                    <tr key={athlete.roster_id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-2">{athlete.rowIndex}</td>
                      <td className="px-3 py-2">
                        {athlete.photo_url
                          ? <img src={athlete.photo_url} alt={`${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`} className="h-8 w-8 rounded-full object-cover" />
                          : <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500">—</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        <PlatformButton
                          type="button"
                          className="text-blue-700 underline decoration-blue-300 hover:text-blue-900"
                          onClick={() => openAthleteEdit(athlete)}
                          disabled={rosterActionBusy}
                        >
                          {athlete.first_name || athlete.display_name || "—"}
                        </PlatformButton>
                      </td>
                      <td className="px-3 py-2">
                        <PlatformButton
                          type="button"
                          className="text-blue-700 underline decoration-blue-300 hover:text-blue-900"
                          onClick={() => openAthleteEdit(athlete)}
                          disabled={rosterActionBusy}
                        >
                          {athlete.last_name || athlete.display_name || "—"}
                        </PlatformButton>
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
                  <tr>
                    <th className="px-3 py-2">Φωτογραφία</th>
                    <th className="px-3 py-2">Όνομα</th>
                    <th className="px-3 py-2">Επώνυμο</th>
                    <th className="px-3 py-2">Ρόλος</th>
                  </tr>
                </thead>
                <tbody>
                  {teamRoster.staff.map((member) => {
                    const firstName = member.first_name?.trim() ? member.first_name : member.display_name;
                    const lastName = member.last_name?.trim() ? member.last_name : member.display_name;
                    return (
                      <tr key={member.membership_id} className="border-b border-zinc-100 last:border-0">
                        <td className="px-3 py-2">
                          {member.photo_url
                            ? <img src={member.photo_url} alt={firstName ?? ""} className="h-8 w-8 rounded-full object-cover" />
                            : <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500">—</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-zinc-700">{firstName || "—"}</td>
                        <td className="px-3 py-2 text-zinc-700">{lastName || "—"}</td>
                        <td className="px-3 py-2 text-zinc-700">
                          {member.role === "other" ? (member.custom_role_label || staffRoleLabels.other) : staffRoleLabels[member.role as TeamRosterViewRole] || member.role}
                        </td>
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
              <Field label="Όνομα">
                <input value={editingAthleteFirstName} onChange={(event)=>setEditingAthleteFirstName(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Επώνυμο">
                <input value={editingAthleteLastName} onChange={(event)=>setEditingAthleteLastName(event.target.value)} className={inputClass} />
              </Field>
            </div>
            <Field label="Ημερομηνία γέννησης">
              <input type="date" value={editingAthleteBirthDate} onChange={(event)=>setEditingAthleteBirthDate(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Νο. Φανέλας">
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
                  <PlatformFileInput
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      handleAthletePhotoSelect(file);
                    }}
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{editingAthleteUploadBusy ? "Φόρτωση εικόνας..." : (editingAthletePhotoFileName ? `Επιλεγμένο αρχείο: ${editingAthletePhotoFileName}` : editingAthleteUploadMessage || "Επίλεξε φωτογραφία από τον υπολογιστή.")}</p>
            </Field>
            <div className="mt-1 flex gap-2">
              <PlatformButton mutation type="button" className={buttonClass} onClick={() => void saveAthleteEditsFromRoster()} disabled={rosterActionBusy}>
                Αποθήκευση
              </PlatformButton>
              <PlatformButton mutation
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
              </PlatformButton>
            </div>
          </div>
        </div>
      </div>
    )}

  </>;
}
