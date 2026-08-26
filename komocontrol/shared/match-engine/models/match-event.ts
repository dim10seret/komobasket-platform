import { MATCH_EVENT_SCHEMA_VERSION, type MatchEvent } from "../types/event.js";

export function isMatchEvent(value: unknown): value is MatchEvent {
  return typeof value === "object"
    && value !== null
    && "schemaVersion" in value
    && value.schemaVersion === MATCH_EVENT_SCHEMA_VERSION
    && "id" in value
    && "type" in value
    && "sequence" in value;
}
