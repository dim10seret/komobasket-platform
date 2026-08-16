"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Field,
  Row,
  Snapshot,
  getCompetitionTeamsForStandings,
  inputClass,
} from "../shared/admin-core";

type ParticipantSourceType =
  | "competition_participants"
  | "standing_positions"
  | "matchup_winners"
  | "matchup_losers"
  | "selected_teams"
  | "manual";

type BracketMethod = "seeded_high_low" | "random" | "manual" | "custom";
type SlotSourceType = "standing_position" | "matchup_winner" | "matchup_loser" | "fixed_team" | "manual";
type ParticipantSourceOption = {
  value: ParticipantSourceType;
  label: string;
};
type SlotBuilderSource = {
  id: string;
  type: SlotSourceType;
  position: string;
  teamId: string;
  matchupId: string;
};
type BracketBuilderMatchup = {
  id: string;
  slotA: SlotBuilderSource;
  slotB: SlotBuilderSource;
};
type ParsedPhaseConfig = {
  participantConfiguration: {
    participantSourceType?: ParticipantSourceType | string;
    participantSourcePhaseId?: string | null;
    standingFrom?: number | null;
    standingTo?: number | null;
    selectedTeamIds?: string[];
    sourceMatchupIds?: string[];
    manualSlotCount?: number | null;
  };
  bracketConfiguration?: {
    method?: BracketMethod | string;
    matchups?: unknown[];
  };
};

const participantSourceOptions: ParticipantSourceOption[] = [
  { value: "competition_participants", label: "Όλες οι ομάδες της διοργάνωσης" },
  { value: "standing_positions", label: "Θέσεις από προηγούμενη standings phase" },
  { value: "matchup_winners", label: "Νικητές από προηγούμενα matchups" },
  { value: "matchup_losers", label: "Ηττημένοι από προηγούμενα matchups" },
  { value: "selected_teams", label: "Επιλεγμένες ομάδες" },
  { value: "manual", label: "Manual / Custom" },
];

const participantSourceDescriptions: Record<ParticipantSourceType, string> = {
  competition_participants: "Όλες οι ομάδες που έχουν εγγραφεί στην τρέχουσα διοργάνωση.",
  standing_positions: "Επιλέγεις θέσεις από την προηγούμενη standings φάση.",
  matchup_winners: "Παίρνεις νικητές από προϋπάρχοντα matchups.",
  matchup_losers: "Παίρνεις ηττημένους από προϋπάρχοντα matchups.",
  selected_teams: "Επιλέγεις χειροκίνητα ομάδες από το ρεπερτόριο της διοργάνωσης.",
  manual: "Ορίζεις χειροκίνητα slots χωρίς αυτόματη ανάγνωση team list.",
};

const bracketMethodOptions: { value: BracketMethod; label: string }[] = [
  { value: "seeded_high_low", label: "Βάσει κατάταξης" },
  { value: "random", label: "Τυχαία" },
  { value: "manual", label: "Χειροκίνητη" },
  { value: "custom", label: "Custom" },
];

const bracketMethodDescriptions: Record<BracketMethod, string> = {
  seeded_high_low: "Seeding (1-vs-last, 2-vs-prev-last).",
  random: "Τυχαίο ζευγάρωμα πριν την έναρξη.",
  manual: "Ορίζεις εσύ όλα τα ζεύγη.",
  custom: "Χειροκίνητος συνδυασμός με επιπλέον ρυθμίσεις.",
};

const bracketSlotSourceOptions: { value: SlotSourceType; label: string }[] = [
  { value: "standing_position", label: "Θέση κατάταξης" },
  { value: "matchup_winner", label: "Νικητής matchup" },
  { value: "matchup_loser", label: "Ηττημένος matchup" },
  { value: "fixed_team", label: "Συγκεκριμένη ομάδα" },
  { value: "manual", label: "Unresolved / Βασικός slot" },
];

