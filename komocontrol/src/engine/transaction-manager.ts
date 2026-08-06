import type { MatchState } from "../types/match-state";

export class TransactionManager {
  run<T>(state: MatchState, operation: (draft: MatchState) => T): { state: MatchState; result: T } {
    const draft = structuredClone(state);
    return { state: draft, result: operation(draft) };
  }
}
