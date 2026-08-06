import { EventType } from "../types/event-type";
import type { EventType as EventTypeValue } from "../types/event-type";

export class RulesEngine {
  supports(type: EventTypeValue): boolean {
    const supported: ReadonlySet<EventTypeValue> = new Set([
      EventType.MATCH_START, EventType.MATCH_END, EventType.QUARTER_START,
      EventType.LINEUP_SET,
      EventType.QUARTER_END, EventType.OVERTIME_START, EventType.JUMP_BALL,
      EventType.CLOCK_START, EventType.CLOCK_STOP, EventType.CLOCK_SET,
      EventType.ALTERNATING_POSSESSION,
      EventType.REBOUND,
      EventType.STEAL, EventType.BLOCK,
      EventType.TWO_POINT, EventType.THREE_POINT,
      EventType.TWO_POINT_MISSED, EventType.THREE_POINT_MISSED,
      EventType.TURNOVER,
      EventType.PERSONAL_FOUL,
      EventType.SHOOTING_FOUL,
      EventType.FREE_THROW,
      EventType.SUBSTITUTION,
      EventType.TIMEOUT,
      EventType.TECHNICAL_FOUL,
      EventType.UNSPORTSMANLIKE_FOUL,
      EventType.DISQUALIFYING_FOUL,
    ]);
    return supported.has(type);
  }
}
