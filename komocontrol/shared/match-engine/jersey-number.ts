import type { ShirtNumber } from "./types/player.js";

export type ShirtNumberNormalizationOptions = {
  allowNull?: boolean;
  allowLegacyNumber?: boolean;
  trim?: boolean;
};

export function isShirtNumber(value: unknown): value is ShirtNumber {
  return typeof value === "string" && /^(?:0|00|[1-9][0-9]?)$/.test(value);
}

export function normalizeShirtNumber(
  value: unknown,
  options: ShirtNumberNormalizationOptions = {},
): ShirtNumber | null {
  const allowNull = options.allowNull === true;
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new Error("Invalid shirt number.");
  }

  if (typeof value === "number") {
    if (!options.allowLegacyNumber || !Number.isInteger(value) || value < 0 || value > 99) {
      throw new Error("Invalid shirt number.");
    }
    return String(value) as ShirtNumber;
  }

  if (typeof value !== "string") throw new Error("Invalid shirt number.");
  const normalized = options.trim ? value.trim() : value;
  if (!normalized || !isShirtNumber(normalized)) throw new Error("Invalid shirt number.");
  return normalized;
}

function shirtNumberRank(value: ShirtNumber): number {
  if (value === "0") return 0;
  if (value === "00") return 1;
  return Number(value) + 1;
}

export function compareShirtNumbers(left: ShirtNumber | null, right: ShirtNumber | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return shirtNumberRank(left) - shirtNumberRank(right);
}
