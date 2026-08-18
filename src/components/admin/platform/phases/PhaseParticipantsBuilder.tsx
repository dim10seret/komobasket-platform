"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
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

type BracketMethod = "manual";
type SlotSourceType = "standing_position" | "matchup_winner" | "matchup_loser" | "manual" | "bye";

type SourceOption = {
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

type BracketOutputSource = {
  value: string;
  label: string;
  disabled?: boolean;
  sourceType: SlotSourceType;
};

export type SeriesMatchupSummary = {
  id: string;
  label: string;
  output: string;
};

type SeriesDisplayContext = {
  phaseById: Map<string, Row>;
  resolvePhaseMatchups: (phase: Row | undefined) => BracketBuilderMatchup[];
};

const participantSourceOptions: SourceOption[] = [
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
  const ruleSettings = getObjectInput(phase?.rule_settings_json);
  const legacyRuleSettings = getObjectInput((phase as Row | undefined)?.settings_json);
  const raw = {
    ...legacyRuleSettings,
    ...ruleSettings,
  };
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
          type: String(slotA.type || "standing_position") as SlotSourceType,
          position: String(slotA.position || ""),
          teamId: String(slotA.teamId || ""),
          matchupId: String(slotA.matchupId || ""),
        },
        slotB: {
          id: String((slotB as Record<string, unknown>).id || `slot-${index}-b`),
          type: String(slotB.type || "standing_position") as SlotSourceType,
          position: String(slotB.position || ""),
          teamId: String(slotB.teamId || ""),
          matchupId: String(slotB.matchupId || ""),
        },
      };
    })
    .filter(Boolean) as BracketBuilderMatchup[];
};

const normalizeParticipantSourceType = (value: string | undefined, fallback: ParticipantSourceType): ParticipantSourceType => {
  const normalized = String(value || fallback).trim().toLowerCase();
  return (participantSourceOptions.find((option) => option.value === normalized)?.value) || fallback;
};

const clampRange = (from: number, to: number, fallbackTo: number) => {
  const safeFrom = Math.max(1, Math.floor(from || 1));
  const safeTo = Math.max(safeFrom, Math.floor(to || fallbackTo));
  return { safeFrom, safeTo };
};

const getSlotToken = (slot: SlotBuilderSource) => {
  const normalizedType = slot.type;
  if (normalizedType === "standing_position") {
    if (!slot.position) return "";
    const value = String(slot.position).trim();
    if (/^\d+$/.test(value)) return `standing:${Number(value)}`;
    if (/^direct:\d+$/.test(value)) return `direct:${value.replace(/^direct:/, "")}`;
    return "";
  }
  if (normalizedType === "matchup_winner" || normalizedType === "matchup_loser") {
    return slot.matchupId ? `${normalizedType}:${slot.matchupId}` : "";
  }
  if (normalizedType === "bye") return `bye:${slot.id}`;
  if (normalizedType === "manual") return slot.teamId ? `manual:${slot.teamId}` : "";
  return "";
};

const getSlotPreviewValue = (slot: SlotBuilderSource) => {
  if (slot.type === "standing_position" && slot.position) {
    const value = String(slot.position).trim();
    if (/^direct:\d+$/.test(value)) return `#${value.replace(/^direct:/, "")}`;
    return `#${value}`;
  }
  if (slot.type === "matchup_winner") return `Winner(${slot.matchupId || "—"})`;
  if (slot.type === "matchup_loser") return `Loser(${slot.matchupId || "—"})`;
  if (slot.type === "manual") return slot.teamId || "—";
  if (slot.type === "bye") return "BYE";
  return "—";
};

const getSeriesOutputOptions = (sourcePhase?: Row, competitionPhases: Row[] = []) => {
  if (!sourcePhase) return [] as BracketOutputSource[];
  const format = String(sourcePhase.format ?? sourcePhase.phase_kind ?? "").trim().toLowerCase();
  const settings = getObjectInput(sourcePhase.rule_settings_json);
  const participantConfig = getObjectInput(settings.participantConfiguration);
  const from = asInt(participantConfig.standingFrom, 1);
  const to = asInt(participantConfig.standingTo, from);
  if (format === "standings") {
    const bounded = clampRange(from, to, from);
    return Array.from({ length: bounded.safeTo - bounded.safeFrom + 1 }, (_, index) => {
      const position = bounded.safeFrom + index;
      return {
        value: String(position),
        label: `#${position}`,
        sourceType: "standing_position" as SlotSourceType,
      };
    });
  }

  if (format === "series") {
    const competitionMatchupIndex = buildSeriesCompetitionMatchupIndex(competitionPhases.length ? competitionPhases : [sourcePhase]);
    const bracketConfig = getObjectInput(settings.bracketConfiguration);
    const matchups = parseSlotArray(bracketConfig.matchups).map((entry) => ({
      id: entry.id,
      slotA: entry.slotA,
      slotB: entry.slotB,
    }));

    const directFromStandings: BracketOutputSource[] = [];
    for (const matchup of matchups) {
      const slots = [matchup.slotA, matchup.slotB];
      const byeSlot = slots.find((slot) => slot.type === "bye");
      if (!byeSlot) continue;
      const otherSlot = slots.find((slot) => slot !== byeSlot);
      const value = otherSlot?.position ? otherSlot.position : otherSlot?.matchupId || otherSlot?.teamId || "";
      if (!value) continue;
      const normalized = `direct:${String(value).trim().replace(/^direct:/, "")}`;
      if (directFromStandings.some((entry) => entry.value === normalized)) continue;
      directFromStandings.push({
        value: normalized,
        label: `${describeSeriesParticipantRef(otherSlot ?? { type: "manual", id: "", position: "", teamId: "", matchupId: "" }, competitionMatchupIndex)} · άνευ αγώνα`,
        sourceType: "standing_position",
      });
    }

    const winnerOptions = matchups
      .filter((matchup) => matchup.id)
      .map((matchup) => ({
        value: `winner:${matchup.id}`,
        label: `Winner ${describeSeriesMatchupLabel(matchup, competitionMatchupIndex)}`,
        sourceType: "matchup_winner" as SlotSourceType,
      }));

    return [...directFromStandings, ...winnerOptions];
  }

  return [];
};

