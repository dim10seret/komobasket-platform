import { cloneMatchState, createMatch, type CreateMatchOptions } from "../models/match.js";
import type { MatchEvent } from "../types/event.js";
import type {
  EventMutationOptions,
  EventRejectionReason,
  EventResult,
} from "../types/event-result.js";
import type { Match } from "../types/match.js";
import type { MatchState } from "../types/match-state.js";
import { EventProcessor } from "./event-processor.js";
import { dependentEventIds } from "./event-dependencies.js";
import { RulesEngine } from "./rules-engine.js";
import { TransactionManager } from "./transaction-manager.js";
import { ValidationEngine } from "./validation-engine.js";

type ReplayResult =
  | { accepted: true; match: Match }
  | { accepted: false; reason: EventRejectionReason; eventId: string };

type AppendResult =
  | { accepted: true; state: MatchState }
  | { accepted: false; reason: EventRejectionReason; eventId: string };

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

  preview(event: MatchEvent): EventResult {
    const candidate = this.appendCandidate(event);
    if (!candidate.accepted) {
      return {
        accepted: false,
        state: this.getState(),
        reason: candidate.reason,
        blockingEventId: candidate.eventId,
      };
    }
    return { accepted: true, state: cloneMatchState(candidate.state) };
  }

  process(event: MatchEvent): EventResult {
    const candidate = this.appendCandidate(event);
    if (!candidate.accepted) {
      return {
        accepted: false,
        state: this.getState(),
        reason: candidate.reason,
        blockingEventId: candidate.eventId,
      };
    }
    this.match.state = cloneMatchState(candidate.state);
    this.match.events.push(structuredClone(event));
    return { accepted: true, state: this.getState() };
  }

  fork(): MatchEngine {
    const fork = MatchEngine.fromInitialState(this.initialState);
    fork.match = { state: cloneMatchState(this.match.state), events: structuredClone(this.match.events) };
    return fork;
  }

  undoLast(): EventResult | undefined {
    if (this.match.events.length === 0) return undefined;
    return this.commit(this.match.events.slice(0, -1));
  }

  removeEvent(eventId: string, options: EventMutationOptions = {}): EventResult {
    if (!this.match.events.some((event) => event.id === eventId)) {
      return { accepted: false, state: this.getState(), reason: "EVENT_NOT_FOUND" };
    }
    const dependentIds = dependentEventIds(this.match.events, eventId);
    if (dependentIds.length > 0 && !options.cascadeDependencies) {
      return {
        accepted: false,
        state: this.getState(),
        reason: "DEPENDENT_EVENTS_EXIST",
        dependentEventIds: dependentIds,
      };
    }
    const removedIds = new Set([eventId, ...(options.cascadeDependencies ? dependentIds : [])]);
    return this.commit(this.match.events.filter((event) => !removedIds.has(event.id)));
  }

  correctEvent(
    eventId: string,
    replacement: MatchEvent,
    options: EventMutationOptions = {},
  ): EventResult {
    const index = this.match.events.findIndex((event) => event.id === eventId);
    if (index === -1) return { accepted: false, state: this.getState(), reason: "EVENT_NOT_FOUND" };

    const dependentIds = dependentEventIds(this.match.events, eventId);
    if (dependentIds.length > 0 && !options.cascadeDependencies) {
      return {
        accepted: false,
        state: this.getState(),
        reason: "DEPENDENT_EVENTS_EXIST",
        dependentEventIds: dependentIds,
      };
    }
    const original = this.match.events[index];
    const corrected = { ...replacement, id: original.id, sequence: original.sequence } as MatchEvent;
    const removedIds = new Set(options.cascadeDependencies ? dependentIds : []);
    const events = this.match.events
      .filter((event) => !removedIds.has(event.id))
      .map((event) => event.id === eventId ? corrected : event);
    return this.commit(events);
  }

  private commit(events: MatchEvent[]): EventResult {
    const replayed = this.replay(events);
    if (!replayed.accepted) {
      return {
        accepted: false,
        state: this.getState(),
        reason: replayed.reason,
        blockingEventId: replayed.eventId,
      };
    }

    this.match = replayed.match;
    return { accepted: true, state: this.getState() };
  }

  private appendCandidate(event: MatchEvent): AppendResult {
    const rejection = this.validator.validate(this.match.state, event, this.match.events);
    if (rejection) return { accepted: false, reason: rejection, eventId: event.id };
    if (!this.rules.supports(event.type)) return { accepted: false, reason: "UNSUPPORTED_EVENT", eventId: event.id };
    const transaction = this.transactions.run(this.match.state, (draft) => {
      this.processor.process(draft, event, this.match.events);
      draft.lastProcessedSequence = event.sequence;
    });
    return { accepted: true, state: cloneMatchState(transaction.state) };
  }

  private replay(events: MatchEvent[]): ReplayResult {
    let state = cloneMatchState(this.initialState);
    const acceptedEvents: MatchEvent[] = [];

    for (const event of events) {
      const rejection = this.validator.validate(state, event, acceptedEvents);
      if (rejection) return { accepted: false, reason: rejection, eventId: event.id };
      if (!this.rules.supports(event.type)) {
        return { accepted: false, reason: "UNSUPPORTED_EVENT", eventId: event.id };
      }

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
