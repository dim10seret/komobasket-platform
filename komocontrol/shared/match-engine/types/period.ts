export const PeriodKind = {
  REGULATION: "REGULATION",
  OVERTIME: "OVERTIME",
} as const;

export type MatchPeriod =
  | { readonly kind: typeof PeriodKind.REGULATION; readonly index: number }
  | { readonly kind: typeof PeriodKind.OVERTIME; readonly index: number };

export function regulationPeriod(index: number): MatchPeriod {
  assertPositiveIndex(index);
  return { kind: PeriodKind.REGULATION, index };
}

export function overtimePeriod(index: number): MatchPeriod {
  assertPositiveIndex(index);
  return { kind: PeriodKind.OVERTIME, index };
}

export function isMatchPeriod(value: unknown): value is MatchPeriod {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; index?: unknown };
  return (candidate.kind === PeriodKind.REGULATION || candidate.kind === PeriodKind.OVERTIME)
    && Number.isInteger(candidate.index)
    && Number(candidate.index) >= 1;
}

export function periodsEqual(left: MatchPeriod, right: MatchPeriod): boolean {
  return left.kind === right.kind && left.index === right.index;
}

function assertPositiveIndex(index: number): void {
  if (!Number.isInteger(index) || index < 1) throw new Error("Match period index must be a positive integer.");
}
