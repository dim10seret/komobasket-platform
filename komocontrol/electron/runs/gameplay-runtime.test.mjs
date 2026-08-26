import { describe, expect, it } from "vitest";
import { eventFactsFromIntent, parseGameplayIntent, safeGameplay } from "../../dist-electron/runs/gameplay-runtime.cjs";

describe("KomoControl typed gameplay intent boundary", () => {
    it("maps supported scorer intents to MatchEvent V2 facts without accepting caller event metadata", () => {
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "clock-set", remainingSeconds: 317 }))).toEqual({ type: "CLOCK_SET", remainingSeconds: 317 });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "shot", team: "HOME", playerId: "player-1", points: 2, made: true }))).toEqual({ type: "TWO_POINT", team: "HOME", playerId: "player-1" });
        expect(() => parseGameplayIntent({ kind: "MATCH_START", id: "caller-event", sequence: 99 })).toThrow(/Unsupported gameplay intent/);
    });

    it("preserves typed period and foul causal identities", () => {
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "period-start", period: { kind: "OVERTIME", index: 4 } }))).toEqual({ type: "PERIOD_START", period: { kind: "OVERTIME", index: 4 } });
        expect(eventFactsFromIntent(parseGameplayIntent({ kind: "foul", foulType: "TECHNICAL_FOUL", team: "AWAY", stoppageId: "stop-1", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_CONTACT" } }))).toMatchObject({ type: "TECHNICAL_FOUL", team: "AWAY", stoppageId: "stop-1", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_CONTACT" } });
    });

    it("builds a complete safe Live DTO from current configuration and engine projection", () => {
        const statistics = { points: 0 };
        const player = (playerId, displayName, shirtNumber, team) => ({ playerId, displayName, shirtNumber, team, onCourt: true, foulState: { total: 0, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE" }, statistics });
        const recovery = {
            runId: "run-1", lifecycle: "live", eventHistoryRevision: 3, lastAcceptedSequence: 3,
            state: {
                rules: { teamFoulPenaltyThreshold: 5 }, period: { kind: "REGULATION", index: 1 }, clock: 590, clockRunning: false,
                possession: "HOME", alternatingPossession: "AWAY", finished: false,
                home: { id: "home", name: "Home", score: 2, timeouts: 2, teamFouls: 1, players: [player("home-1", "Home One", "7", "HOME")], statistics },
                away: { id: "away", name: "Away", score: 0, timeouts: 2, teamFouls: 0, players: [player("away-1", "Away One", "8", "AWAY")], statistics },
            },
            eventIds: ["start", "shot"], events: [{ eventId: "start", sequence: 1, occurredAt: 1, type: "MATCH_START" }, { eventId: "shot", sequence: 3, occurredAt: 3, type: "TWO_POINT", team: "HOME", playerId: "home-1" }],
            currentConfiguration: {
                schemaVersion: 1, runId: "run-1", gameId: "game-1", presentation: { leftSide: "AWAY" },
                teams: [
                    { side: "HOME", teamId: "home", players: [{ playerId: "home-1", participating: true, gameShirtNumber: "0" }], staff: [], captainPlayerId: "home-1", starterPlayerIds: ["home-1"], gameColor: "#FF0000", extraBench: [] },
                    { side: "AWAY", teamId: "away", players: [{ playerId: "away-1", participating: true, gameShirtNumber: "00" }], staff: [], captainPlayerId: "away-1", starterPlayerIds: ["away-1"], gameColor: "#00FF00", extraBench: [] },
                ],
            },
        };
        const result = safeGameplay(recovery, { lastAcknowledgedHistoryRevision: 2, lastAcknowledgedFinalizationHash: null, lastAttemptAtUtc: null, lastSuccessAtUtc: null, lastErrorCode: "SYNC_PENDING_CONFIGURATION", consecutiveFailures: 0, nextRetryAtUtc: null });
        expect(result.teams).toMatchObject([{ side: "HOME", presentationSide: "RIGHT", gameColor: "#FF0000", players: [{ playerId: "home-1", shirtNumber: "0" }] }, { side: "AWAY", presentationSide: "LEFT", gameColor: "#00FF00", players: [{ playerId: "away-1", shirtNumber: "00" }] }]);
        expect(result.sync).toMatchObject({ status: "pending", lastErrorCode: null });
        expect(JSON.stringify(result)).not.toMatch(/configurationJson|configurationHash|payload|token/i);
    });
});
