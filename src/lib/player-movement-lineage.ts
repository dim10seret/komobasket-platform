type MovementLike = {
  competition_id?: unknown;
  competition_name?: unknown;
};

type LegacyMovementLike = MovementLike & {
  player_id?: unknown;
  season_id?: unknown;
  from_team_id?: unknown;
  to_team_id?: unknown;
  movement_type?: unknown;
  effective_on?: unknown;
};

type RosterEvidenceLike = {
  player_id?: unknown;
  season_id?: unknown;
  competition_id?: unknown;
  team_id?: unknown;
  status?: unknown;
  joined_on?: unknown;
  left_on?: unknown;
};

type CompetitionLike = { id?: unknown; name?: unknown };

export type LegacyMovementCompetitionClassification = {
  classification: "SAFE_TO_BACKFILL" | "AMBIGUOUS" | "UNRESOLVED";
  competitionId: string | null;
  candidateCompetitionIds: string[];
};

const text = (value: unknown) => String(value ?? "").trim();

export function getCanonicalMovementCompetitionId(movement: MovementLike) {
  return text(movement.competition_id);
}

export function getCanonicalMovementCompetitionName(movement: MovementLike, competitions: CompetitionLike[]) {
  const competitionId = getCanonicalMovementCompetitionId(movement);
  if (!competitionId) return "—";
  return text(movement.competition_name)
    || text(competitions.find((competition) => text(competition.id) === competitionId)?.name)
    || "—";
}

export function movementMatchesCompetition(movement: MovementLike, competitionId: string) {
  return !competitionId || getCanonicalMovementCompetitionId(movement) === competitionId;
}

export function classifyLegacyMovementCompetition(
  movement: LegacyMovementLike,
  memberships: RosterEvidenceLike[],
): LegacyMovementCompetitionClassification {
  const canonicalCompetitionId = getCanonicalMovementCompetitionId(movement);
  if (canonicalCompetitionId) {
    return {
      classification: "SAFE_TO_BACKFILL",
      competitionId: canonicalCompetitionId,
      candidateCompetitionIds: [canonicalCompetitionId],
    };
  }

  const movementType = text(movement.movement_type);
  const relevantTeamId = movementType === "registration" || movementType === "return"
    ? text(movement.to_team_id)
    : text(movement.from_team_id);
  const effectiveOn = text(movement.effective_on);
  const broadCandidates = memberships.filter((membership) => (
    text(membership.player_id) === text(movement.player_id)
    && text(membership.season_id) === text(movement.season_id)
    && text(membership.team_id) === relevantTeamId
    && Boolean(text(membership.competition_id))
  ));
  const strongCandidates = broadCandidates.filter((membership) => {
    if (movementType === "departure") {
      return text(membership.status) === "departed" && text(membership.left_on) === effectiveOn;
    }
    if (movementType === "transfer") {
      return text(membership.status) === "transferred" && text(membership.left_on) === effectiveOn;
    }
    if (movementType === "registration" || movementType === "return") {
      return text(membership.joined_on) === effectiveOn;
    }
    return false;
  });
  const evidence = strongCandidates.length > 0 ? strongCandidates : broadCandidates;
  const candidateCompetitionIds = [...new Set(evidence.map((membership) => text(membership.competition_id)))].sort();

  if (strongCandidates.length > 0 && candidateCompetitionIds.length === 1) {
    return {
      classification: "SAFE_TO_BACKFILL",
      competitionId: candidateCompetitionIds[0],
      candidateCompetitionIds,
    };
  }
  if (candidateCompetitionIds.length > 1) {
    return { classification: "AMBIGUOUS", competitionId: null, candidateCompetitionIds };
  }
  return { classification: "UNRESOLVED", competitionId: null, candidateCompetitionIds };
}
