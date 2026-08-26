import { EventType } from "./event-type.js";
import type {
  BenchFoulOffender,
  NonContactFoulContext,
  NonShootingFoulContext,
  PlayerFoulOffender,
  ShootingFoulContext,
  TechnicalFoulCategory,
} from "./foul.js";
import { TechnicalFoulCategory as TechnicalCategory } from "./foul.js";
import type { MatchPeriod } from "./period.js";
import type { TeamSide } from "./team-side.js";

export const MATCH_EVENT_SCHEMA_VERSION = 2 as const;

export interface EventMetadata {
  schemaVersion: typeof MATCH_EVENT_SCHEMA_VERSION;
  id: string;
  occurredAt: number;
  sequence: number;
}

type ShotEvent = EventMetadata & {
  team: TeamSide;
  playerId: string;
  stoppageId?: string;
};

export type ScoringShotEvent =
  | (ShotEvent & { type: typeof EventType.TWO_POINT; assistPlayerId?: string })
  | (ShotEvent & { type: typeof EventType.TWO_POINT_MISSED })
  | (ShotEvent & { type: typeof EventType.THREE_POINT; assistPlayerId?: string })
  | (ShotEvent & { type: typeof EventType.THREE_POINT_MISSED });

type FoulMetadata = EventMetadata & {
  team: TeamSide;
  stoppageId: string;
};

type NonShootingFoulFacts = {
  context: NonShootingFoulContext;
  fouledPlayerId?: string;
  relatedShotEventId?: never;
};

type SevereNonShootingFoulFacts = {
  context: NonShootingFoulContext;
  fouledPlayerId: string;
  relatedShotEventId?: never;
};

type ShootingFoulFacts = {
  context: ShootingFoulContext;
  fouledPlayerId: string;
  relatedShotEventId: string;
};

type DirectDisqualificationFacts = {
  context: NonContactFoulContext;
  fouledPlayerId?: never;
  relatedShotEventId?: never;
};

type ContactFoulDetails = SevereNonShootingFoulFacts | ShootingFoulFacts;

export type PersonalFoulEvent = FoulMetadata & {
  type: typeof EventType.PERSONAL_FOUL;
  offender: PlayerFoulOffender;
} & (NonShootingFoulFacts | ShootingFoulFacts);

export type TechnicalFoulEvent = FoulMetadata & {
  type: typeof EventType.TECHNICAL_FOUL;
  context: NonContactFoulContext;
  fouledPlayerId?: never;
  relatedShotEventId?: never;
} & (
  | { offender: PlayerFoulOffender; category: TechnicalFoulCategory }
  | { offender: BenchFoulOffender; category: typeof TechnicalCategory.CATEGORY_1 }
);

export type DisruptiveFoulEvent = FoulMetadata & {
  type: typeof EventType.DISRUPTIVE_FOUL;
  offender: PlayerFoulOffender;
} & (SevereNonShootingFoulFacts | ShootingFoulFacts);

export type FlagrantFoulEvent = FoulMetadata & {
  type: typeof EventType.FLAGRANT_FOUL;
  offender: PlayerFoulOffender;
} & (SevereNonShootingFoulFacts | ShootingFoulFacts);

export type DisqualifyingFoulEvent = FoulMetadata & {
  type: typeof EventType.DISQUALIFYING_FOUL;
} & (
  | ({ offender: PlayerFoulOffender } & (ContactFoulDetails | DirectDisqualificationFacts))
  | ({ offender: BenchFoulOffender } & DirectDisqualificationFacts)
);

export type FoulEvent =
  | PersonalFoulEvent
  | TechnicalFoulEvent
  | DisruptiveFoulEvent
  | FlagrantFoulEvent
  | DisqualifyingFoulEvent;

export type MatchEvent =
  | (EventMetadata & { type: typeof EventType.MATCH_START })
  | (EventMetadata & { type: typeof EventType.MATCH_END })
  | (EventMetadata & { type: typeof EventType.LINEUP_SET; team: TeamSide; playerIds: string[] })
  | (EventMetadata & { type: typeof EventType.PERIOD_START; period: MatchPeriod })
  | (EventMetadata & { type: typeof EventType.PERIOD_END; period: MatchPeriod })
  | (EventMetadata & { type: typeof EventType.JUMP_BALL; possession: TeamSide })
  | (EventMetadata & { type: typeof EventType.ALTERNATING_POSSESSION })
  | (EventMetadata & { type: typeof EventType.REBOUND; team: TeamSide; playerId: string; offensive: boolean })
  | (EventMetadata & { type: typeof EventType.STEAL; team: TeamSide; playerId: string })
  | (EventMetadata & { type: typeof EventType.BLOCK; team: TeamSide; playerId: string })
  | (EventMetadata & { type: typeof EventType.CLOCK_START })
  | (EventMetadata & { type: typeof EventType.CLOCK_STOP })
  | (EventMetadata & { type: typeof EventType.CLOCK_SET; remainingSeconds: number })
  | ScoringShotEvent
  | (EventMetadata & {
      type: typeof EventType.FREE_THROW;
      team: TeamSide;
      penaltyId: string;
      attemptIndex: number;
      playerId: string;
      made: boolean;
    })
  | FoulEvent
  | (EventMetadata & { type: typeof EventType.TURNOVER; team: TeamSide; playerId: string })
  | (EventMetadata & { type: typeof EventType.SUBSTITUTION; team: TeamSide; playerInId: string; playerOutId: string })
  | (EventMetadata & { type: typeof EventType.TIMEOUT; team: TeamSide });
