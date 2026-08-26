import { cloneMatchState, createMatch, type CreateMatchOptions } from "../models/match.js";
import type { MatchEvent } from "../types/event.js";
import type { EventRejectionReason, EventResult } from "../types/event-result.js";
import type { Match } from "../types/match.js";
import type { MatchState } from "../types/match-state.js";
import { EventProcessor } from "./event-processor.js";
import { RulesEngine } from "./rules-engine.js";
import { TransactionManager } from "./transaction-manager.js";
import { ValidationEngine } from "./validation-engine.js";

type ReplayResult =
  | { accepted: true; match: Match }
  | { accepted: false; reason: EventRejectionReason };

export class MatchEngine {
  private match: Match;
  private readonly initialState: MatchState;
  private readonly validator = new ValidationEngine();
  private readonly rules = new RulesEngine();
  private readonly processor = new EventProcessor();
  private readonly transactions = new TransactionManager();

  constructor(options?: CreateMatchOptions, initialState?: MatchState) {
    this.match = initialState
      ? { state: cloneMatchState(initialState), events: [] }
      : createMatch(requireOptions(options));
    this.initialState = cloneMatchState(this.match.state);
  }

  static fromInitialState(initialState: MatchState): MatchEngine {
    return new MatchEngine(undefined, initialState);
  }

  getState(): Readonly<MatchState> {
    return structuredClone(this.match.state);
  }

  getEvents(): readonly MatchEvent[] {
    return structuredClone(this.match.events);
  }

  process(event: MatchEvent): EventResult {
    return this.commit([...this.match.events, event]);
  }

  undoLast(): EventResult | undefined {
    if (this.match.events.length === 0) return undefined;
    return this.commit(this.match.events.slice(0, -1));
  }

  removeEvent(eventId: string): EventResult {
    if (!this.match.events.some((event) => event.id === eventId)) {
      return { accepted: false, state: this.getState(), reason: "EVENT_NOT_FOUND" };
    }
    return this.commit(this.match.events.filter((event) => event.id !== eventId));
  }

  correctEvent(eventId: string, replacement: MatchEvent): EventResult {
    const index = this.match.events.findIndex((event) => event.id === eventId);
    if (index === -1) return { accepted: false, state: this.getState(), reason: "EVENT_NOT_FOUND" };

    const original = this.match.events[index];
    const corrected = { ...replacement, id: original.id, sequence: original.sequence } as MatchEvent;
    const events = [...this.match.events];
    events[index] = corrected;
    return this.commit(events);
  }

  private commit(events: MatchEvent[]): EventResult {
    const replayed = this.replay(events);
    if (!replayed.accepted) return { accepted: false, state: this.getState(), reason: replayed.reason };

    this.match = replayed.match;
    return { accepted: true, state: this.getState() };
  }

  private replay(events: MatchEvent[]): ReplayResult {
    let state = cloneMatchState(this.initialState);
    const acceptedEvents: MatchEvent[] = [];

    for (const event of events) {
      const rejection = this.validator.validate(state, event, acceptedEvents);
      if (rejection) return { accepted: false, reason: rejection };
      if (!this.rules.supports(event.type)) return { accepted: false, reason: "UNSUPPORTED_EVENT" };

      const transaction = this.transactions.run(state, (draft) => {
        this.processor.process(draft, event, acceptedEvents);
        draft.lastProcessedSequence = event.sequence;
      });
      state = cloneMatchState(transaction.state);
      acceptedEvents.push(event);
    }

    return { accepted: true, match: { state, events: structuredClone(events) } };
  }
}

function requireOptions(options: CreateMatchOptions | undefined): CreateMatchOptions {
  if (!options) throw new Error("MatchEngine requires an explicit immutable match snapshot.");
  return options;
}
