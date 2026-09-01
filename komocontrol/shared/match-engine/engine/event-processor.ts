import { EventType } from "../types/event-type.js";
import { pairedTurnoverForSteal } from "./event-dependencies.js";
import type { FoulEvent, MatchEvent } from "../types/event.js";
import type { MatchState } from "../types/match-state.js";
import { createPlayer } from "../models/player.js";
import { ClockEngine } from "./clock-engine.js";
import { PeriodEngine } from "./period-engine.js";
import { PossessionEngine } from "./possession-engine.js";
import { DefensivePlayProcessor } from "./processors/defensive-play-processor.js";
import { FoulProcessor } from "./processors/foul-processor.js";
import { FreeThrowProcessor } from "./processors/free-throw-processor.js";
import { LineupSetProcessor } from "./processors/lineup-set-processor.js";
import { MissedShotProcessor } from "./processors/missed-shot-processor.js";
import { ReboundProcessor } from "./processors/rebound-processor.js";
import { SubstitutionProcessor } from "./processors/substitution-processor.js";
import { ThreePointProcessor } from "./processors/three-point-processor.js";
import { TimeoutProcessor } from "./processors/timeout-processor.js";
import { TurnoverProcessor } from "./processors/turnover-processor.js";
import { TwoPointProcessor } from "./processors/two-point-processor.js";

export class EventProcessor {
  private readonly periodEngine: PeriodEngine;
  private readonly possessionEngine: PossessionEngine;
  private readonly twoPointProcessor: TwoPointProcessor;
  private readonly threePointProcessor: ThreePointProcessor;
  private readonly turnoverProcessor: TurnoverProcessor;
  private readonly foulProcessor: FoulProcessor;
  private readonly freeThrowProcessor: FreeThrowProcessor;
  private readonly substitutionProcessor: SubstitutionProcessor;
  private readonly timeoutProcessor: TimeoutProcessor;
  private readonly clockEngine: ClockEngine;
  private readonly reboundProcessor: ReboundProcessor;
  private readonly defensivePlayProcessor: DefensivePlayProcessor;
  private readonly lineupSetProcessor: LineupSetProcessor;
  private readonly missedShotProcessor: MissedShotProcessor;

  constructor(
    periodEngine = new PeriodEngine(),
    possessionEngine = new PossessionEngine(),
    twoPointProcessor = new TwoPointProcessor(),
    threePointProcessor = new ThreePointProcessor(),
    turnoverProcessor = new TurnoverProcessor(),
    foulProcessor = new FoulProcessor(),
    freeThrowProcessor = new FreeThrowProcessor(),
    substitutionProcessor = new SubstitutionProcessor(),
    timeoutProcessor = new TimeoutProcessor(),
    clockEngine = new ClockEngine(),
    reboundProcessor = new ReboundProcessor(),
    defensivePlayProcessor = new DefensivePlayProcessor(),
    lineupSetProcessor = new LineupSetProcessor(),
    missedShotProcessor = new MissedShotProcessor(),
  ) {
    this.periodEngine = periodEngine;
    this.possessionEngine = possessionEngine;
    this.twoPointProcessor = twoPointProcessor;
    this.threePointProcessor = threePointProcessor;
    this.turnoverProcessor = turnoverProcessor;
    this.foulProcessor = foulProcessor;
    this.freeThrowProcessor = freeThrowProcessor;
    this.substitutionProcessor = substitutionProcessor;
    this.timeoutProcessor = timeoutProcessor;
    this.clockEngine = clockEngine;
    this.reboundProcessor = reboundProcessor;
    this.defensivePlayProcessor = defensivePlayProcessor;
    this.lineupSetProcessor = lineupSetProcessor;
    this.missedShotProcessor = missedShotProcessor;
  }

  process(
    state: MatchState,
    event: MatchEvent,
    priorEvents: readonly MatchEvent[] = [],
  ): void {
    if (
      !isFoulEvent(event)
      && event.type !== EventType.FREE_THROW
      && event.type !== EventType.PENALTY_ADMINISTRATION_ENDED
      && event.type !== EventType.SUBSTITUTION
      && event.type !== EventType.ROSTER_PLAYER_ADDED
      && event.type !== EventType.CLOCK_START
      && event.type !== EventType.CLOCK_STOP
      && event.type !== EventType.CLOCK_SET
    ) state.penaltyResolution = undefined;

    switch (event.type) {
      case EventType.MATCH_START:
        state.started = true;
        state.clock = this.periodEngine.durationFor(state.period, state.rules);
        state.clockRunning = false;
        return;
      case EventType.ROSTER_PLAYER_ADDED: {
        const target = event.team === "HOME" ? state.home : state.away;
        target.players.push(createPlayer({
          playerId: event.playerId,
          displayName: event.displayName,
          shirtNumber: event.shirtNumber,
          team: event.team,
          onCourt: false,
        }));
        return;
      }
      case EventType.LINEUP_SET:
        this.lineupSetProcessor.process(state, event);
        return;
      case EventType.MATCH_END:
        state.finished = true;
        state.clock = 0;
        state.clockRunning = false;
        return;
      case EventType.PERIOD_START:
        this.periodEngine.start(state, event.period);
        return;
      case EventType.PERIOD_END:
        this.periodEngine.end(state, event.period);
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
        this.defensivePlayProcessor.processSteal(state, event, Boolean(pairedTurnoverForSteal(event, priorEvents)));
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
        this.possessionEngine.set(state, event.team);
        this.twoPointProcessor.process(state, event);
        return;
      case EventType.TWO_POINT_MISSED:
        this.possessionEngine.set(state, event.team);
        this.missedShotProcessor.processTwoPoint(state, event);
        return;
      case EventType.THREE_POINT:
        this.possessionEngine.set(state, event.team);
        this.threePointProcessor.process(state, event);
        return;
      case EventType.THREE_POINT_MISSED:
        this.possessionEngine.set(state, event.team);
        this.missedShotProcessor.processThreePoint(state, event);
        return;
      case EventType.TURNOVER:
        this.turnoverProcessor.process(state, event);
        return;
      case EventType.PERSONAL_FOUL:
      case EventType.TECHNICAL_FOUL:
      case EventType.DISRUPTIVE_FOUL:
      case EventType.FLAGRANT_FOUL:
      case EventType.DISQUALIFYING_FOUL:
        this.foulProcessor.process(state, event as FoulEvent, priorEvents);
        return;
      case EventType.FREE_THROW:
        this.freeThrowProcessor.process(state, event);
        return;
      case EventType.PENALTY_ADMINISTRATION_ENDED:
        this.freeThrowProcessor.endAdministration(state, event);
        return;
      case EventType.SUBSTITUTION:
        this.substitutionProcessor.process(state, event);
        return;
      case EventType.TIMEOUT:
        this.timeoutProcessor.process(state, event);
        return;
    }
  }
}

function isFoulEvent(event: MatchEvent): event is FoulEvent {
  return event.type === EventType.PERSONAL_FOUL
    || event.type === EventType.TECHNICAL_FOUL
    || event.type === EventType.DISRUPTIVE_FOUL
    || event.type === EventType.FLAGRANT_FOUL
    || event.type === EventType.DISQUALIFYING_FOUL;
}
