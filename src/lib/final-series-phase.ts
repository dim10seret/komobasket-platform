import { classifySeriesBracketEntry } from "@/lib/series-carry-over";

type RecordLike = Record<string, unknown>;

export type FinalSeriesTargetKind = "final" | "small_final";

const recordValue = (value: unknown): RecordLike => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordLike
    : {}
);

const jsonRecord = (value: unknown): RecordLike => {
  if (typeof value !== "string") return recordValue(value);
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return {};
  }
};

const phaseSettings = (phase: RecordLike) => ({
  ...jsonRecord(phase.settings_json),
  ...jsonRecord(phase.rule_settings_json),
});

const competitiveSlotToken = (value: unknown): string | null => {
  const slot = recordValue(value);
  const type = String(slot.type ?? "").trim();
  if (type === "manual" || type === "fixed_team") {
    const teamId = String(slot.teamId ?? "").trim();
    return teamId ? `team:${teamId}` : null;
  }
  if (type === "standing_position") {
    const position = String(slot.position ?? "").trim();
    return position ? `standing:${position}` : null;
  }
  if (type === "matchup_winner" || type === "matchup_loser") {
    const matchupId = String(slot.matchupId ?? "").trim();
    return matchupId ? `${type}:${matchupId}` : null;
  }
  return null;
};

const sameIds = (left: string[], right: readonly string[]) => (
  left.length === right.length
  && [...left].sort().every((value, index) => value === [...right].sort()[index])
);

export function getCompetitiveSeriesSourceMatchupIds(
  phase: RecordLike | null | undefined,
): readonly [string, string] | null {
  if (!phase) return null;
  const format = String(phase.format ?? phase.phase_kind ?? "").trim().toLowerCase();
  if (format !== "series") return null;

  const bracket = recordValue(phaseSettings(phase).bracketConfiguration);
  if (!Array.isArray(bracket.matchups) || bracket.matchups.length !== 2) return null;

  const matchupIds: string[] = [];
  const participantTokens = new Set<string>();
  for (const rawMatchup of bracket.matchups) {
    const matchup = recordValue(rawMatchup);
    const id = String(matchup.id ?? "").trim();
    if (!id || matchupIds.includes(id)) return null;
    const slotA = recordValue(matchup.slotA);
    const slotB = recordValue(matchup.slotB);
    const classification = classifySeriesBracketEntry({ id, slotA, slotB } as never);
    if (classification.kind !== "playable_matchup") return null;
    const slotAToken = competitiveSlotToken(slotA);
    const slotBToken = competitiveSlotToken(slotB);
    if (!slotAToken || !slotBToken || slotAToken === slotBToken) return null;
    participantTokens.add(slotAToken);
    participantTokens.add(slotBToken);
    matchupIds.push(id);
  }

  if (participantTokens.size !== 4) return null;
  return [matchupIds[0], matchupIds[1]];
}

export function buildFinalSeriesTargetConfiguration(
  sourcePhaseId: string,
  sourceMatchupIds: readonly [string, string],
  targetMatchupId: string,
  targetKind: FinalSeriesTargetKind,
) {
  const slotType = targetKind === "final" ? "matchup_winner" : "matchup_loser";
  const participantSourceType = targetKind === "final" ? "matchup_winners" : "matchup_losers";
  return {
    participantConfiguration: {
      participantSourceType,
      participantSourcePhaseId: sourcePhaseId,
      sourceMatchupIds: [...sourceMatchupIds],
      selectedTeamIds: [],
      manualSlotCount: 0,
      bracketMethod: "manual",
    },
    bracketConfiguration: {
      method: "manual",
      participantCount: 2,
      matchups: [{
        id: targetMatchupId,
        slotA: {
          id: `${targetMatchupId}-a`,
          type: slotType,
          matchupId: sourceMatchupIds[0],
        },
        slotB: {
          id: `${targetMatchupId}-b`,
          type: slotType,
          matchupId: sourceMatchupIds[1],
        },
      }],
    },
  };
}

export function isCanonicalFinalSeriesSibling(
  phase: RecordLike,
  sourcePhaseId: string,
  sourceMatchupIds: readonly [string, string],
  targetKind: FinalSeriesTargetKind,
) {
  const format = String(phase.format ?? phase.phase_kind ?? "").trim().toLowerCase();
  const previousPhaseId = String(phase.previous_phase_id ?? phase.previousPhaseId ?? "").trim();
  if (format !== "series" || previousPhaseId !== sourcePhaseId) return false;

  const settings = phaseSettings(phase);
  const participant = recordValue(settings.participantConfiguration);
  const expectedSourceType = targetKind === "final" ? "matchup_winners" : "matchup_losers";
  const configuredSourceType = String(
    participant.participantSourceType ?? participant.sourceType ?? "",
  ).trim();
  const configuredSourcePhaseId = String(
    participant.participantSourcePhaseId ?? participant.sourcePhaseId ?? previousPhaseId,
  ).trim();
  if (configuredSourceType !== expectedSourceType || configuredSourcePhaseId !== sourcePhaseId) return false;

  const configuredMatchupIds = Array.isArray(participant.sourceMatchupIds)
    ? participant.sourceMatchupIds.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (configuredMatchupIds.length && !sameIds(configuredMatchupIds, sourceMatchupIds)) return false;

  const bracket = recordValue(settings.bracketConfiguration);
  if (bracket.participantCount !== undefined && Number(bracket.participantCount) !== 2) return false;
  if (!Array.isArray(bracket.matchups) || bracket.matchups.length !== 1) return false;
  const matchup = recordValue(bracket.matchups[0]);
  const slots = [recordValue(matchup.slotA), recordValue(matchup.slotB)];
  const expectedSlotType = targetKind === "final" ? "matchup_winner" : "matchup_loser";
  if (slots.some((slot) => String(slot.type ?? "").trim() !== expectedSlotType)) return false;
  const referencedIds = slots.map((slot) => String(slot.matchupId ?? "").trim()).filter(Boolean);
  return sameIds(referencedIds, sourceMatchupIds);
}
