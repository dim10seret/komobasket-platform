import { EventType } from "../types/event-type";
import type { MatchEvent } from "../types/event";
import type { MatchState } from "../types/match-state";
import { PossessionEngine } from "./possession-engine";
import { QuarterEngine } from "./quarter-engine";
import { TwoPointProcessor } from "./processors/two-point-processor";
import { ThreePointProcessor } from "./processors/three-point-processor";
import { TurnoverProcessor } from "./processors/turnover-processor";
import { PersonalFoulProcessor } from "./processors/personal-foul-processor";
import { ShootingFoulProcessor } from "./processors/shooting-foul-processor";
import { FreeThrowProcessor } from "./processors/free-throw-processor";
import { SubstitutionProcessor } from "./processors/substitution-processor";
import { TimeoutProcessor } from "./processors/timeout-processor";
import { TechnicalFoulProcessor } from "./processors/technical-foul-processor";
import { UnsportsmanlikeFoulProcessor } from "./processors/unsportsmanlike-foul-processor";
import { DisqualifyingFoulProcessor } from "./processors/disqualifying-foul-processor";
import { ClockEngine } from "./clock-engine";
import { ReboundProcessor } from "./processors/rebound-processor";
import { DefensivePlayProcessor } from "./processors/defensive-play-processor";
import { LineupSetProcessor } from "./processors/lineup-set-processor";
import { MissedShotProcessor } from "./processors/missed-shot-processor";

export class EventProcessor {
  private readonly quarterEngine: QuarterEngine;
  private readonly possessionEngine: PossessionEngine;
  private readonly twoPointProcessor: TwoPointProcessor;
  private readonly threePointProcessor: ThreePointProcessor;
  private readonly turnoverProcessor: TurnoverProcessor;
  private readonly personalFoulProcessor: PersonalFoulProcessor;
  private readonly shootingFoulProcessor: ShootingFoulProcessor;
  private readonly freeThrowProcessor: FreeThrowProcessor;
  private readonly substitutionProcessor: SubstitutionProcessor;
  private readonly timeoutProcessor: TimeoutProcessor;
  private readonly technicalFoulProcessor: TechnicalFoulProcessor;
  private readonly unsportsmanlikeFoulProcessor: UnsportsmanlikeFoulProcessor;
  private readonly disqualifyingFoulProcessor: DisqualifyingFoulProcessor;
  private readonly clockEngine: ClockEngine;
  private readonly reboundProcessor: ReboundProcessor;
  private readonly defensivePlayProcessor: DefensivePlayProcessor;
  private readonly lineupSetProcessor: LineupSetProcessor;
  private readonly missedShotProcessor: MissedShotProcessor;

  constructor(
    quarterEngine = new QuarterEngine(),
    possessionEngine = new PossessionEngine(),
    twoPointProcessor = new TwoPointProcessor(),
    threePointProcessor = new ThreePointProcessor(),
    turnoverProcessor = new TurnoverProcessor(),
    personalFoulProcessor = new PersonalFoulProcessor(),
    shootingFoulProcessor = new ShootingFoulProcessor(),
    freeThrowProcessor = new FreeThrowProcessor(),
    substitutionProcessor = new SubstitutionProcessor(),
    timeoutProcessor = new TimeoutProcessor(),
    technicalFoulProcessor = new TechnicalFoulProcessor(),
    unsportsmanlikeFoulProcessor = new UnsportsmanlikeFoulProcessor(),
    disqualifyingFoulProcessor = new DisqualifyingFoulProcessor(),
    clockEngine = new ClockEngine(),
    reboundProcessor = new ReboundProcessor(),
    defensivePlayProcessor = new DefensivePlayProcessor(),
    lineupSetProcessor = new LineupSetProcessor(),
    missedShotProcessor = new MissedShotProcessor(),
  ) {
    this.quarterEngine = quarterEngine;
    this.possessionEngine = possessionEngine;
    this.twoPointProcessor = twoPointProcessor;
    this.threePointProcessor = threePointProcessor;
    this.turnoverProcessor = turnoverProcessor;
    this.personalFoulProcessor = personalFoulProcessor;
    this.shootingFoulProcessor = shootingFoulProcessor;
    this.freeThrowProcessor = freeThrowProcessor;
    this.substitutionProcessor = substitutionProcessor;
    this.timeoutProcessor = timeoutProcessor;
    this.technicalFoulProcessor = technicalFoulProcessor;
    this.unsportsmanlikeFoulProcessor = unsportsmanlikeFoulProcessor;
    this.disqualifyingFoulProcessor = disqualifyingFoulProcessor;
    this.clockEngine = clockEngine;
    this.reboundProcessor = reboundProcessor;
    this.defensivePlayProcessor = defensivePlayProcessor;
    this.lineupSetProcessor = lineupSetProcessor;
    this.missedShotProcessor = missedShotProcessor;
  }