const getObjectInput = (value: unknown) => {
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

const parsePhaseConfig = (phase: Row | undefined): ParsedPhaseConfig => {
  const raw = getObjectInput(phase?.rule_settings_json);
  return {
    participantConfiguration: getObjectInput(raw.participantConfiguration) as ParsedPhaseConfig["participantConfiguration"],
    bracketConfiguration: getObjectInput(raw.bracketConfiguration) as ParsedPhaseConfig["bracketConfiguration"],
  };
};

const asInt = (value: unknown, fallback: number) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.max(0, Math.floor(normalized)) : fallback;
};

const parseSlotArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const slotA = row.slotA as Record<string, unknown> | undefined;
      const slotB = row.slotB as Record<string, unknown> | undefined;
      if (!slotA || !slotB) return null;
      return {
        id: String(row.id || `matchup-${index}`),
        slotA: {
          id: String((slotA as Record<string, unknown>).id || `slot-${index}-a`),
          type: String(slotA.type || "manual") as SlotSourceType,
          position: String(slotA.position || ""),
          teamId: String(slotA.teamId || ""),
          matchupId: String(slotA.matchupId || ""),
        },
        slotB: {
          id: String((slotB as Record<string, unknown>).id || `slot-${index}-b`),
          type: String(slotB.type || "manual") as SlotSourceType,
          position: String(slotB.position || ""),
          teamId: String(slotB.teamId || ""),
          matchupId: String(slotB.matchupId || ""),
        },
      };
    })
    .filter(Boolean) as BracketBuilderMatchup[];
};

const normalizeParticipantSourceType = (value: string | undefined): ParticipantSourceType => {
  const normalized = String(value || "competition_participants").trim().toLowerCase();
  return (participantSourceOptions.find((option) => option.value === normalized)?.value) || "competition_participants";
};

const normalizeBracketMethod = (value: string | undefined): BracketMethod => {
  const normalized = String(value || "seeded_high_low").trim().toLowerCase();
  return (bracketMethodOptions.find((option) => option.value === normalized)?.value) || "seeded_high_low";
};

const generateSeededHighLowPairs = (from: number, to: number) => {
  const baseFrom = Math.max(1, from);
  const baseTo = Math.max(baseFrom, to);
  const count = baseTo - baseFrom + 1;
  if (count % 2 === 1) return [];
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < count / 2; index++) {
    pairs.push([baseFrom + index, baseTo - index]);
  }
  return pairs;
};

const getSlotPreviewValue = (slot: SlotBuilderSource) => {
  if (slot.type === "standing_position") return `#${slot.position || ""}`;
  if (slot.type === "fixed_team") return slot.teamId || "—";
  if (slot.type === "matchup_winner" || slot.type === "matchup_loser") return slot.matchupId || "—";
  return "—";
};