type SeriesCompetitionMatchupIndexEntry = {
  phaseId: string;
  matchup: BracketBuilderMatchup;
};

const buildSeriesCompetitionMatchupIndex = (phases: Row[]) => {
  const index = new Map<string, SeriesCompetitionMatchupIndexEntry>();
  for (const currentPhase of phases) {
    if (String(currentPhase.format ?? "").trim().toLowerCase() !== "series") continue;
    const settings = {
      ...getObjectInput((currentPhase as Row | undefined)?.settings_json),
      ...getObjectInput(currentPhase.rule_settings_json),
    };
    const bracketConfig = getObjectInput(settings.bracketConfiguration);
    for (const matchup of parseSlotArray(bracketConfig.matchups)) {
      const matchupId = String(matchup.id ?? "").trim();
      if (!matchupId) continue;
      const existing = index.get(matchupId);
      if (existing && existing.phaseId !== String(currentPhase.id ?? "")) continue;
      index.set(matchupId, {
        phaseId: String(currentPhase.id ?? ""),
        matchup,
      });
    }
  }
  return index;
};

const describeSeriesParticipantRef = (
  slot: SlotBuilderSource,
  competitionMatchupIndex: Map<string, SeriesCompetitionMatchupIndexEntry>,
  visitedMatchupIds = new Set<string>(),
): string => {
  if (slot.type === "standing_position" && slot.position) {
    const value = String(slot.position).trim();
    if (/^direct:\d+$/.test(value)) return `#${value.replace(/^direct:/, "")}`;
    return `#${value}`;
  }
  if (slot.type === "bye") return "Προκρίνεται άνευ αγώνα";
  if (slot.type === "manual") return slot.teamId || "—";
  if (slot.type === "matchup_winner" || slot.type === "matchup_loser") {
    const matchupId = String(slot.matchupId ?? "").trim();
    if (!matchupId) return slot.type === "matchup_winner" ? "Winner —" : "Loser —";
    if (visitedMatchupIds.has(matchupId)) return "—";
    const source = competitionMatchupIndex.get(matchupId);
    if (!source) return slot.type === "matchup_winner" ? "Winner —" : "Loser —";
    visitedMatchupIds.add(matchupId);
    const previousLabel = describeSeriesMatchupLabel(source.matchup, competitionMatchupIndex, visitedMatchupIds);
    return slot.type === "matchup_winner" ? `Winner ${previousLabel}` : `Loser ${previousLabel}`;
  }
  return "—";
};

const describeSeriesMatchupLabel = (
  matchup: BracketBuilderMatchup,
  competitionMatchupIndex: Map<string, SeriesCompetitionMatchupIndexEntry>,
  visitedMatchupIds = new Set<string>(),
): string => {
  const slotA = describeSeriesParticipantRef(matchup.slotA, competitionMatchupIndex, visitedMatchupIds);
  const slotB = describeSeriesParticipantRef(matchup.slotB, competitionMatchupIndex, visitedMatchupIds);
  if (matchup.slotA.type === "bye" && matchup.slotB.type !== "bye") return `${slotB} → Προκρίνεται άνευ αγώνα`;
  if (matchup.slotB.type === "bye" && matchup.slotA.type !== "bye") return `${slotA} → Προκρίνεται άνευ αγώνα`;
  return `${slotA} — ${slotB}`;
};

export const describeSeriesMatchupsFromPhase = (data: Snapshot, phase?: Row): SeriesMatchupSummary[] => {
  if (!phase) return [];

  const parsePhaseMatchups = (currentPhase: Row | undefined): BracketBuilderMatchup[] => {
    if (!currentPhase) return [];
    const settings = {
      ...getObjectInput((currentPhase as Row | undefined)?.settings_json),
      ...getObjectInput(currentPhase.rule_settings_json),
    };
    const bracketConfig = getObjectInput(settings.bracketConfiguration);
    return parseSlotArray(bracketConfig.matchups);
  };

  const competitionMatchupIndex = buildSeriesCompetitionMatchupIndex(data.phases);
  const activeMatchups = parsePhaseMatchups(phase);
  return activeMatchups.map((matchup) => ({
    id: String(matchup.id),
    label: describeSeriesMatchupLabel(matchup, competitionMatchupIndex),
    output: matchup.slotA.type === "bye"
      ? describeSeriesParticipantRef(matchup.slotB, competitionMatchupIndex)
      : matchup.slotB.type === "bye"
        ? describeSeriesParticipantRef(matchup.slotA, competitionMatchupIndex)
        : `Winner ${describeSeriesMatchupLabel(matchup, competitionMatchupIndex)}`,
  }));
};

const normalizeMatchupForComparison = (matchup: BracketBuilderMatchup) => ({
  id: String(matchup.id ?? ""),
  slotA: {
    type: matchup.slotA.type,
    position: String(matchup.slotA.position ?? ""),
    teamId: String(matchup.slotA.teamId ?? ""),
    matchupId: String(matchup.slotA.matchupId ?? ""),
  },
  slotB: {
    type: matchup.slotB.type,
    position: String(matchup.slotB.position ?? ""),
    teamId: String(matchup.slotB.teamId ?? ""),
    matchupId: String(matchup.slotB.matchupId ?? ""),
  },
});

