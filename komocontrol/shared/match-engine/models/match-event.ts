import type { MatchEvent } from "../types/event.js";

export function isMatchEvent(value: unknown): value is MatchEvent {
  return typeof value === "object" && value !== null && "id" in value && "type" in value && "sequence" in value;
}
