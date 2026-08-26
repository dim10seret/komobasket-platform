import { EventType } from "../types/event-type.js";
import type { FoulEvent, MatchEvent } from "../types/event.js";
import { penaltyIdFor } from "../types/penalty.js";

export function dependentEventIds(
  events: readonly MatchEvent[],
  sourceEventId: string,
): string[] {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const sourceFoulByPenaltyId = new Map(
    events
      .filter(isFoulEvent)
      .map((event) => [penaltyIdFor(event.id), event.id]),
  );
  const children = new Map<string, Set<string>>();

  for (const event of events) {
    if (isFoulEvent(event) && "relatedShotEventId" in event && event.relatedShotEventId) {
      addChild(children, event.relatedShotEventId, event.id);
    }
    if (event.type === EventType.FREE_THROW) {
      const foulEventId = sourceFoulByPenaltyId.get(event.penaltyId);
      if (foulEventId) addChild(children, foulEventId, event.id);
    }
  }

  const descendants = new Set<string>();
  const pending = [...(children.get(sourceEventId) ?? [])];
  while (pending.length > 0) {
    const eventId = pending.shift();
    if (!eventId || descendants.has(eventId)) continue;
    descendants.add(eventId);
    pending.push(...(children.get(eventId) ?? []));
  }

  return [...descendants].sort((leftId, rightId) => {
    const left = eventById.get(leftId);
    const right = eventById.get(rightId);
    if (!left && !right) return leftId.localeCompare(rightId);
    if (!left) return 1;
    if (!right) return -1;
    return left.sequence - right.sequence || left.id.localeCompare(right.id);
  });
}

function addChild(children: Map<string, Set<string>>, parentId: string, childId: string): void {
  const existing = children.get(parentId) ?? new Set<string>();
  existing.add(childId);
  children.set(parentId, existing);
}

function isFoulEvent(event: MatchEvent): event is FoulEvent {
  return event.type === EventType.PERSONAL_FOUL
    || event.type === EventType.TECHNICAL_FOUL
    || event.type === EventType.DISRUPTIVE_FOUL
    || event.type === EventType.FLAGRANT_FOUL
    || event.type === EventType.DISQUALIFYING_FOUL;
}