export function PhaseParticipantsBuilder({
  data,
  phase,
  competitionId,
  selectedFormat,
  activeStep,
}: {
  data: Snapshot;
  phase?: Row;
  competitionId: string;
  selectedFormat: string;
  activeStep?: number;
}) {
  const parsedConfig = useMemo(() => parsePhaseConfig(phase), [phase]);
  const config = parsedConfig.participantConfiguration;
  const bracketConfig = parsedConfig.bracketConfiguration;
  const currentPhaseOrder = Number(phase?.phase_order ?? phase?.order_index ?? 0);
  const phaseCompetitionId = String(phase?.competition_id ?? competitionId ?? "").trim();
  const phaseList = useMemo(() => {
    return data.phases
      .filter((entry) => String(entry.competition_id ?? "") === phaseCompetitionId)
      .sort((left, right) => {
        const leftOrder = Number(left.phase_order ?? left.order_index ?? 0);
        const rightOrder = Number(right.phase_order ?? right.order_index ?? 0);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.id).localeCompare(String(right.id));
      })
      .filter((entry) => String(entry.id ?? "") !== String(phase?.id ?? ""));
  }, [data.phases, phaseCompetitionId, phase?.id]);
  const competitionTeams = useMemo(() => getCompetitionTeamsForStandings(data, phaseCompetitionId), [data.participations, phaseCompetitionId]);

  const [participantSourceType, setParticipantSourceType] = useState<ParticipantSourceType>(
    normalizeParticipantSourceType(String(config?.participantSourceType || "competition_participants")),
  );
  const [participantSourcePhaseId, setParticipantSourcePhaseId] = useState(String(config?.participantSourcePhaseId || ""));
  const [standingFrom, setStandingFrom] = useState(asInt(config?.standingFrom, 1));
  const [standingTo, setStandingTo] = useState(asInt(config?.standingTo, 1));
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(config?.selectedTeamIds ?? []);
  const [sourceMatchupIds, setSourceMatchupIds] = useState<string[]>(config?.sourceMatchupIds ?? []);
  const [manualSlotCount, setManualSlotCount] = useState(asInt(config?.manualSlotCount, 0));
  const [bracketMethod, setBracketMethod] = useState<BracketMethod>(normalizeBracketMethod(String(bracketConfig?.method)));
  const [matchups, setMatchups] = useState<BracketBuilderMatchup[]>(() => parseSlotArray(bracketConfig?.matchups));
  const [carryOverEnabled, setCarryOverEnabled] = useState(Boolean(phase?.format === "series" ? Number(phase?.carry_over_enabled ?? 0) === 1 : false));
  const [carryOverSourcePhaseId, setCarryOverSourcePhaseId] = useState(String(phase?.carry_over_source_phase_id ?? ""));
  const [winsRequired, setWinsRequired] = useState(String(asInt(phase?.wins_required ?? 2, 2)));

  useEffect(() => {
    const next = parsePhaseConfig(phase);
    const cfg = next.participantConfiguration;
    const bracketCfg = next.bracketConfiguration;
    setParticipantSourceType(normalizeParticipantSourceType(String(cfg?.participantSourceType || "competition_participants")));
    setParticipantSourcePhaseId(String(cfg?.participantSourcePhaseId || ""));
    setStandingFrom(asInt(cfg?.standingFrom, 1));
    setStandingTo(asInt(cfg?.standingTo, 1));
    setSelectedTeamIds(cfg?.selectedTeamIds ?? []);
    setSourceMatchupIds(cfg?.sourceMatchupIds ?? []);
    setManualSlotCount(asInt(cfg?.manualSlotCount, 0));
    setBracketMethod(normalizeBracketMethod(String(bracketCfg?.method)));
    setMatchups(parseSlotArray(bracketCfg?.matchups));
    setWinsRequired(String(asInt(phase?.wins_required ?? 2, 2)));
    setCarryOverEnabled(Boolean(phase?.format === "series" ? Number(phase?.carry_over_enabled ?? 0) === 1 : false));
    setCarryOverSourcePhaseId(String(phase?.carry_over_source_phase_id ?? ""));
  }, [phase]);

  const estimatedParticipantCount = useMemo(() => {
    if (participantSourceType === "competition_participants") return competitionTeams.length;
    if (participantSourceType === "selected_teams") return selectedTeamIds.length;
    if (participantSourceType === "standing_positions") return Math.max(0, standingTo - standingFrom + 1);
    if (participantSourceType === "manual") return manualSlotCount;
    return sourceMatchupIds.length;
  }, [competitionTeams.length, manualSlotCount, participantSourceType, selectedTeamIds.length, standingFrom, standingTo, sourceMatchupIds.length]);

  const bracketPairs = useMemo(() => {
    if (bracketMethod !== "seeded_high_low") return [] as Array<[number, number]>;
    return generateSeededHighLowPairs(standingFrom, standingTo);
  }, [bracketMethod, standingFrom, standingTo]);
  const isOddSeries = String(selectedFormat) === "series" && estimatedParticipantCount > 1 && estimatedParticipantCount % 2 === 1;

  const isSeriesMode = String(selectedFormat) === "series";
  const isMatchupMode = String(selectedFormat) === "series" || String(selectedFormat) === "custom";
  const sourceDescription = participantSourceDescriptions[participantSourceType];

  const toggleTeam = (teamId: string, checked: boolean) => {
    setSelectedTeamIds((previous) => {
      const next = [...previous];
      if (checked) {
        if (!next.includes(teamId)) next.push(teamId);
      } else {
        const index = next.indexOf(teamId);
        if (index >= 0) next.splice(index, 1);
      }
      return next;
    });
  };

  const changeSlotField = (
    matchupId: string,
    slot: "slotA" | "slotB",
    field: keyof SlotBuilderSource,
    value: string,
  ) => {
    setMatchups((current) => current.map((entry) => {
      if (entry.id !== matchupId) return entry;
      const next = { ...entry };
      const nextSlot: SlotBuilderSource = { ...next[slot], [field]: value } as SlotBuilderSource;
      if (field === "type") {
        if (value !== "standing_position") {
          nextSlot.position = "";
        }
        if (value !== "fixed_team") {
          nextSlot.teamId = "";
        }
        if (value !== "matchup_winner" && value !== "matchup_loser") {
          nextSlot.matchupId = "";
        }
      }
      next[slot] = nextSlot;
      return next;
    }));
  };

  const addMatchup = () => {
    const nextIndex = matchups.length + 1;
    setMatchups((current) => [...current, {
      id: `matchup-${Date.now()}-${nextIndex}`,
      slotA: { id: `slot-a-${nextIndex}`, type: "manual", position: "", teamId: "", matchupId: "" },
      slotB: { id: `slot-b-${nextIndex}`, type: "manual", position: "", teamId: "", matchupId: "" },
    }]);
  };

  const removeMatchup = (matchupId: string) => {
    setMatchups((current) => current.filter((entry) => entry.id !== matchupId));
  };

  const teamRowCount = useMemo(() => Math.max(0, estimatedParticipantCount), [estimatedParticipantCount]);

  useEffect(() => {
    if (standingFrom > standingTo) setStandingTo(standingFrom);
  }, [standingFrom, standingTo]);

  const isStepMode = activeStep !== undefined;

  const renderParticipantSourceInputs = () => (
    <>
      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">ΠΗΓΗ ΟΜΑΔΩΝ</p>
        <p className="mt-2 text-sm text-zinc-600">Από πού θα προέλθουν οι ομάδες που θα συμμετάσχουν στη φάση.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {participantSourceOptions.map((option) => {
            const isChecked = participantSourceType === option.value;
            return (
              <label
                key={option.value}
                className={`cursor-pointer rounded-xl border p-3 transition ${isChecked ? "border-orange-500 bg-orange-50" : "border-zinc-200 bg-white hover:border-zinc-300"}`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="participantSourceType"
                    value={option.value}
                    checked={isChecked}
                    onChange={(event) => setParticipantSourceType(normalizeParticipantSourceType(event.target.value))}
                    className="mt-1 h-4 w-4 accent-orange-600"
                  />
                  <div>
                    <p className="text-sm font-black text-zinc-900">{option.label}</p>
                    <p className="mt-1 text-xs text-zinc-500">{participantSourceDescriptions[option.value]}</p>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">ΣΥΜΜΕΤΟΧΗ ΣΤΗ ΦΑΣΗ</p>
        <p className="text-sm text-zinc-600">Καθορίστε ποιες ομάδες/θέσεις συμμετέχουν.</p>

        <div className="space-y-2">
          <p className="text-xs font-black text-zinc-700">Ενεργή πηγή</p>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800">{participantSourceOptions.find((option) => option.value === participantSourceType)?.label}</div>
          <p className="text-xs text-zinc-500">{sourceDescription}</p>
        </div>

        <Field label="Διαθεσιμότητα">
          <input readOnly value={`${teamRowCount} διαθέσιμες ομάδες`} className={inputClass} />
        </Field>

        {participantSourceType === "standing_positions" && (
          <div className="space-y-3">
            <Field label="Φάση προέλευσης">
              <select
                name="participantSourcePhaseId"
                value={participantSourcePhaseId}
                onChange={(event) => setParticipantSourcePhaseId(event.target.value)}
                className={inputClass}
              >
                <option value="">Επιλογή φάσης</option>
                {phaseList.filter((entry) => String(entry.format ?? "") === "standings").map((entry) => {
                  const id = String(entry.id);
                  const order = Number(entry.phase_order ?? entry.order_index ?? 0);
                  return <option key={id} value={id}>{`${order}. ${entry.name}`}</option>;
                })}
              </select>
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Από θέση"><input type="number" min={1} name="standingFrom" value={standingFrom} onChange={(event) => setStandingFrom(asInt(event.target.value, 1))} className={inputClass} /></Field>
              <Field label="Έως θέση"><input type="number" min={1} name="standingTo" value={standingTo} onChange={(event) => setStandingTo(asInt(event.target.value, standingFrom))} className={inputClass} /></Field>
            </div>
          </div>
        )}

        {(participantSourceType === "matchup_winners" || participantSourceType === "matchup_losers") && (
          <div className="space-y-3">
            <Field label="Φάση προέλευσης">
              <select
                name="participantSourcePhaseId"
                value={participantSourcePhaseId}
                onChange={(event) => setParticipantSourcePhaseId(event.target.value)}
                className={inputClass}
              >
                <option value="">Επιλογή φάσης</option>
                {phaseList.filter((entry) => String(entry.format ?? "") !== "custom").map((entry) => {
                  const id = String(entry.id);
                  const order = Number(entry.phase_order ?? entry.order_index ?? 0);
                  return <option key={id} value={id}>{`${order}. ${entry.name}`}</option>;
                })}
              </select>
            </Field>
            <Field label={`Αναγνωριστικά ${participantSourceType === "matchup_winners" ? "νικητών" : "ηττημένων"}`}>
              <input
                name="sourceMatchupIds"
                value={sourceMatchupIds.join(", ")}
                onChange={(event) => setSourceMatchupIds(event.target.value.split(",").map((value) => value.trim()).filter(Boolean))}
                placeholder="matchup-1, matchup-2, ..."
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500">Χρησιμοποιήστε IDs των matchup (χωρισμένα με κόμμα).</p>
            </Field>
          </div>
        )}

        {participantSourceType === "selected_teams" && (
          <div>
            <Field label="Επιλογή ομάδων">
              <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                {competitionTeams.map((team) => {
                  const teamId = String(team.team_id ?? "").trim();
                  if (!teamId) return null;
                  const checked = selectedTeamIds.includes(teamId);
                  return (
                    <label key={teamId} className="inline-flex items-center gap-2 text-sm text-zinc-700">
                      <input type="checkbox" checked={checked} onChange={(event) => toggleTeam(teamId, event.target.checked)} />
                      <span>{team.team_name}</span>
                    </label>
                  );
                })}
                {!competitionTeams.length && <p className="text-sm text-zinc-500">Δεν υπάρχουν συμμετοχές.</p>}
              </div>
              <input type="hidden" name="participantTeamIds" value={JSON.stringify(selectedTeamIds)} />
            </Field>
          </div>
        )}

        {participantSourceType === "manual" && (
          <div>
            <Field label="Αριθμός manual slots">
              <input
                type="number"
                min={0}
                name="manualSlotCount"
                value={manualSlotCount}
                onChange={(event) => setManualSlotCount(asInt(event.target.value, 0))}
                className={inputClass}
              />
            </Field>
          </div>
        )}
      </section>
    </>
  );

  const renderMatchupsSection = () => (
    <section className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">Διασταυρώσεις (Matchups)</p>
        <p className="mt-2 text-sm text-zinc-600">Ορίστε τον τρόπο διασταύρωσης.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {bracketMethodOptions.map((option) => {
            const selected = bracketMethod === option.value;
            return (
              <button
                type="button"
                key={option.value}
                onClick={() => setBracketMethod(option.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${selected ? "border-orange-500 bg-orange-50" : "border-zinc-200 hover:border-zinc-300"}`}
              >
                <p className={`text-sm font-black ${selected ? "text-zinc-900" : "text-zinc-800"}`}>{option.label}</p>
                <p className="mt-1 text-xs text-zinc-500">{bracketMethodDescriptions[option.value]}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">Νίκες για πρόκριση</p>
        <Field label="Πλήθος νικών">
          <input
            type="number"
            min={1}
            name="winsRequired"
            value={winsRequired}
            onChange={(event) => setWinsRequired(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">Πόσες νίκες απαιτούνται για την πρόκριση.</p>
        </Field>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">Μεταφορά προηγούμενου μεταξύ τους αγώνα</p>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={carryOverEnabled}
            onChange={(event) => {
              const checked = event.target.checked;
              setCarryOverEnabled(checked);
              if (!checked) setCarryOverSourcePhaseId("");
            }}
            className="h-4 w-4 accent-orange-600"
          />
          <span className="text-sm font-black text-zinc-900">Ενεργό</span>
        </label>
        <div className="grid gap-3 md:max-w-[24rem]">
          <Field label="Φάση προέλευσης">
            <select
              name="carryOverSourcePhaseId"
              disabled={!carryOverEnabled}
              value={carryOverSourcePhaseId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                setCarryOverSourcePhaseId(event.target.value);
              }}
              className={inputClass}
            >
              <option value="">Επιλογή φάσης</option>
              {phaseList.filter((entry) => Number(entry.phase_order ?? entry.order_index ?? 0) < currentPhaseOrder).map((entry) => {
                const id = String(entry.id);
                return <option key={id} value={id}>{entry.name}</option>;
              })}
            </select>
          </Field>
        </div>
      </div>

      {(bracketMethod === "manual" || bracketMethod === "custom") && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">Matchups</p>
          <p className="mt-2 text-sm text-zinc-600">Ρύθμιση slots.</p>
          <div className="mt-3 space-y-3">
            {matchups.length ? matchups.map((matchup, index) => (
              <div key={matchup.id} className="space-y-3 rounded-xl border border-zinc-200 p-3">
                <p className="text-sm font-black text-zinc-900">Matchup {index + 1}</p>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-zinc-700">Slot A</label>
                    <select
                      value={matchup.slotA.type}
                      onChange={(event) => changeSlotField(matchup.id, "slotA", "type", event.target.value)}
                      className={inputClass}
                    >
                      {bracketSlotSourceOptions.map((option) => <option key={`${matchup.id}-a-${option.value}`} value={option.value}>{option.label}</option>)}
                    </select>
                    <input
                      value={matchup.slotA.type === "standing_position" ? matchup.slotA.position : matchup.slotA.type === "fixed_team" ? matchup.slotA.teamId : matchup.slotA.type === "matchup_winner" || matchup.slotA.type === "matchup_loser" ? matchup.slotA.matchupId : ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (matchup.slotA.type === "standing_position") {
                          changeSlotField(matchup.id, "slotA", "position", value);
                        }
                        if (matchup.slotA.type === "fixed_team") {
                          changeSlotField(matchup.id, "slotA", "teamId", value);
                        }
                        if (matchup.slotA.type === "matchup_winner" || matchup.slotA.type === "matchup_loser") {
                          changeSlotField(matchup.id, "slotA", "matchupId", value);
                        }
                      }}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-zinc-700">Slot B</label>
                    <select
                      value={matchup.slotB.type}
                      onChange={(event) => changeSlotField(matchup.id, "slotB", "type", event.target.value)}
                      className={inputClass}
                    >
                      {bracketSlotSourceOptions.map((option) => <option key={`${matchup.id}-b-${option.value}`} value={option.value}>{option.label}</option>)}
                    </select>
                    <input
                      value={matchup.slotB.type === "standing_position" ? matchup.slotB.position : matchup.slotB.type === "fixed_team" ? matchup.slotB.teamId : matchup.slotB.type === "matchup_winner" || matchup.slotB.type === "matchup_loser" ? matchup.slotB.matchupId : ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (matchup.slotB.type === "standing_position") {
                          changeSlotField(matchup.id, "slotB", "position", value);
                        }
                        if (matchup.slotB.type === "fixed_team") {
                          changeSlotField(matchup.id, "slotB", "teamId", value);
                        }
                        if (matchup.slotB.type === "matchup_winner" || matchup.slotB.type === "matchup_loser") {
                          changeSlotField(matchup.id, "slotB", "matchupId", value);
                        }
                      }}
                      className={inputClass}
                    />
                  </div>
                  <button type="button" onClick={() => removeMatchup(matchup.id)} className="self-start rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black">Διαγραφή</button>
                  {matchups.length === 1 ? null : null}
                </div>
              </div>
            )) : <p className="text-sm text-zinc-500">Δεν υπάρχουν manual matchups.</p>}
            <button type="button" onClick={addMatchup} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-black">+ Matchup</button>
          </div>
        </div>
      )}
    </section>
  );

  const renderPreviewSection = () => (
    <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">Προεπισκόπηση Διασταυρώσεων</p>
      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Σύνοψη</p>
        <div className="mt-2 grid gap-1 text-sm text-zinc-700 md:grid-cols-2">
          <p><span className="font-black">Πηγή:</span> {participantSourceOptions.find((option) => option.value === participantSourceType)?.label ?? participantSourceType}</p>
          {participantSourceType === "standing_positions" && (
            <p><span className="font-black">Θέσεις:</span> {standingFrom}–{standingTo}</p>
          )}
          <p><span className="font-black">Τρόπος:</span> {bracketMethodOptions.find((option) => option.value === bracketMethod)?.label ?? bracketMethod}</p>
          {isSeriesMode && <p><span className="font-black">Νίκες για πρόκριση:</span> {winsRequired}</p>}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {bracketMethod === "seeded_high_low" ? (
          bracketPairs.length ? bracketPairs.map((pair, index) => (
            <p key={`pair-${index}`} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">#{pair[0]} — #{pair[1]}</p>
          )) : <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500">Δεν υπάρχουν ζεύγη.</p>
        ) : (
          matchups.length ? matchups.map((matchup, index) => (
            <p key={matchup.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              Matchup {index + 1}: {getSlotPreviewValue(matchup.slotA)} — {getSlotPreviewValue(matchup.slotB)}
            </p>
          )) : <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500">Δεν υπάρχουν manual slots.</p>
        )}
      </div>
    </section>
  );

  return <>
    <div className="space-y-4">
      {!isStepMode ? (
        <>
          {renderParticipantSourceInputs()}
          {isMatchupMode && renderMatchupsSection()}
          {isMatchupMode && renderPreviewSection()}
          <div className={`rounded-lg border border-zinc-200 p-3 text-xs ${isOddSeries ? "text-amber-700" : "text-zinc-700"} bg-zinc-50`}>
            {isOddSeries
              ? "Παρατηρήθηκε μονός αριθμός συμμετοχών. Η διασταύρωση απαιτεί BYE/Wildcard/custom επίλυση."
              : "Αξιολόγηση ζευγαρωμάτων είναι έγκυρη για ρητή απόφαση διασταύρωσης."
            }
          </div>
        </>
      ) : (
        <>
          {(activeStep === 1) && renderParticipantSourceInputs()}
          {(activeStep === 2) && isMatchupMode && renderMatchupsSection()}
          {(activeStep === 3) && renderPreviewSection()}
          {activeStep === 3 && isOddSeries && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
              Για μονό πλήθος, επέλεξε Manual ή Custom.
            </p>
          )}
        </>
      )}
    </div>

    <input type="hidden" name="carryOverEnabled" value={carryOverEnabled ? "true" : "false"} />
    <input type="hidden" name="participantConfiguration" value={JSON.stringify({
      participantSourceType,
      participantSourcePhaseId,
      standingFrom,
      standingTo,
      selectedTeamIds,
      sourceMatchupIds,
      manualSlotCount,
      bracketMethod,
      matchups,
    })} />
    <input type="hidden" name="matchups" value={JSON.stringify(matchups)} />
    <div className="hidden" />
  </>;
}