const getSeriesContinuationEligibility = (
  isSeriesMode: boolean,
  bracketMatchups: BracketBuilderMatchup[],
  sourcePhaseId: string,
  standingFrom: number,
  standingTo: number,
  sourcePhase: Row | undefined,
  sourcePhaseIsStandings: boolean,
) => {
  if (!isSeriesMode) return { eligible: false, errors: ["Δεν είναι σειρά αγώνων."] };
  if (!sourcePhaseId) return { eligible: false, errors: ["Δεν έχει επιλεγεί φάση προέλευσης."] };
  if (standingFrom < 1) return { eligible: false, errors: ["Η από θέση πρέπει να είναι >= 1."] };
  if (standingTo < standingFrom) return { eligible: false, errors: ["Η θέση λήξης δεν μπορεί να είναι πριν την θέση έναρξης."] };
  if (sourcePhase && sourcePhaseIsStandings) {
    const settings = getObjectInput(sourcePhase.rule_settings_json);
    const sourceCfg = getObjectInput(settings.participantConfiguration) as Record<string, unknown>;
    const from = asInt(sourceCfg.standingFrom, 1);
    const to = asInt(sourceCfg.standingTo, from);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || standingFrom < from || standingTo > to) {
      return { eligible: false, errors: ["Το εύρος θέσεων δεν είναι εντός του διαθέσιμου εύρους της πηγής."] };
    }
  }
  if (!bracketMatchups.length) {
    return { eligible: false, errors: ["Δεν υπάρχουν ορισμένα matchups."] };
  }

  const sourceTokenCounts = new Map<string, number>();
  const hasInvalidEmptySlot = bracketMatchups.some((matchup) => {
    const slotAToken = getSlotToken(matchup.slotA);
    const slotBToken = getSlotToken(matchup.slotB);
    return (
      (!slotAToken && matchup.slotA.type !== "bye") ||
      (!slotBToken && matchup.slotB.type !== "bye")
    );
  });
  if (hasInvalidEmptySlot) {
    return { eligible: false, errors: ["Συμπλήρωσε όλες τις θέσεις matchups."] };
  }

  for (const matchup of bracketMatchups) {
    const slotAToken = getSlotToken(matchup.slotA);
    const slotBToken = getSlotToken(matchup.slotB);
    if (slotAToken) sourceTokenCounts.set(slotAToken, (sourceTokenCounts.get(slotAToken) ?? 0) + 1);
    if (slotBToken) sourceTokenCounts.set(slotBToken, (sourceTokenCounts.get(slotBToken) ?? 0) + 1);
  }
  for (const [token, count] of sourceTokenCounts.entries()) {
    if (count <= 1) continue;
    if (token.startsWith("standing:")) {
      return { eligible: false, errors: [`Το slot #${token.split(":")[1]} χρησιμοποιείται περισσότερες φορές.`] };
    }
    if (token.startsWith("direct:")) {
      return { eligible: false, errors: [`Το slot #${token.split(":")[1]} χρησιμοποιείται περισσότερες φορές.`] };
    }
    return { eligible: false, errors: [`Το slot ${token} χρησιμοποιείται περισσότερες φορές.`] };
  }

  const directFromMatchups = bracketMatchups.filter((matchup) =>
    matchup.slotA.type !== "bye" && matchup.slotB.type !== "bye",
  );
  const outputs = bracketMatchups.length + (directFromMatchups.length % 2);
  if (!outputs) {
    return { eligible: false, errors: ["Το pool εξόδου είναι άδειο."] };
  }

  return { eligible: true, errors: [] };
};

