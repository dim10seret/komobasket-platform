export type CompetitionLatestMovementRow = {
  id?: unknown;
  organization_id?: unknown;
  season_id?: unknown;
  competition_id?: unknown;
  movement_type?: unknown;
  effective_on?: unknown;
  created_at?: unknown;
};

const includedMovementTypes = new Set(["addition", "departure", "transfer"]);
const text = (value: unknown) => String(value ?? "").trim();

export function selectCompetitionLatestMovements<T extends CompetitionLatestMovementRow>(
  movements: T[],
  scope: { organizationId: string; seasonId: string; competitionId: string },
) {
  return movements
    .filter((movement) => (
      text(movement.organization_id) === scope.organizationId
      && text(movement.season_id) === scope.seasonId
      && text(movement.competition_id) === scope.competitionId
      && includedMovementTypes.has(text(movement.movement_type))
    ))
    .sort((left, right) => {
      const dateOrder = text(right.effective_on).localeCompare(text(left.effective_on));
      if (dateOrder !== 0) return dateOrder;
      const createdOrder = text(right.created_at).localeCompare(text(left.created_at));
      if (createdOrder !== 0) return createdOrder;
      return text(right.id).localeCompare(text(left.id));
    });
}
