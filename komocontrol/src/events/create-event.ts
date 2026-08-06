import type { MatchEvent } from "../types/event";

export function createEvent<T extends Omit<MatchEvent, "id" | "occurredAt">>(event: T): MatchEvent {
  return { ...event, id: crypto.randomUUID(), occurredAt: Date.now() } as MatchEvent;
}
