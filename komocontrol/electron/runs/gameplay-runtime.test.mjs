import { describe, expect, it } from "vitest";
import { eventFactsFromIntent, gameplayPeriodScores, parseGameplayIntent, parseGameplayScorerEventMutationInput, parseGameplayScorerEventMutationPreviewInput, safeGameplay, safeGameplayHistory, safeGameplayScorerEventEditContext, safeGameplayScorerEventGroup } from "../../dist-electron/runs/gameplay-runtime.cjs";

describe("KomoControl typed gameplay intent boundary", () => {
    it("maps supported scorer intents to MatchEvent V2 facts without accepting caller event metadata", () => {
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "clock-set", remainingSeconds: 317 }))).toEqual({ type: "CLOCK_SET", remainingSeconds: 317 });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "shot", team: "HOME", playerId: "player-1", points: 2, made: true }))).toEqual({ type: "TWO_POINT", team: "HOME", playerId: "player-1" });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "steal", team: "AWAY", playerId: "player-2" }))).toEqual({ type: "STEAL", team: "AWAY", playerId: "player-2" });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "penalty-administration-ended", penaltyId: "penalty:event-4" }))).toEqual({ type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: "penalty:event-4" });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "rebound", team: "AWAY", offensive: false, teamRebound: true }))).toEqual({ type: "REBOUND", team: "AWAY", offensive: false, teamRebound: true });
        expect(() => parseGameplayIntent({ kind: "MATCH_START", id: "caller-event", sequence: 99 })).toThrow(/Unsupported gameplay intent/);
    });

    it("preserves additive scorer-event identity and terminal workflow metadata", () => {
        const terminal = { reason: "ENTER_EARLY", unresolvedStep: "FT2", resumeContext: { penaltyShooterPlayerId: "player-7" } };
        const parsed = parseGameplayIntent({ kind: "penalty-administration-ended", penaltyId: "penalty:event-4", scorerEventId: "scorer-event-1", scorerEventTerminal: terminal });
        expect(parsed).toMatchObject({ scorerEventId: "scorer-event-1", scorerEventTerminal: terminal });
        expect(eventFactsFromIntent(parsed)).toMatchObject({ type: "PENALTY_ADMINISTRATION_ENDED", scorerEventId: "scorer-event-1", scorerEventTerminal: terminal });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "shot", team: "HOME", playerId: "player-1", points: 2, made: true, scorerEventId: "scorer-event-2", scorerEventTerminal: { reason: "NATURAL", decisions: { assist: "NONE" } } }))).toMatchObject({ scorerEventId: "scorer-event-2", scorerEventTerminal: { reason: "NATURAL", decisions: { assist: "NONE" } } });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "turnover", team: "HOME", playerId: "player-1", scorerEventId: "scorer-event-3", scorerEventTerminal: { reason: "NATURAL", decisions: { steal: "NONE" } } }))).toMatchObject({ scorerEventTerminal: { decisions: { steal: "NONE" } } });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "foul", foulType: "TECHNICAL_FOUL", team: "HOME", stoppageId: "stop-2", offender: { kind: "PLAYER", playerId: "player-1" }, context: { kind: "NON_CONTACT" }, scorerEventId: "scorer-event-4", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } }))).toMatchObject({ scorerEventId: "scorer-event-4", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "foul", foulType: "TECHNICAL_FOUL", team: "HOME", stoppageId: "stop-staff", offender: { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventContext: { technicalStaffSource: "BENCH" } }))).toMatchObject({ offender: { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }, scorerEventContext: { technicalStaffSource: "BENCH" } });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "shot", team: "HOME", playerId: "player-1", points: 2, made: true }))).not.toHaveProperty("scorerEventId");
    });

    it("preserves typed period and foul causal identities", () => {
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "period-start", period: { kind: "OVERTIME", index: 4 } }))).toEqual({ type: "PERIOD_START", period: { kind: "OVERTIME", index: 4 } });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "foul", foulType: "TECHNICAL_FOUL", team: "AWAY", stoppageId: "stop-1", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_CONTACT" } }))).toMatchObject({ type: "TECHNICAL_FOUL", team: "AWAY", stoppageId: "stop-1", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_CONTACT" } });
    });

    it("parses only typed revision-gated scorer-event group mutations", () => {
        expect(parseGameplayScorerEventMutationInput({ kind: "REPLACE_GROUP", scorerEventGroupId: "explicit:guided-1", expectedHistoryRevision: 7, events: [{ eventId: "shot-1", intent: { kind: "shot", team: "HOME", playerId: "home-1", points: 2, made: true, scorerEventId: "caller-value" } }] })).toMatchObject({ kind: "REPLACE_GROUP", expectedHistoryRevision: 7, events: [{ eventId: "shot-1", intent: { kind: "shot" } }] });
        expect(parseGameplayScorerEventMutationInput({ kind: "DELETE_GROUP", scorerEventGroupId: "explicit:guided-1", expectedHistoryRevision: 7 })).toEqual({ kind: "DELETE_GROUP", scorerEventGroupId: "explicit:guided-1", expectedHistoryRevision: 7 });
        expect(() => parseGameplayScorerEventMutationInput({ kind: "DELETE_GROUP", scorerEventGroupId: "explicit:guided-1", expectedHistoryRevision: 0 })).toThrow(/revision/i);
        expect(() => parseGameplayScorerEventMutationInput({ kind: "REPLACE_GROUP", scorerEventGroupId: "explicit:guided-1", expectedHistoryRevision: 7, events: [] })).toThrow(/replacement/i);
    });

    it("parses typed zero-write scorer-event mutation previews and staged actions", () => {
        const base = {
            scorerEventGroupId: "explicit:guided-1",
            expectedHistoryRevision: 7,
            events: [{ draftId: "draft-shot-1", eventId: "shot-1", intent: { kind: "shot", team: "HOME", playerId: "home-1", points: 2, made: true } }],
        };
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "CORRECT_PLAYER", targetId: "shot-1:shooter", playerId: "home-2" } })).toMatchObject({ expectedHistoryRevision: 7, events: [{ draftId: "draft-shot-1", eventId: "shot-1", intent: { kind: "shot" } }], action: { kind: "CORRECT_PLAYER", playerId: "home-2" } });
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "CORRECT_SHOT_RESULT", targetId: "shot-1:result", made: false } }).action).toEqual({ kind: "CORRECT_SHOT_RESULT", targetId: "shot-1:result", made: false });
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "CORRECT_FREE_THROW_RESULT", targetId: "ft-1:result", made: true } }).action).toEqual({ kind: "CORRECT_FREE_THROW_RESULT", targetId: "ft-1:result", made: true });
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "ASSIST", playerId: null } }).action).toEqual({ kind: "ASSIST", playerId: null });
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "STEALER", playerId: "away-1" } }).action).toEqual({ kind: "STEALER", playerId: "away-1" });
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "CHOOSE_SHOOTER", playerId: "home-2" } }).action).toEqual({ kind: "CHOOSE_SHOOTER", playerId: "home-2" });
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "FREE_THROW_RESULT", made: false } }).action).toEqual({ kind: "FREE_THROW_RESULT", made: false });
        expect(parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "REBOUNDER", team: "AWAY", teamRebound: true } }).action).toEqual({ kind: "REBOUNDER", team: "AWAY", teamRebound: true });
        expect(() => parseGameplayScorerEventMutationPreviewInput({ ...base, expectedHistoryRevision: 0 })).toThrow(/preview/i);
        expect(() => parseGameplayScorerEventMutationPreviewInput({ ...base, action: { kind: "DELETE_GROUP" } })).toThrow(/draft action/i);
    });

    it("projects scorer-event grouping fields and complete hidden group members through the safe boundary", () => {
        const facts = { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: "penalty:foul-1", scorerEventId: "guided-1", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT2" }, scorerEventContext: { technicalStaffSource: "COACH" } };
        const item = { eventId: "end-1", sequence: 4, occurredAt: 4, type: facts.type, scorerEventId: "guided-1", scorerEventTerminal: facts.scorerEventTerminal, scorerEventContext: facts.scorerEventContext, scorerEventGroupId: "explicit:guided-1", scorerEventGroupOrdinal: 2, scorerEventGroupingSource: "EXPLICIT", scorerEventGroupSafeForReconstruction: true, period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, facts };
        const history = safeGameplayHistory({ runId: "run-1", items: [item], nextBeforeSequence: null, total: 1 });
        expect(history.items[0]).toMatchObject({ scorerEventGroupId: "explicit:guided-1", scorerEventGroupOrdinal: 2, scorerEventGroupingSource: "EXPLICIT", scorerEventContext: { technicalStaffSource: "COACH" }, intent: { kind: "penalty-administration-ended", penaltyId: "penalty:foul-1", scorerEventContext: { technicalStaffSource: "COACH" } } });
        const group = safeGameplayScorerEventGroup({ scorerEventGroupId: "explicit:guided-1", groupingSource: "EXPLICIT", groupOrdinal: 2, canonicalEventIds: ["foul-1", "end-1"], visibleEventIds: ["foul-1"], firstSequence: 3, lastSequence: 4, period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, scorerEventTerminal: facts.scorerEventTerminal, terminalConflict: false, safeForReconstruction: true, items: [item] });
        expect(group).toMatchObject({ canonicalEventIds: ["foul-1", "end-1"], visibleEventIds: ["foul-1"], scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT2" }, items: [{ type: "PENALTY_ADMINISTRATION_ENDED" }] });
    });

    it("propagates only authoritative GOAL FOUL history flags through the safe boundary", () => {
        const base = { sequence: 2, occurredAt: 2, type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventGroupOrdinal: 1, scorerEventGroupingSource: "EXPLICIT", scorerEventGroupSafeForReconstruction: true, period: { kind: "REGULATION", index: 1 }, clockSeconds: 590, facts: { type: "TWO_POINT", team: "HOME", playerId: "home-1" } };
        const history = safeGameplayHistory({ runId: "run-1", items: [{ ...base, eventId: "goal-foul-shot", scorerEventGroupId: "explicit:goal-foul", isGoalFoul: true }, { ...base, eventId: "ordinary-shot", scorerEventGroupId: "explicit:ordinary-shot" }], nextBeforeSequence: null, total: 2 });
        expect(history.items[0]).toMatchObject({ eventId: "goal-foul-shot", isGoalFoul: true });
        expect(history.items[1]).not.toHaveProperty("isGoalFoul");
    });

    it("derives partial Q/OT scores from complete canonical history before any UI paging", () => {
        const event = (eventId, sequence, type, facts = {}) => ({ eventId, sequence, occurredAt: sequence, type, ...facts });
        const events = [
            event("start", 1, "MATCH_START"),
            event("q1-home", 2, "TWO_POINT", { team: "HOME" }),
            event("q1-away", 3, "THREE_POINT", { team: "AWAY" }),
            event("q2", 4, "PERIOD_START", { period: { kind: "REGULATION", index: 2 } }),
            event("q2-home-ft", 5, "FREE_THROW", { team: "HOME", made: true }),
            event("q2-away-miss", 6, "FREE_THROW", { team: "AWAY", made: false }),
            event("q3", 7, "PERIOD_START", { period: { kind: "REGULATION", index: 3 } }),
            event("q3-home", 8, "THREE_POINT", { team: "HOME" }),
            event("q4", 9, "PERIOD_START", { period: { kind: "REGULATION", index: 4 } }),
            event("q4-away", 10, "TWO_POINT", { team: "AWAY" }),
            event("ot1", 11, "PERIOD_START", { period: { kind: "OVERTIME", index: 1 } }),
            event("ot1-away-ft", 12, "FREE_THROW", { team: "AWAY", made: true }),
            event("ot2", 13, "PERIOD_START", { period: { kind: "OVERTIME", index: 2 } }),
        ];
        const current = { kind: "OVERTIME", index: 2 };
        const expected = [
            { period: { kind: "REGULATION", index: 1 }, home: 2, away: 3 },
            { period: { kind: "REGULATION", index: 2 }, home: 1, away: 0 },
            { period: { kind: "REGULATION", index: 3 }, home: 3, away: 0 },
            { period: { kind: "REGULATION", index: 4 }, home: 0, away: 2 },
            { period: { kind: "OVERTIME", index: 1 }, home: 0, away: 1 },
            { period: { kind: "OVERTIME", index: 2 }, home: 0, away: 0 },
        ];
        expect(gameplayPeriodScores(events, current)).toEqual(expected);
        expect(gameplayPeriodScores(events, current)).toEqual(expected);
        expect(gameplayPeriodScores(events.map((item) => item.eventId === "q1-home" ? { ...item, type: "TWO_POINT_MISSED" } : item), current)[0]).toMatchObject({ home: 0, away: 3 });
        expect(gameplayPeriodScores(events.filter((item) => item.eventId !== "q1-away"), current)[0]).toMatchObject({ home: 2, away: 0 });

        const longHistory = [event("long-start", 1, "MATCH_START"), event("long-score", 2, "TWO_POINT", { team: "HOME" }), ...Array.from({ length: 30 }, (_, index) => event(`filler-${index}`, index + 3, "TIMEOUT", { team: index % 2 ? "HOME" : "AWAY" })), event("long-q2", 33, "PERIOD_START", { period: { kind: "REGULATION", index: 2 } })];
        expect(gameplayPeriodScores(longHistory, { kind: "REGULATION", index: 2 })).toEqual([{ period: { kind: "REGULATION", index: 1 }, home: 2, away: 0 }, { period: { kind: "REGULATION", index: 2 }, home: 0, away: 0 }]);
    });

    it("projects historical edit capability and continuation DTOs through the safe boundary", () => {
        const facts = { type: "TURNOVER", team: "HOME", playerId: "home-1", scorerEventId: "turnover-1", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "STEALER" } };
        const item = { eventId: "turnover-1", sequence: 2, occurredAt: 2, type: facts.type, team: "HOME", playerId: "home-1", scorerEventId: facts.scorerEventId, scorerEventTerminal: facts.scorerEventTerminal, scorerEventGroupId: "explicit:turnover-1", scorerEventGroupOrdinal: 1, scorerEventGroupingSource: "EXPLICIT", scorerEventGroupSafeForReconstruction: true, period: { kind: "REGULATION", index: 1 }, clockSeconds: 600, facts };
        const group = { scorerEventGroupId: "explicit:turnover-1", groupingSource: "EXPLICIT", groupOrdinal: 1, canonicalEventIds: [item.eventId], visibleEventIds: [item.eventId], firstSequence: 2, lastSequence: 2, period: item.period, clockSeconds: 600, scorerEventTerminal: facts.scorerEventTerminal, terminalConflict: false, safeForReconstruction: true, items: [item] };
        const context = safeGameplayScorerEventEditContext({ group, lifecycle: "live", expectedHistoryRevision: 4, historicalState: { anchor: "BEFORE_GROUP", teams: [{ side: "HOME", players: [{ playerId: "home-1", side: "HOME", displayName: "Home One", shirtNumber: "0", participating: true, onCourt: true, eligible: true, foulStatus: "ELIGIBLE", foulStatusReason: null, totalFouls: 0, directDisqualification: false }] }, { side: "AWAY", players: [] }] }, editCapabilities: { safeForEdit: true, canResume: true, canDeleteGroup: true, targets: [{ targetId: "turnover-1:turnover-by", kind: "TURNOVER_BY", eventId: "turnover-1", currentPlayerId: "home-1", canonicalSide: "HOME", candidatePlayerIds: ["home-1"], sameTeamOnly: true, forwardPropagation: false, editable: true, readOnlyReason: null }] }, continuationPlan: { kind: "STEALER", turnoverEventId: "turnover-1", side: "AWAY", candidatePlayerIds: ["away-1"], noStealAllowed: true }, timeContext: { period: item.period, clockSeconds: 600, stoppageId: null } });
        expect(context).toMatchObject({ expectedHistoryRevision: 4, group: { scorerEventGroupId: "explicit:turnover-1", items: [{ intent: { kind: "turnover" } }] }, editCapabilities: { safeForEdit: true, canResume: true, canDeleteGroup: true, targets: [{ candidatePlayerIds: ["home-1"] }] }, continuationPlan: { kind: "STEALER", candidatePlayerIds: ["away-1"], noStealAllowed: true } });
    });

    it("builds a complete safe Live DTO from current configuration and engine projection", () => {
        const statistics = { points: 0 };
        const flagrantPenalty = { penaltyId: "penalty-flagrant", sourceFoulEventId: "foul-flagrant", kind: "FREE_THROWS", beneficiaryTeam: "HOME", shootingTeam: "HOME", attempts: 2, completedAttempts: 0, shooterPolicy: "FOULED_PLAYER", designatedPlayerId: "home-1", restart: { kind: "FRONTCOURT_THROW_IN", team: "HOME" } };
        const technicalPenalty = { penaltyId: "penalty-technical", sourceFoulEventId: "foul-technical", kind: "FREE_THROWS", beneficiaryTeam: "AWAY", shootingTeam: null, attempts: 1, completedAttempts: 0, shooterPolicy: "ANY_OPPONENT", designatedPlayerId: null, restart: { kind: "RESUME_INTERRUPTED", possession: "HOME" } };
        const player = (playerId, displayName, shirtNumber, team) => ({ playerId, displayName, shirtNumber, team, onCourt: true, foulState: { total: 0, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE" }, statistics });
        const recovery = {
            runId: "run-1", lifecycle: "live", eventHistoryRevision: 3, lastAcceptedSequence: 3,
            state: {
                rules: { startingPlayers: 5, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "REQUIRE_WINNER", teamFoulPenaltyThreshold: 5 }, period: { kind: "REGULATION", index: 1 }, clock: 590, clockRunning: false,
                possession: "HOME", alternatingPossession: "AWAY", finished: false, penaltyResolution: { stoppageId: "stop", entitlements: [flagrantPenalty, technicalPenalty], freeThrowQueue: [flagrantPenalty], cancelledPenaltyIds: [], administrationStarted: false, finalRestart: { kind: "FRONTCOURT_THROW_IN", team: "HOME" } },
                home: { id: "home", name: "Home", score: 2, timeouts: 2, teamFouls: 1, discipline: { headCoachCategory1TechnicalCount: 1, benchCategory1TechnicalCount: 0, headCoachDisqualified: false, disqualifiedBenchPersonIds: [] }, players: [player("home-1", "Home One", "7", "HOME")], statistics },
                away: { id: "away", name: "Away", score: 0, timeouts: 2, teamFouls: 0, discipline: { headCoachCategory1TechnicalCount: 0, benchCategory1TechnicalCount: 1, headCoachDisqualified: false, disqualifiedBenchPersonIds: [] }, players: [player("away-1", "Away One", "8", "AWAY")], statistics },
            },
            eventIds: ["start", "shot"], events: [{ eventId: "start", sequence: 1, occurredAt: 1, type: "MATCH_START" }, { eventId: "shot", sequence: 3, occurredAt: 3, type: "TWO_POINT", team: "HOME", playerId: "home-1" }],
            currentConfiguration: {
                schemaVersion: 1, runId: "run-1", gameId: "game-1", presentation: { leftSide: "AWAY" },
                teams: [
                    { side: "HOME", teamId: "home", players: [{ playerId: "home-1", participating: true, gameShirtNumber: "0" }], staff: [], captainPlayerId: "home-1", starterPlayerIds: ["home-1"], gameColor: "#FF0000", extraBench: [] },
                    { side: "AWAY", teamId: "away", players: [{ playerId: "away-1", participating: true, gameShirtNumber: "00" }], staff: [], captainPlayerId: "away-1", starterPlayerIds: ["away-1"], gameColor: "#00FF00", extraBench: [] },
                ],
            },
            setup: {
                gameId: "game-1", packageId: "package-1", packageVersion: 2, competitionName: "Competition", seasonName: "2026-27", phaseName: null, roundLabel: null, scheduledDate: null, scheduledTime: null, venue: null,
                settings: { gameMode: "FULL", minPlayers: 1, maxPlayers: 12, startingPlayers: 1, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, tieAllowed: false, winnerRequired: true },
                home: { side: "HOME", teamId: "home", teamName: "Home", logoUrl: null, players: [], staff: [] },
                away: { side: "AWAY", teamId: "away", teamName: "Away", logoUrl: null, players: [], staff: [] },
            },
        };
        const result = safeGameplay(recovery, { lastAcknowledgedHistoryRevision: 2, lastAcknowledgedFinalizationHash: null, lastAttemptAtUtc: null, lastSuccessAtUtc: null, lastErrorCode: "SYNC_PENDING_CONFIGURATION", consecutiveFailures: 0, nextRetryAtUtc: null });
        expect(result.teams).toMatchObject([{ side: "HOME", presentationSide: "RIGHT", gameColor: "#FF0000", discipline: { headCoachCategory1TechnicalCount: 1 }, players: [{ playerId: "home-1", shirtNumber: "0" }] }, { side: "AWAY", presentationSide: "LEFT", gameColor: "#00FF00", discipline: { benchCategory1TechnicalCount: 1 }, players: [{ playerId: "away-1", shirtNumber: "00" }] }]);
        expect(result.sync).toMatchObject({ status: "pending", lastErrorCode: null });
        expect(result.latestEvent).toMatchObject({ eventId: "shot", sequence: 3, type: "TWO_POINT" });
        expect(result.periodScores).toEqual([{ period: { kind: "REGULATION", index: 1 }, home: 2, away: 0 }]);
        expect(result.penalty).toMatchObject({ activePenaltyIds: ["penalty-flagrant"], entitlements: [{ penaltyId: "penalty-flagrant", completedAttempts: 0 }, { penaltyId: "penalty-technical" }] });
        recovery.state.penaltyResolution.freeThrowQueue = [];
        const earlyEnded = safeGameplay(recovery, { lastAcknowledgedHistoryRevision: 2, lastAcknowledgedFinalizationHash: null, lastAttemptAtUtc: null, lastSuccessAtUtc: null, lastErrorCode: "SYNC_PENDING_CONFIGURATION", consecutiveFailures: 0, nextRetryAtUtc: null }).penalty;
        expect(earlyEnded?.activePenaltyIds).toEqual([]);
        expect(earlyEnded?.entitlements.find((item) => item.penaltyId === "penalty-flagrant")).toMatchObject({ completedAttempts: 0 });
        recovery.state.penaltyResolution.freeThrowQueue = [technicalPenalty];
        expect(safeGameplay(recovery, { lastAcknowledgedHistoryRevision: 2, lastAcknowledgedFinalizationHash: null, lastAttemptAtUtc: null, lastSuccessAtUtc: null, lastErrorCode: "SYNC_PENDING_CONFIGURATION", consecutiveFailures: 0, nextRetryAtUtc: null }).penalty).toMatchObject({ activePenaltyIds: ["penalty-technical"] });
        expect(result).not.toHaveProperty("eventIds");
        expect(result).not.toHaveProperty("events");
        expect(JSON.stringify(result)).not.toMatch(/configurationJson|configurationHash|payload|token/i);
    });
});
