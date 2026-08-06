import { EventType } from "./event-type";
import type { Quarter } from "./quarter";
import type { TeamSide } from "./team-side";

export interface EventMetadata {
  id: string;
  occurredAt: number;
  sequence: number;
}

export type MatchEvent =
  | (EventMetadata & { type: typeof EventType.MATCH_START })
  | (EventMetadata & { type: typeof EventType.MATCH_END })
  | (EventMetadata & { type: typeof EventType.LINEUP_SET; team: TeamSide; playerIds: string[] })
  | (EventMetadata & { type: typeof EventType.QUARTER_START; quarter: Quarter })
  | (EventMetadata & { type: typeof EventType.QUARTER_END; quarter: Quarter })
  | (EventMetadata & { type: typeof EventType.OVERTIME_START; quarter: Quarter })
  | (EventMetadata & { type: typeof EventType.JUMP_BALL; possession: TeamSide })
  | (EventMetadata & { type: typeof EventType.ALTERNATING_POSSESSION })
  | (EventMetadata & { type: typeof EventType.REBOUND; team: TeamSide; playerId: string; offensive: boolean })
  | (EventMetadata & { type: typeof EventType.STEAL; team: TeamSide; playerId: string })
  | (EventMetadata & { type: typeof EventType.BLOCK; team: TeamSide; playerId: string })
  | (EventMetadata & { type: typeof EventType.CLOCK_START })
  | (EventMetadata & { type: typeof EventType.CLOCK_STOP })
  | (EventMetadata & { type: typeof EventType.CLOCK_SET; remainingSeconds: number })
  | (EventMetadata & { type: typeof EventType.TWO_POINT; team: TeamSide; playerId: string; assistPlayerId?: string })
  | (EventMetadata & { type: typeof EventType.TWO_POINT_MISSED; team: TeamSide; playerId: string })
  | (EventMetadata & { type: typeof EventType.THREE_POINT; team: TeamSide; playerId: string; assistPlayerId?: string })
  | (EventMetadata & { type: typeof EventType.THREE_POINT_MISSED; team: TeamSide; playerId: string })
  | (EventMetadata & {
      type: typeof EventType.FREE_THROW;
      team: TeamSide;
      playerId: string;
      made: boolean;
      isFinalAttempt: boolean;
    })
  | (EventMetadata & { type: typeof EventType.PERSONAL_FOUL; team: TeamSide; playerId: string; fouledPlayerId?: string })
  | (EventMetadata & {
      type: typeof EventType.SHOOTING_FOUL;
      team: TeamSide;
      playerId: string;
      fouledPlayerId: string;
      freeThrows: 1 | 2 | 3;
    })
  | (EventMetadata & { type: typeof EventType.TECHNICAL_FOUL; team: TeamSide; playerId?: string; freeThrowPlayerId: string })
  | (EventMetadata & { type: typeof EventType.UNSPORTSMANLIKE_FOUL; team: TeamSide; playerId: string; fouledPlayerId: string })
  | (EventMetadata & { type: typeof EventType.DISQUALIFYING_FOUL; team: TeamSide; playerId: string; freeThrowPlayerId: string })
  | (EventMetadata & { type: typeof EventType.TURNOVER; team: TeamSide; playerId: string })
  | (EventMetadata & { type: typeof EventType.SUBSTITUTION; team: TeamSide; playerInId: string; playerOutId: string })
  | (EventMetadata & { type: typeof EventType.TIMEOUT; team: TeamSide });
