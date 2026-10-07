import {
  compareShirtNumbers,
  normalizeShirtNumber,
} from "../../komocontrol/shared/match-engine/jersey-number";
import type { ShirtNumber } from "../../komocontrol/shared/match-engine/types/player";

export type JerseyNumber = ShirtNumber;

export function normalizeOptionalJerseyNumber(value: unknown): JerseyNumber | null {
  try {
    return normalizeShirtNumber(value, { allowNull: true, allowLegacyNumber: true, trim: true });
  } catch {
    throw new Error("Ο αριθμός φανέλας πρέπει να είναι 0, 00 ή από 1 έως 99.");
  }
}

export function compareJerseyNumbers(
  left: string | null,
  right: string | null,
  direction: "asc" | "desc" = "asc",
): number {
  const normalizedLeft = normalizeOptionalJerseyNumber(left);
  const normalizedRight = normalizeOptionalJerseyNumber(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return compareShirtNumbers(normalizedLeft, normalizedRight);
  }
  const result = compareShirtNumbers(normalizedLeft, normalizedRight);
  return direction === "asc" ? result : -result;
}

export const JERSEY_NUMBER_SQL_ORDER = `CASE
  WHEN shirt_number='0' THEN 0
  WHEN shirt_number='00' THEN 1
  ELSE CAST(shirt_number AS INTEGER)+1
END`;