export function PhaseParticipantsBuilder({
  data,
  phase,
  competitionId,
  selectedFormat,
  activeStep,
  lockedSeriesSourcePhaseId,
  lockedSeriesRangeFrom,
  lockedSeriesRangeTo,
  seriesContinuationMode,
  onContinueSeries,
}: {
  data: Snapshot;
  phase?: Row;
  competitionId: string;
  selectedFormat: string;
  activeStep?: number;
  lockedSeriesSourcePhaseId?: string;
  lockedSeriesRangeFrom?: number;
  lockedSeriesRangeTo?: number;
  seriesContinuationMode?: boolean;
  onContinueSeries?: () => void;
}) {
  const parsedConfig = useMemo(() => parsePhaseConfig(phase), [phase]);
  const config = parsedConfig.participantConfiguration;
  const bracketConfig = parsedConfig.bracketConfiguration;
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

  const [participantSourceType, setParticipantSourceType] = useState<ParticipantSourceType>(() =>
    normalizeParticipantSourceType(String(config?.participantSourceType || phase?.format === "series" ? "standing_positions" : "competition_participants"), "competition_participants"),
  );
  const [participantSourcePhaseId, setParticipantSourcePhaseId] = useState(
    String(lockedSeriesSourcePhaseId?.trim() || phase?.previous_phase_id || config?.participantSourcePhaseId || ""),
  );
  const [standingFrom, setStandingFrom] = useState(asInt(lockedSeriesRangeFrom ?? config?.standingFrom, 1));
  const [standingTo, setStandingTo] = useState(asInt(lockedSeriesRangeTo ?? config?.standingTo, asInt(config?.standingFrom, 1)));
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(config?.selectedTeamIds ?? []);
  const [sourceMatchupIds, setSourceMatchupIds] = useState<string[]>(config?.sourceMatchupIds ?? []);
  const [manualSlotCount, setManualSlotCount] = useState(asInt(config?.manualSlotCount, 0));
  const [bracketMethod] = useState<BracketMethod>("manual");
  const [matchups, setMatchups] = useState<BracketBuilderMatchup[]>(() => parseSlotArray(bracketConfig?.matchups));
  const [carryOverEnabled, setCarryOverEnabled] = useState(Boolean(phase?.format === "series" ? Number(phase?.carry_over_enabled ?? 0) === 1 : false));
  const [carryOverSourcePhaseId, setCarryOverSourcePhaseId] = useState(String(phase?.carry_over_source_phase_id ?? ""));
  const [winsRequired, setWinsRequired] = useState(String(asInt(phase?.wins_required ?? 2, 2)));

  const isSeriesMode = String(selectedFormat) === "series";
  const sourcePhase = useMemo(() => phaseList.find((entry) => String(entry.id ?? "") === participantSourcePhaseId), [phaseList, participantSourcePhaseId]);
  const sourceIsSeries = String(sourcePhase?.format ?? sourcePhase?.phase_kind ?? "") === "series";
  const sourceOutputPool = useMemo(() => getSeriesOutputOptions(sourcePhase, phaseList), [sourcePhase, phaseList]);
  const persistedSourcePhaseId = String(config?.participantSourcePhaseId ?? "").trim();
  const persistedSourcePhase = useMemo(() => phaseList.find((entry) => String(entry.id ?? "") === persistedSourcePhaseId), [phaseList, persistedSourcePhaseId]);
  const sourceRangeSlots = useMemo(() => {
    if (isSeriesMode && sourcePhase && String(sourcePhase.format ?? sourcePhase.phase_kind ?? "").toLowerCase() === "standings") {
      const settings = getObjectInput(sourcePhase.rule_settings_json);
      const participantConfiguration = getObjectInput(settings.participantConfiguration) as Record<string, unknown>;
      const from = asInt(participantConfiguration.standingFrom, 1);
      const to = asInt(participantConfiguration.standingTo, from);
      const bounded = clampRange(from, to, from);
      return Array.from({ length: bounded.safeTo - bounded.safeFrom + 1 }, (_, index) => String(bounded.safeFrom + index));
    }
    return [];
  }, [isSeriesMode, sourcePhase]);

  const availableStandingSlots = useMemo(() => {
    const from = asInt(standingFrom, 1);
    const to = asInt(standingTo, from);
    const bounded = clampRange(from, to, from);
    return Array.from({ length: bounded.safeTo - bounded.safeFrom + 1 }, (_, index) => String(bounded.safeFrom + index));
  }, [standingFrom, standingTo]);

  const [sourceValidationMessages, setSourceValidationMessages] = useState<string[]>([]);
  const isOddSeries = isSeriesMode && availableStandingSlots.length > 1 && availableStandingSlots.length % 2 === 1;
  const isStepMode = activeStep !== undefined;

  useEffect(() => {
    const next = parsePhaseConfig(phase);
    const cfg = next.participantConfiguration;
    const bracketCfg = next.bracketConfiguration;
    const normalizedSourceType = normalizeParticipantSourceType(
      String(cfg?.participantSourceType || "competition_participants"),
      "competition_participants",
    );
    setParticipantSourceType(isSeriesMode ? "standing_positions" : normalizedSourceType);
    setParticipantSourcePhaseId(String(lockedSeriesSourcePhaseId?.trim() || phase?.previous_phase_id || cfg?.participantSourcePhaseId || ""));
    setStandingFrom(asInt(lockedSeriesRangeFrom ?? cfg?.standingFrom, 1));
    setStandingTo(asInt(lockedSeriesRangeTo ?? cfg?.standingTo, asInt(cfg?.standingFrom, 1)));
    setSelectedTeamIds(cfg?.selectedTeamIds ?? []);
    setSourceMatchupIds(cfg?.sourceMatchupIds ?? []);
    setManualSlotCount(asInt(cfg?.manualSlotCount, 0));
    setMatchups(parseSlotArray(bracketCfg?.matchups));
    setWinsRequired(String(asInt(phase?.wins_required ?? 2, 2)));
    setCarryOverEnabled(Boolean(phase?.format === "series" ? Number(phase?.carry_over_enabled ?? 0) === 1 : false));
    setCarryOverSourcePhaseId(String(phase?.carry_over_source_phase_id ?? ""));
  }, [isSeriesMode, lockedSeriesRangeFrom, lockedSeriesRangeTo, lockedSeriesSourcePhaseId, phase]);

  useEffect(() => {
    if (!isSeriesMode) return;
    if (participantSourceType !== "standing_positions") {
      setParticipantSourceType("standing_positions");
    }
  }, [isSeriesMode, participantSourceType]);

  const estimatedParticipantCount = useMemo(() => {
    if (participantSourceType === "competition_participants") return competitionTeams.length;
    if (participantSourceType === "selected_teams") return selectedTeamIds.length;
    if (participantSourceType === "standing_positions") return Math.max(0, standingTo - standingFrom + 1);
    if (participantSourceType === "manual") return manualSlotCount;
    return sourceMatchupIds.length;
  }, [competitionTeams.length, manualSlotCount, participantSourceType, selectedTeamIds.length, standingFrom, standingTo, sourceMatchupIds.length]);

  const isSeriesStepSourceRangeValid = useMemo(() => {
    if (!isSeriesMode) return true;
    if (!participantSourcePhaseId) return false;
    if (standingFrom < 1) return false;
    if (standingTo < standingFrom) return false;
    if (sourcePhase && String(sourcePhase.format ?? sourcePhase.phase_kind ?? "").toLowerCase() === "standings" && sourceRangeSlots.length) {
      const sourceFrom = asInt(sourceRangeSlots[0], 1);
      const sourceTo = asInt(sourceRangeSlots[sourceRangeSlots.length - 1], sourceFrom);
      if (standingFrom < sourceFrom || standingTo > sourceTo) return false;
    }
    return true;
  }, [isSeriesMode, participantSourcePhaseId, standingFrom, standingTo]);

  const persistedMatchups = useMemo(() => parseSlotArray(bracketConfig?.matchups), [bracketConfig?.matchups]);
  const persistedSeriesSourceFrom = asInt(config?.standingFrom, 1);
  const persistedSeriesSourceTo = asInt(config?.standingTo, persistedSeriesSourceFrom);
  const persistedCanonicalSourcePhaseId = String(phase?.previous_phase_id ?? config?.participantSourcePhaseId ?? "").trim();
  const persistedSeriesParticipantConfig = useMemo(() => ({
    participantSourcePhaseId: persistedCanonicalSourcePhaseId,
    standingFrom: persistedSeriesSourceFrom,
    standingTo: persistedSeriesSourceTo,
    selectedTeamIds: (config?.selectedTeamIds ?? []).slice(),
    sourceMatchupIds: (config?.sourceMatchupIds ?? []).slice(),
    manualSlotCount: asInt(config?.manualSlotCount, 0),
    winsRequired: String(asInt(phase?.wins_required, 2)),
    carryOverEnabled: Boolean(phase?.format === "series" ? Number(phase?.carry_over_enabled ?? 0) === 1 : false),
    carryOverSourcePhaseId: String(phase?.carry_over_source_phase_id ?? ""),
    matchups: persistedMatchups.map(normalizeMatchupForComparison),
  }), [
    config?.manualSlotCount,
    config?.selectedTeamIds,
    config?.sourceMatchupIds,
    config?.standingFrom,
    config?.standingTo,
    phase?.carry_over_enabled,
    phase?.carry_over_source_phase_id,
    phase?.format,
    phase?.wins_required,
    persistedMatchups,
    persistedCanonicalSourcePhaseId,
    persistedSeriesSourceFrom,
    persistedSeriesSourceTo,
  ]);

  const localSeriesConfigState = useMemo(() => ({
    participantSourcePhaseId,
    standingFrom: asInt(standingFrom, 1),
    standingTo: asInt(standingTo, standingFrom),
    selectedTeamIds: [...selectedTeamIds],
    sourceMatchupIds: [...sourceMatchupIds],
    manualSlotCount: asInt(manualSlotCount, 0),
    winsRequired: String(asInt(winsRequired, 2)),
    carryOverEnabled,
    carryOverSourcePhaseId,
    matchups: matchups.map(normalizeMatchupForComparison),
  }), [
    carryOverEnabled,
    carryOverSourcePhaseId,
    manualSlotCount,
    matchups,
    participantSourcePhaseId,
    selectedTeamIds,
    sourceMatchupIds,
    standingFrom,
    standingTo,
    winsRequired,
  ]);

  const persistedSeriesEligibility = useMemo(
    () => getSeriesContinuationEligibility(
      isSeriesMode,
      persistedMatchups,
      persistedSourcePhaseId,
      persistedSeriesSourceFrom,
      persistedSeriesSourceTo,
      persistedSourcePhase,
      String(persistedSourcePhase?.format ?? persistedSourcePhase?.phase_kind ?? "") === "standings",
    ),
    [isSeriesMode, persistedMatchups, persistedSeriesSourceFrom, persistedSeriesSourceTo, persistedSourcePhase, persistedSourcePhaseId],
  );

  const isSeriesConfigPersisted = useMemo(() => {
    if (!phase?.id || !isSeriesMode) return false;
    try {
      return JSON.stringify(persistedSeriesParticipantConfig) === JSON.stringify(localSeriesConfigState);
    } catch {
      return false;
    }
  }, [isSeriesMode, localSeriesConfigState, phase?.id, persistedSeriesParticipantConfig]);

  const canContinueSeries = isSeriesMode ? (isSeriesConfigPersisted ? persistedSeriesEligibility.eligible : false) : false;
  const carryOverSourcePhase = useMemo(
    () => phaseList.find((entry) => String(entry.id ?? "") === carryOverSourcePhaseId),
    [carryOverSourcePhaseId, phaseList],
  );
  const seriesMaxTotalResults = Math.max(0, (asInt(winsRequired, 2) * 2) - 1);
  const countedPreviousResults = carryOverEnabled && carryOverSourcePhase ? 1 : 0;
  const maxNewGamesToSchedule = Math.max(0, seriesMaxTotalResults - countedPreviousResults);

  const sourcePhaseOptions = useMemo(() => {
    return phaseList;
  }, [phaseList]);

  const sourcePoolCount = sourceIsSeries ? sourceOutputPool.length : availableStandingSlots.length;

  const currentPhaseSourceTokens = useMemo(() => {
    const counts = new Map<string, number>();
    for (const matchup of matchups) {
      for (const slot of [matchup.slotA, matchup.slotB]) {
        if (slot.type === "bye") continue;
        const token = getSlotToken(slot);
        if (!token) continue;
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    return counts;
  }, [matchups]);

  const totalSlotsUsed = useMemo(() => {
    const usedTokens = new Set<string>();
    for (const matchup of matchups) {
      const tokens = [matchup.slotA, matchup.slotB].map(getSlotToken);
      for (const token of tokens) {
        if (!token || token.startsWith("bye:")) continue;
        usedTokens.add(token);
      }
    }
    return usedTokens.size;
  }, [matchups]);

  const estimatedOutputSlots = useMemo(() => {
    if (!isSeriesMode) return matchups.length;
    return matchups.length + Math.max(0, totalSlotsUsed % 2);
  }, [isSeriesMode, matchups.length, totalSlotsUsed]);

  const matchupErrors = useMemo(() => {
    const errors: string[] = [];
    if (isSeriesMode && isOddSeries) {
      errors.push("Για μονό πλήθος συμμετοχών, πρόσθεσε BYE σε τουλάχιστον ένα matchup slot.");
    }
    for (const [token, count] of currentPhaseSourceTokens.entries()) {
    if (count <= 1) continue;
      const normalized = token.startsWith("standing:")
        ? `#${token.split(":")[1]}`
        : token.startsWith("direct:")
          ? `#${token.split(":")[1]}`
        : token.startsWith("matchup_") ? token.split(":")[1] : "Slot";
      errors.push(`Το slot ${normalized} χρησιμοποιείται >1 φορά.`);
    }
    return errors;
  }, [currentPhaseSourceTokens, isSeriesMode, isOddSeries]);

  useEffect(() => {
    setSourceValidationMessages(matchupErrors);
  }, [matchupErrors]);

  const standingOptionMax = Math.max(availableStandingSlots.length, competitionTeams.length, standingFrom, standingTo, 1);
  const standingRangeOptions = useMemo(() => {
    return Array.from({ length: standingOptionMax }, (_, index) => String(index + 1));
  }, [standingOptionMax]);

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

  const changeSlotType = (matchupId: string, slot: "slotA" | "slotB", nextType: SlotSourceType) => {
    setMatchups((current) => current.map((entry) => {
      if (entry.id !== matchupId) return entry;
      const next = { ...entry };
      const nextSlot = { ...next[slot], type: nextType } as SlotBuilderSource;
      if (nextType !== "standing_position") {
        nextSlot.position = "";
      }
      if (nextType !== "matchup_winner" && nextType !== "matchup_loser") {
        nextSlot.matchupId = "";
      }
      if (nextType !== "manual") {
        nextSlot.teamId = "";
      }
      if (nextType === "bye") {
        nextSlot.position = "";
        nextSlot.teamId = "";
        nextSlot.matchupId = "";
      }
      next[slot] = nextSlot;
      return next;
    }));
  };

  const changeSlotValue = (
    matchupId: string,
    slot: "slotA" | "slotB",
    field: keyof SlotBuilderSource,
    value: string,
  ) => {
    setMatchups((current) => current.map((entry) => {
      if (entry.id !== matchupId) return entry;
      const next = { ...entry };
      const nextSlot: SlotBuilderSource = { ...next[slot], [field]: value } as SlotBuilderSource;
      next[slot] = nextSlot;
      return next;
    }));
  };

  const slotHasDuplication = (slot: SlotBuilderSource) => {
    const token = getSlotToken(slot);
    if (!token) return false;
    return (currentPhaseSourceTokens.get(token) ?? 0) > 1;
  };

  const isSeriesSlotValueUsedElsewhere = (token: string, currentSlotId: string) => {
    if (!token) return false;
    return matchups.some((entry) => {
      if (entry.slotA.id !== currentSlotId && getSlotToken(entry.slotA) === token) return true;
      if (entry.slotB.id !== currentSlotId && getSlotToken(entry.slotB) === token) return true;
      return false;
    });
  };

  const renderSeriesParticipantSelect = (slot: SlotBuilderSource, slotRefId: string, allowBye: boolean) => {
    const options = sourceIsSeries ? sourceOutputPool : availableStandingSlots;
    const isSlotA = slotRefId.endsWith("-a");
    const currentToken = getSlotToken(slot);

    return (
      <select
        value={sourceIsSeries
          ? (slot.type === "bye"
              ? "__bye__"
              : slot.type === "matchup_winner"
                ? `winner:${slot.matchupId}`
                : slot.position)
          : (slot.type === "bye" ? "__bye__" : slot.position)}
        onChange={(event) => {
          const selected = event.target.value;
          const matchupId = slotRefId.split("-").slice(0, -1).join("-");
          const key: "slotA" | "slotB" = isSlotA ? "slotA" : "slotB";

          if (sourceIsSeries) {
            if (selected === "__bye__" && !isSlotA) {
              changeSlotType(matchupId, key, "bye");
              changeSlotValue(matchupId, key, "position", "");
              changeSlotValue(matchupId, key, "matchupId", "");
              changeSlotValue(matchupId, key, "teamId", "");
              return;
            }
            if (selected.startsWith("winner:")) {
              changeSlotType(matchupId, key, "matchup_winner");
              changeSlotValue(matchupId, key, "matchupId", selected.replace(/^winner:/, ""));
              changeSlotValue(matchupId, key, "position", "");
              changeSlotValue(matchupId, key, "teamId", "");
              return;
            }
            if (selected.startsWith("direct:")) {
              changeSlotType(matchupId, key, "standing_position");
              changeSlotValue(matchupId, key, "position", selected);
              changeSlotValue(matchupId, key, "matchupId", "");
              changeSlotValue(matchupId, key, "teamId", "");
              return;
            }
          }

          if (selected === "__bye__" && !isSlotA) {
            changeSlotType(matchupId, key, "bye");
            changeSlotValue(matchupId, key, "position", "");
            changeSlotValue(matchupId, key, "matchupId", "");
            changeSlotValue(matchupId, key, "teamId", "");
            return;
          }

          changeSlotType(matchupId, key, "standing_position");
          changeSlotValue(matchupId, key, "position", selected);
          changeSlotValue(matchupId, key, "teamId", "");
          changeSlotValue(matchupId, key, "matchupId", "");
        }}
        className={inputClass}
      >
        <option value="">Επιλογή</option>
        {sourceIsSeries
          ? sourceOutputPool.map((entry) => {
            const normalized = String(entry.value);
            const isSelectedInCurrentSlot = normalized === currentToken;
            const isDisabled = !isSelectedInCurrentSlot && isSeriesSlotValueUsedElsewhere(normalized, slot.id);
            return (
              <option key={`${slotRefId}-${normalized}`} value={normalized} disabled={isDisabled}>
                {entry.label}
              </option>
            );
          })
          : options.map((value) => {
            const normalized = String(value);
            const token = `standing:${normalized}`;
            const isSelectedInCurrentSlot = token === currentToken;
            const isDisabled = slot.type === "bye" ? false : (!isSelectedInCurrentSlot && isSeriesSlotValueUsedElsewhere(token, slot.id));
            return (
              <option key={`${slotRefId}-${normalized}`} value={normalized} disabled={isDisabled}>
                #{normalized}
              </option>
            );
          })}
        {allowBye ? <option value="__bye__">Προκρίνεται άνευ αγώνα</option> : null}
      </select>
    );
  };

  const addMatchup = () => {
    const nextIndex = matchups.length + 1;
    setMatchups((current) => [...current, {
      id: `matchup-${Date.now()}-${nextIndex}`,
      slotA: { id: `slot-a-${nextIndex}`, type: "standing_position", position: "", teamId: "", matchupId: "" },
      slotB: { id: `slot-b-${nextIndex}`, type: "standing_position", position: "", teamId: "", matchupId: "" },
    }]);
  };

  const removeMatchup = (matchupId: string) => {
    setMatchups((current) => current.filter((entry) => entry.id !== matchupId));
  };

  const renderSourcePhaseSelection = () => (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">ΠΗΓΗ ΟΜΑΔΩΝ</p>
      {isSeriesMode ? (
        <>
          <Field label="Φάση προέλευσης">
            {seriesContinuationMode || lockedSeriesSourcePhaseId || String(sourcePhase?.format ?? sourcePhase?.phase_kind ?? "") === "series" ? (
              <input readOnly value={sourcePhase?.name || "—"} className={inputClass} />
            ) : (
              <select
                name="participantSourcePhaseId"
                value={participantSourcePhaseId}
                onChange={(event) => {
                  setParticipantSourcePhaseId(event.target.value);
                  setStandingFrom(1);
                  setStandingTo(Math.max(1, 1));
                }}
                className={inputClass}
              >
                <option value="">Επιλογή φάσης</option>
                {sourcePhaseOptions
                  .filter((entry) => Number(entry.phase_order ?? entry.order_index ?? 0) < Number(phase?.phase_order ?? 0))
                  .map((entry) => {
                  const id = String(entry.id);
                  const order = Number(entry.phase_order ?? entry.order_index ?? 0);
                  return <option key={id} value={id}>{`${order}. ${entry.name}`}</option>;
                })}
              </select>
            )}
          </Field>
          {!seriesContinuationMode && String(sourcePhase?.format ?? sourcePhase?.phase_kind ?? "") !== "series" ? (
            <>
              <Field label="Από θέση">
                <select
                  name="standingFrom"
                  value={standingFrom}
                  onChange={(event) => setStandingFrom(asInt(event.target.value, 1))}
                  className={inputClass}
                >
                  <option value="">Επιλογή</option>
                  {standingRangeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="Έως θέση">
                <select
                  name="standingTo"
                  value={standingTo}
                  onChange={(event) => setStandingTo(asInt(event.target.value, standingTo))}
                  className={inputClass}
                >
                  <option value="">Επιλογή</option>
                  {standingRangeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
            </>
          ) : null}
          {seriesContinuationMode || String(sourcePhase?.format ?? sourcePhase?.phase_kind ?? "") === "series" ? (
            <Field label="Διαθεσιμότητα">
              <input readOnly value={`${sourcePoolCount} διαθέσιμα slots από προηγούμενη φάση`} className={inputClass} />
            </Field>
          ) : null}
        </>
      ) : (
        <>
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
                      onChange={(event) => setParticipantSourceType(normalizeParticipantSourceType(event.target.value, "competition_participants"))}
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
        </>
      )}
    </section>
  );

  const renderParticipantSourceInputs = () => {
    const sourceDescription = participantSourceDescriptions[participantSourceType];
    return (
      <>
        {renderSourcePhaseSelection()}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-4">
          <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">ΣΥΜΜΕΤΟΧΗ ΣΤΗ ΦΑΣΗ</p>
          {!isSeriesMode && (
            <div className="space-y-2">
              <p className="text-xs font-black text-zinc-700">Ενεργή πηγή</p>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800">{participantSourceOptions.find((option) => option.value === participantSourceType)?.label}</div>
              <p className="text-xs text-zinc-500">{sourceDescription}</p>
            </div>
          )}
          {isSeriesMode ? (
            <Field label="Διαθεσιμότητα">
              <input readOnly value={`${sourcePoolCount} διαθέσιμα slots`} className={inputClass} />
            </Field>
          ) : (
            <Field label="Διαθεσιμότητα">
              <input readOnly value={`${estimatedParticipantCount} διαθέσιμες ομάδες`} className={inputClass} />
            </Field>
          )}

          {(participantSourceType === "standing_positions" || isSeriesMode) && (
            <div className="space-y-3">
              {!isSeriesMode && (
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
              )}
              {!isSeriesMode && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Από θέση"><input type="number" min={1} name="standingFrom" value={standingFrom} onChange={(event) => setStandingFrom(asInt(event.target.value, 1))} className={inputClass} /></Field>
                  <Field label="Έως θέση"><input type="number" min={1} name="standingTo" value={standingTo} onChange={(event) => setStandingTo(asInt(event.target.value, standingFrom))} className={inputClass} /></Field>
                </div>
              )}
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
  };

  const renderMatchupsSection = () => (
    <section className="space-y-4">
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
              {phaseList.filter((entry) => Number(entry.phase_order ?? entry.order_index ?? 0) < Number(phase?.phase_order ?? 0)).map((entry) => {
                const id = String(entry.id);
                return <option key={id} value={id}>{entry.name}</option>;
              })}
            </select>
          </Field>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">Matchups</p>
        <p className="mt-2 text-sm text-zinc-600">Καθορισμός χειροκίνητων αντιστοιχίσεων.</p>
        <div className="mt-3 space-y-3">
          {matchups.length ? matchups.map((matchup, index) => (
            <div key={matchup.id} className="space-y-3 rounded-xl border border-zinc-200 p-3">
              <p className="text-sm font-black text-zinc-900">Matchup {index + 1}</p>
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs font-black text-zinc-700">Slot A</label>
                  {renderSeriesParticipantSelect(matchup.slotA, `${matchup.id}-a`, false)}
                  {slotHasDuplication(matchup.slotA) ? <p className="text-xs text-amber-700">Αυτό το slot έχει ήδη χρησιμοποιηθεί.</p> : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-zinc-700">Slot B</label>
                  {renderSeriesParticipantSelect(matchup.slotB, `${matchup.id}-b`, true)}
                  {slotHasDuplication(matchup.slotB) ? <p className="text-xs text-amber-700">Αυτό το slot έχει ήδη χρησιμοποιηθεί.</p> : null}
                </div>
                <button type="button" onClick={() => removeMatchup(matchup.id)} className="self-start rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black" title="Διαγραφή matchup">
                  🗑 Διαγραφή
                </button>
              </div>
            </div>
          )) : <p className="text-sm text-zinc-500">Δεν υπάρχουν manual matchups.</p>}
          <button
            type="button"
            onClick={addMatchup}
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-black"
          >
            + Προσθήκη Διασταύρωσης
          </button>
        </div>
      </div>
    </section>
  );

  const renderPreviewSection = () => (
    <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-orange-600">Προεπισκόπηση Διασταυρώσεων</p>
      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Σύνοψη</p>
        <div className="mt-2 grid gap-1 text-sm text-zinc-700 md:grid-cols-2">
          <p><span className="font-black">Πηγή:</span> {isSeriesMode ? "Σειρά αγώνων" : participantSourceOptions.find((option) => option.value === participantSourceType)?.label ?? participantSourceType}</p>
          <p><span className="font-black">Θέσεις:</span> {isSeriesMode ? `${standingFrom}–${standingTo}` : `${standingFrom}–${standingTo}`}</p>
          <p><span className="font-black">Τρόπος:</span> Manual</p>
          {isSeriesMode && <p><span className="font-black">Νίκες για πρόκριση:</span> {winsRequired}</p>}
          {isSeriesMode && (
            <p><span className="font-black">Μεταφορά προηγούμενου αγώνα:</span> {carryOverEnabled ? "Ναι" : "Όχι"}</p>
          )}
          {isSeriesMode && (
            <p><span className="font-black">Φάση προέλευσης:</span> {carryOverEnabled ? (carryOverSourcePhase?.name || "—") : "—"}</p>
          )}
          {isSeriesMode && <p><span className="font-black">Μέγιστο συνολικό πλήθος αποτελεσμάτων σειράς:</span> {seriesMaxTotalResults}</p>}
          {isSeriesMode && <p><span className="font-black">Προηγούμενοι αγώνες που προσμετρώνται:</span> {countedPreviousResults}</p>}
          {isSeriesMode && <p><span className="font-black">Μέγιστοι νέοι αγώνες προς προγραμματισμό:</span> {maxNewGamesToSchedule}</p>}
          <p><span className="font-black">Διαθέσιμα slots:</span> {isSeriesMode ? sourcePoolCount : estimatedParticipantCount}</p>
          <p><span className="font-black">Χρησιμοποιημένα:</span> {totalSlotsUsed}</p>
          <p><span className="font-black">Έξοδοι:</span> {estimatedOutputSlots}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {matchups.length ? describeSeriesMatchupsFromPhase(data, phase).map((summary, index) => {
          return (
            <div key={summary.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              <p>{summary.label}</p>
              <p className="text-xs text-zinc-500">Έξοδος: {summary.output}</p>
            </div>
          );
        }) : <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500">Δεν υπάρχουν manual slots.</p>}
      </div>
      {sourceValidationMessages.map((message) => <p key={message} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-700">{message}</p>)}
    </section>
  );

  return <>
    <div className="space-y-4">
      {!isStepMode ? (
        <>
          {renderParticipantSourceInputs()}
          {renderMatchupsSection()}
          {renderPreviewSection()}
          {!isSeriesMode && <div className="rounded-lg border border-zinc-200 p-3 text-xs text-zinc-700 bg-zinc-50">
            {`Αξιολόγηση ζευγαρωμάτων: ${matchups.length ? matchups.length : 0} matchup(s).`}
          </div>}
        </>
      ) : (
        <>
          {(activeStep === 1) && renderParticipantSourceInputs()}
          {(activeStep === 2) && renderMatchupsSection()}
          {(activeStep === 3) && renderPreviewSection()}
          {!isSeriesMode && activeStep === 3 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">Για μη-series φάση υπάρχουν επιπλέον ρυθμίσεις.</p>}
        </>
      )}
    </div>
    <input type="hidden" name="carryOverEnabled" value={carryOverEnabled ? "true" : "false"} />
    <input type="hidden" name="carryOverSourcePhaseId" value={carryOverSourcePhaseId} />
    <input type="hidden" name="winsRequired" value={winsRequired} />
    <input
      type="hidden"
      name="participantConfiguration"
      value={JSON.stringify({
        participantSourceType: isSeriesMode ? "standing_positions" : participantSourceType,
        participantSourcePhaseId,
        standingFrom,
        standingTo,
        selectedTeamIds,
        sourceMatchupIds,
        manualSlotCount,
        bracketMethod,
      })}
    />
    <input type="hidden" name="bracketMethod" value={bracketMethod} />
    <input type="hidden" name="matchups" value={JSON.stringify(matchups)} />
    <input type="hidden" name="seriesSourcePhaseIsSeries" value={String(sourceIsSeries)} />
    <input type="hidden" name="seriesSourceValidation" value={JSON.stringify({ isSeriesMode, isSeriesSourceValid: isSeriesStepSourceRangeValid })} />
    <div className="hidden" />
  </>;
}