  process(state: MatchState, event: MatchEvent): void {
    switch (event.type) {
      case EventType.MATCH_START:
        state.started = true;
        state.clock = 600;
        state.clockRunning = false;
        return;
      case EventType.LINEUP_SET:
        this.lineupSetProcessor.process(state, event);
        return;
      case EventType.MATCH_END:
        state.finished = true;
        state.clock = 0;
        state.clockRunning = false;
        return;
      case EventType.QUARTER_START:
      case EventType.OVERTIME_START:
        this.quarterEngine.start(state, event.quarter);
        return;
      case EventType.QUARTER_END:
        this.quarterEngine.end(state, event.quarter);
        return;
      case EventType.JUMP_BALL:
        this.possessionEngine.setOpeningJumpBall(state, event.possession);
        return;
      case EventType.ALTERNATING_POSSESSION:
        this.possessionEngine.useAlternatingPossession(state);
        return;
      case EventType.REBOUND:
        this.reboundProcessor.process(state, event);
        return;
      case EventType.STEAL:
        this.defensivePlayProcessor.processSteal(state, event);
        return;
      case EventType.BLOCK:
        this.defensivePlayProcessor.processBlock(state, event);
        return;
      case EventType.CLOCK_START:
        this.clockEngine.start(state);
        return;
      case EventType.CLOCK_STOP:
        this.clockEngine.stop(state);
        return;
      case EventType.CLOCK_SET:
        this.clockEngine.set(state, event.remainingSeconds);
        return;
      case EventType.TWO_POINT:
        this.twoPointProcessor.process(state, event);
        return;
      case EventType.TWO_POINT_MISSED:
        this.missedShotProcessor.processTwoPoint(state, event);
        return;
      case EventType.THREE_POINT:
        this.threePointProcessor.process(state, event);
        return;
      case EventType.THREE_POINT_MISSED:
        this.missedShotProcessor.processThreePoint(state, event);
        return;
      case EventType.TURNOVER:
        this.turnoverProcessor.process(state, event);
        return;
      case EventType.PERSONAL_FOUL:
        this.personalFoulProcessor.process(state, event);
        return;
      case EventType.SHOOTING_FOUL:
        this.shootingFoulProcessor.process(state, event);
        return;
      case EventType.FREE_THROW:
        this.freeThrowProcessor.process(state, event);
        return;
      case EventType.SUBSTITUTION:
        this.substitutionProcessor.process(state, event);
        return;
      case EventType.TIMEOUT:
        this.timeoutProcessor.process(state, event);
        return;
      case EventType.TECHNICAL_FOUL:
        this.technicalFoulProcessor.process(state, event);
        return;
      case EventType.UNSPORTSMANLIKE_FOUL:
        this.unsportsmanlikeFoulProcessor.process(state, event);
        return;
      case EventType.DISQUALIFYING_FOUL:
        this.disqualifyingFoulProcessor.process(state, event);
        return;
      default:
        return;
    }
  }
}
