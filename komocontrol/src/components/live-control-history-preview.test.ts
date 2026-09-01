/// <reference types="node" />

import { describe, expect, it } from "vitest";
import { reconstructHistoricalScorerEventEdit, reconstructScorerEventGroup } from "./live-control-history-preview";

const gameplay = {
    runId: "run", lifecycle: "live", eventHistoryRevision: 1, lastAcceptedSequence: 1, score: { home: 0, away: 0 }, period: { kind: "REGULATION", index: 1 }, periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 0, away: 0 }], clockSeconds: 500, clockRunning: false, clockStartedAtMs: null, possession: null, alternatingPossession: "AWAY", finished: false, latestEvent: null,
    rules: { startingPlayers: 5, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "REQUIRE_WINNER" },
    teams: [
        { side: "HOME", presentationSide: "RIGHT", teamId: "h", teamName: "HOME TEAM", gameColor: "#dc2626", score: 0, timeouts: 0, timeoutAllowance: 2, teamFouls: 0, inBonus: false, discipline: { headCoachCategory1TechnicalCount: 0, benchCategory1TechnicalCount: 0, headCoachDisqualified: false, disqualifiedBenchCount: 0 }, captainPlayerId: null, starterPlayerIds: [], players: [player("h5", "5"), player("h12", "12")], bench: [{ personId: "coach:HOME", displayName: "HOME COACH", role: "HEAD_COACH", roleLabel: "Coach", source: "RUN" }], statistics: {} },
        { side: "AWAY", presentationSide: "LEFT", teamId: "a", teamName: "AWAY TEAM", gameColor: "#15803d", score: 0, timeouts: 0, timeoutAllowance: 2, teamFouls: 0, inBonus: false, discipline: { headCoachCategory1TechnicalCount: 0, benchCategory1TechnicalCount: 0, headCoachDisqualified: false, disqualifiedBenchCount: 0 }, captainPlayerId: null, starterPlayerIds: [], players: [player("a7", "7"), player("a8", "8")], bench: [{ personId: "bench:AWAY", displayName: "AWAY BENCH", role: "ACCOMPANYING_DELEGATION", roleLabel: "Bench", source: "RUN" }], statistics: {} },
    ], penalty: null, sync: { status: "synced", acknowledgedRevision: 1, lastAttemptAtUtc: null, lastSuccessAtUtc: null, lastErrorCode: null },
} as KomoControlSafeMatchGameplay;

function player(playerId: string, shirtNumber: string) {
    return { playerId, displayName: playerId.toUpperCase(), shirtNumber, participating: true, onCourt: true, fouls: { total: 0, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE", statusReason: null }, statistics: {} };
}

let sequence = 0;
function history(intent: KomoControlGameplayIntent | null, type: string, metadata: Partial<KomoControlGameplayHistoryItem> = {}): KomoControlGameplayHistoryItem {
    sequence += 1;
    return { eventId: `e${sequence}`, sequence, occurredAt: sequence, type, scorerEventId: "guided", scorerEventGroupId: "explicit:guided", scorerEventGroupOrdinal: 2, scorerEventGroupingSource: "EXPLICIT", scorerEventGroupSafeForReconstruction: true, period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, intent, ...metadata };
}
function group(items: KomoControlGameplayHistoryItem[], terminal?: KomoControlScorerEventTerminal, safe = true): KomoControlScorerEventGroup {
    return { scorerEventGroupId: "explicit:guided", groupingSource: "EXPLICIT", groupOrdinal: 2, canonicalEventIds: items.map((item) => item.eventId), visibleEventIds: items.filter((item) => item.type !== "PENALTY_ADMINISTRATION_ENDED").map((item) => item.eventId), firstSequence: Math.min(...items.map((item) => item.sequence)), lastSequence: Math.max(...items.map((item) => item.sequence)), period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, ...(terminal ? { scorerEventTerminal: terminal } : {}), terminalConflict: false, safeForReconstruction: safe, items };
}
function values(preview: ReturnType<typeof reconstructScorerEventGroup>) { return preview?.trail.map((entry) => [entry.label, entry.value]) ?? []; }

describe("read-only scorer-event reconstruction", () => {
    it("obeys only the authoritative safety gate", () => {
        expect(reconstructScorerEventGroup(group([history({ kind: "timeout", team: "HOME" }, "TIMEOUT")], undefined, false), gameplay)).toBeNull();
    });
    it("reconstructs made shots with factual Assist and team ownership", () => {
        const preview = reconstructScorerEventGroup(group([history({ kind: "shot", team: "HOME", playerId: "h5", points: 2, made: true, assistPlayerId: "h12" }, "TWO_POINT")], { reason: "NATURAL" }), gameplay)!;
        expect(values(preview)).toEqual([["SHOT TYPE", "2PT"], ["SHOOTER", "#5"], ["RESULT", "MADE"], ["ASSIST", "#12"]]);
        expect(preview.trail.at(-1)?.teamSide).toBe("HOME");
    });
    it("distinguishes explicit NO ASSIST from ENTER_EARLY Assist", () => {
        const shot = history({ kind: "shot", team: "HOME", playerId: "h5", points: 3, made: true }, "THREE_POINT");
        expect(values(reconstructScorerEventGroup(group([shot], { reason: "NATURAL", decisions: { assist: "NONE" } }), gameplay))).toContainEqual(["ASSIST", "NO ASSIST"]);
        const early = reconstructScorerEventGroup(group([shot], { reason: "ENTER_EARLY", unresolvedStep: "ASSIST" }), gameplay)!;
        expect(values(early)).toContainEqual(["ASSIST", ""]); expect(early.trail.at(-1)?.teamSide).toBe("HOME");
    });
    it("reconstructs missed Shot, Block and factual Rebound chronologically", () => {
        const preview = reconstructScorerEventGroup(group([
            history({ kind: "rebound", team: "HOME", playerId: "h12", offensive: true }, "REBOUND"),
            history({ kind: "shot", team: "HOME", playerId: "h5", points: 2, made: false }, "TWO_POINT_MISSED"),
            history({ kind: "block", team: "AWAY", playerId: "a7" }, "BLOCK"),
        ], { reason: "NATURAL" }), gameplay)!;
        expect(values(preview)).toEqual([["SHOT TYPE", "2PT"], ["SHOOTER", "#5"], ["RESULT", "MISS"], ["BLOCKER", "#7"], ["REBOUNDER", "#12"]]);
    });
    it("shows unresolved REBOUNDER without fabricating a rebound", () => {
        const preview = reconstructScorerEventGroup(group([history({ kind: "shot", team: "HOME", playerId: "h5", points: 2, made: false }, "TWO_POINT_MISSED")], { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" }), gameplay)!;
        expect(values(preview).filter(([label]) => label === "REBOUNDER")).toEqual([["REBOUNDER", ""]]);
        expect(preview.trail.at(-1)?.teamSide).toBeUndefined();
    });
    it("reconstructs paired Steal, explicit no-Steal and unresolved Stealer exactly", () => {
        const turnover = history({ kind: "turnover", team: "HOME", playerId: "h5" }, "TURNOVER");
        const steal = history({ kind: "steal", team: "AWAY", playerId: "a7" }, "STEAL");
        expect(values(reconstructScorerEventGroup(group([turnover, steal], { reason: "NATURAL" }), gameplay))).toEqual([["TURNOVER BY", "#5"], ["STEALER", "#7"]]);
        expect(values(reconstructScorerEventGroup(group([turnover], { reason: "NATURAL", decisions: { steal: "NONE" } }), gameplay))).toContainEqual(["STEALER", "ΧΩΡΙΣ STEAL"]);
        const early = reconstructScorerEventGroup(group([turnover], { reason: "ENTER_EARLY", unresolvedStep: "STEALER" }), gameplay)!;
        expect(early.trail.at(-1)).toMatchObject({ label: "STEALER", value: "", teamSide: "AWAY" });
    });
    it("reconstructs ordinary and offensive foul identities without invented victims", () => {
        const ordinary = history({ kind: "foul", foulType: "PERSONAL_FOUL", team: "HOME", stoppageId: "s", offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "a7" }, "PERSONAL_FOUL");
        expect(values(reconstructScorerEventGroup(group([ordinary], { reason: "NATURAL" }), gameplay))).toEqual([["FOUL", "FOUL"], ["FOULER", "#5"], ["DRAWN BY", "#7"]]);
        const offensive = history({ kind: "foul", foulType: "PERSONAL_FOUL", team: "HOME", stoppageId: "s2", offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "NON_SHOOTING", teamControlFoul: true } }, "PERSONAL_FOUL");
        expect(values(reconstructScorerEventGroup(group([offensive], { reason: "NATURAL" }), gameplay))).toEqual([["FOUL", "OFFENSIVE FOUL"], ["FOULER", "#5"]]);
    });
    it("reconstructs bonus FT facts and hides PAE while projecting the unresolved attempt", () => {
        const foul = history({ kind: "foul", foulType: "PERSONAL_FOUL", team: "HOME", stoppageId: "s", offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "a7" }, "PERSONAL_FOUL");
        const ft = history({ kind: "free-throw", team: "AWAY", playerId: "a7", penaltyId: "p", attemptIndex: 1, made: false }, "FREE_THROW");
        const paeTerminal = { reason: "ENTER_EARLY" as const, unresolvedStep: "FT2" as const, resumeContext: { penaltyShooterPlayerId: "a7" } };
        const pae = history({ kind: "penalty-administration-ended", penaltyId: "p", scorerEventTerminal: paeTerminal }, "PENALTY_ADMINISTRATION_ENDED", { scorerEventTerminal: paeTerminal });
        const preview = reconstructScorerEventGroup(group([foul, ft, pae], pae.scorerEventTerminal), gameplay)!;
        expect(values(preview)).toContainEqual(["FT1", "MISS"]); expect(values(preview)).toContainEqual(["FT2", ""]); expect(values(preview).flat()).not.toContain("PENALTY_ADMINISTRATION_ENDED");
    });
    it.each([[true, 1], [false, 2], [false, 3]])("reconstructs Shooting Foul made/miss %s with %i factual attempts", (made, attempts) => {
        const shot = history({ kind: "shot", team: "AWAY", playerId: "a7", points: attempts === 3 ? 3 : 2, made, assistPlayerId: made ? "a8" : undefined }, made ? "TWO_POINT" : attempts === 3 ? "THREE_POINT_MISSED" : "TWO_POINT_MISSED");
        const foul = history({ kind: "foul", foulType: "PERSONAL_FOUL", team: "HOME", stoppageId: "s", offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "SHOOTING" }, fouledPlayerId: "a7", relatedShotEventId: shot.eventId }, "PERSONAL_FOUL");
        const fts = Array.from({ length: attempts }, (_, index) => history({ kind: "free-throw", team: "AWAY", playerId: "a7", penaltyId: "p", attemptIndex: index + 1, made: true }, "FREE_THROW"));
        const preview = reconstructScorerEventGroup(group([shot, foul, ...fts], { reason: "NATURAL" }), gameplay)!;
        expect(preview.trail.filter((entry) => entry.label.startsWith("FT"))).toHaveLength(attempts);
        expect(values(preview).slice(0, 4)).toEqual([["FOUL", "SHOOTING FOUL"], ["SHOT TYPE", `${attempts === 3 ? 3 : 2}PT`], ["FOULER", "#5"], ["DRAWN BY", "#7"]]);
    });
    it.each([[1, true], [1, false], [2, true], [2, false], [3, true], [3, false]])("maps factual FT%i %s to its exact editable result target", (attempt, made) => {
        const ft = history({ kind: "free-throw", team: "AWAY", playerId: "a7", penaltyId: "p", attemptIndex: attempt, made }, "FREE_THROW");
        const context = {
            group: group([ft], { reason: "NATURAL" }), lifecycle: "live", expectedHistoryRevision: 1,
            historicalState: { anchor: "BEFORE_GROUP", teams: [] },
            editCapabilities: { safeForEdit: true, canResume: false, canDeleteGroup: true, targets: [{ targetId: `${ft.eventId}:free-throw-result`, kind: "FREE_THROW_RESULT", eventId: ft.eventId, currentPlayerId: null, canonicalSide: "AWAY", candidatePlayerIds: [], sameTeamOnly: false, forwardPropagation: false, currentValue: made ? "MADE" : "MISS", allowedValues: ["MADE", "MISS"], editable: true, readOnlyReason: null }] },
            continuationPlan: null, timeContext: { period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, stoppageId: null },
        } as KomoControlScorerEventEditContext;
        expect(reconstructHistoricalScorerEventEdit(context, gameplay)?.trail.find((entry) => entry.label === `FT${attempt}`)).toMatchObject({ value: made ? "MADE" : "MISS", sourceEventId: ft.eventId, editTargetId: `${ft.eventId}:free-throw-result`, editable: true });
    });
    it("binds factual Shot and final FT decisions by exact event identity with a downstream Rebound", () => {
        const shot = history({ kind: "shot", team: "AWAY", playerId: "a7", points: 3, made: true, assistPlayerId: "a8" }, "THREE_POINT");
        const foul = history({ kind: "foul", foulType: "PERSONAL_FOUL", team: "HOME", stoppageId: "decision-targets", offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "SHOOTING" }, fouledPlayerId: "a7", relatedShotEventId: shot.eventId }, "PERSONAL_FOUL");
        const ft = history({ kind: "free-throw", team: "AWAY", playerId: "a7", penaltyId: `penalty:${foul.eventId}`, attemptIndex: 1, made: false }, "FREE_THROW");
        const rebound = history({ kind: "rebound", team: "HOME", playerId: "h12", offensive: false }, "REBOUND", { scorerEventTerminal: { reason: "NATURAL" } });
        const context = {
            group: group([shot, foul, ft, rebound], { reason: "NATURAL" }), lifecycle: "live", expectedHistoryRevision: 1,
            historicalState: { anchor: "BEFORE_GROUP", teams: [] },
            editCapabilities: { safeForEdit: true, canResume: false, canDeleteGroup: true, targets: [
                { targetId: `${shot.eventId}:result`, kind: "SHOT_RESULT", eventId: shot.eventId, currentPlayerId: null, canonicalSide: "AWAY", candidatePlayerIds: [], sameTeamOnly: false, forwardPropagation: true, currentValue: "MADE", allowedValues: ["MADE", "MISS"], editable: true, readOnlyReason: null },
                { targetId: `${ft.eventId}:free-throw-shooter`, kind: "FREE_THROW_SHOOTER", eventId: ft.eventId, currentPlayerId: "a7", canonicalSide: "AWAY", candidatePlayerIds: ["a7", "a8"], sameTeamOnly: true, forwardPropagation: false, editable: true, readOnlyReason: null },
                { targetId: `${ft.eventId}:result`, kind: "FREE_THROW_RESULT", eventId: ft.eventId, currentPlayerId: null, canonicalSide: "AWAY", candidatePlayerIds: [], sameTeamOnly: false, forwardPropagation: true, currentValue: "MISS", allowedValues: ["MADE", "MISS"], editable: true, readOnlyReason: null },
            ] },
            continuationPlan: null, timeContext: { period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, stoppageId: "decision-targets" },
        } as KomoControlScorerEventEditContext;
        const preview = reconstructHistoricalScorerEventEdit(context, gameplay)!;
        expect(preview.trail.find((entry) => entry.label === "RESULT")).toMatchObject({ sourceEventId: shot.eventId, editTargetId: `${shot.eventId}:result`, editable: true });
        expect(preview.trail.find((entry) => entry.label === "FT1")).toMatchObject({ playerId: "a7", sourceEventId: ft.eventId, editTargetId: `${ft.eventId}:result`, editable: true });
        expect(preview.trail.find((entry) => entry.label === "FREE THROW")).toMatchObject({ editTargetId: `${ft.eventId}:free-throw-shooter`, editable: true });
        expect(preview.trail.find((entry) => entry.label === "REBOUNDER")).toMatchObject({ value: "#12" });
    });
    it("keeps a factual FT result non-clickable when its authoritative target is read-only", () => {
        const ft = history({ kind: "free-throw", team: "AWAY", playerId: "a7", penaltyId: "p", attemptIndex: 1, made: false }, "FREE_THROW");
        const context = {
            group: group([ft], { reason: "NATURAL" }), lifecycle: "live", expectedHistoryRevision: 1,
            historicalState: { anchor: "BEFORE_GROUP", teams: [] },
            editCapabilities: { safeForEdit: false, canResume: false, canDeleteGroup: true, targets: [{ targetId: `${ft.eventId}:free-throw-result`, kind: "FREE_THROW_RESULT", eventId: ft.eventId, currentPlayerId: null, canonicalSide: "AWAY", candidatePlayerIds: [], sameTeamOnly: false, forwardPropagation: false, currentValue: "MISS", allowedValues: ["MADE", "MISS"], editable: false, readOnlyReason: "UNSUPPORTED_TARGET" }] },
            continuationPlan: null, timeContext: { period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, stoppageId: null },
        } as KomoControlScorerEventEditContext;
        expect(reconstructHistoricalScorerEventEdit(context, gameplay)?.trail.find((entry) => entry.label === "FT1")).toMatchObject({ sourceEventId: ft.eventId, editTargetId: `${ft.eventId}:free-throw-result`, editable: false });
    });
    it("uses Phase 4.5 COACH/BENCH source rather than canonical Head Coach", () => {
        const technical = (source: "COACH" | "BENCH") => history({ kind: "foul", foulType: "TECHNICAL_FOUL", team: "HOME", stoppageId: source, offender: { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventContext: { technicalStaffSource: source } }, "TECHNICAL_FOUL", { scorerEventContext: { technicalStaffSource: source } });
        expect(values(reconstructScorerEventGroup(group([technical("COACH")], { reason: "NATURAL" }), gameplay))).toEqual([["FOUL", "COACH"]]);
        expect(values(reconstructScorerEventGroup(group([technical("BENCH")], { reason: "NATURAL" }), gameplay))).toEqual([["FOUL", "BENCH"]]);
    });
    it("reconstructs Category 2 Player Technical with only the factual FOUL card", () => {
        const technical = history({ kind: "foul", foulType: "TECHNICAL_FOUL", team: "HOME", stoppageId: "c2", offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2" }, "TECHNICAL_FOUL");
        const preview = reconstructScorerEventGroup(group([technical], { reason: "NATURAL" }), gameplay)!;
        expect(preview.title).toBe("ΤΕΧΝ. ΠΟΙΝΗ");
        expect(values(preview)).toEqual([["FOUL", "#5"]]);
    });
    it("reconstructs Category 1 Player Technical and selected manual shooter exactly", () => {
        const technical = history({ kind: "foul", foulType: "TECHNICAL_FOUL", team: "HOME", stoppageId: "s", offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1" }, "TECHNICAL_FOUL");
        const preview = reconstructScorerEventGroup(group([technical], { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "a8" } }), gameplay)!;
        expect(preview.title).toBe("ΤΕΧΝ. ΠΟΙΝΗ GD");
        expect(values(preview)).toEqual([["FOUL", "#5"], ["CHOOSE SHOOTER", "#8"], ["FT1", ""]]);
    });
    it.each(["FLAGRANT_FOUL", "DISRUPTIVE_FOUL", "DISQUALIFYING_FOUL"])("reconstructs %s player-contact branches", (foulType) => {
        const foul = history({ kind: "foul", foulType, team: "HOME", stoppageId: foulType, offender: { kind: "PLAYER", playerId: "h5" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "a7" }, foulType);
        const preview = reconstructScorerEventGroup(group([foul], { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "a7" } }), gameplay)!;
        expect(values(preview).slice(0, 3)).toEqual([["FOUL", preview.title], ["FOULER", "#5"], ["DRAWN BY", "#7"]]); expect(values(preview)).toContainEqual(["FT1", ""]);
    });
    it("reconstructs staff DQ without adding DRAWN BY", () => {
        const foul = history({ kind: "foul", foulType: "DISQUALIFYING_FOUL", team: "AWAY", stoppageId: "dq", offender: { kind: "BENCH", personId: "bench:AWAY", role: "ACCOMPANYING_DELEGATION" }, context: { kind: "NON_CONTACT" } }, "DISQUALIFYING_FOUL");
        const preview = reconstructScorerEventGroup(group([foul], { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" }), gameplay)!;
        expect(values(preview)).toContainEqual(["FOULER", "BENCH · AWAY BENCH"]); expect(preview.trail.some((entry) => entry.label === "DRAWN BY")).toBe(false); expect(values(preview)).toContainEqual(["CHOOSE SHOOTER", ""]);
    });
    it("keeps final factual live-ball rebound separate from unresolved rebound", () => {
        const ft = history({ kind: "free-throw", team: "AWAY", playerId: "a7", penaltyId: "p", attemptIndex: 2, made: false }, "FREE_THROW");
        const rebound = history({ kind: "rebound", team: "HOME", playerId: "h5", offensive: false }, "REBOUND");
        expect(values(reconstructScorerEventGroup(group([ft, rebound], { reason: "NATURAL" }), gameplay))).toContainEqual(["REBOUNDER", "#5"]);
        expect(values(reconstructScorerEventGroup(group([ft], { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" }), gameplay))).toContainEqual(["REBOUNDER", ""]);
    });
    it("summarizes exact two-team substitutions without opening a mutable SUBS flow", () => {
        const preview = reconstructScorerEventGroup(group([
            history({ kind: "substitution", team: "HOME", playerOutId: "h5", playerInId: "h12" }, "SUBSTITUTION"),
            history({ kind: "substitution", team: "AWAY", playerOutId: "a7", playerInId: "a8" }, "SUBSTITUTION"),
        ], { reason: "NATURAL" }), gameplay)!;
        expect(preview.title).toBe("SUBS"); expect(values(preview)).toEqual([["HOME SUB", "#5 → #12"], ["AWAY SUB", "#7 → #8"]]);
    });
    it("renders safe simple groups compactly", () => {
        expect(values(reconstructScorerEventGroup(group([history({ kind: "timeout", team: "HOME" }, "TIMEOUT", { team: "HOME" })], { reason: "NATURAL" }), gameplay))).toEqual([["TIMEOUT", "HOME · HOME TEAM"]]);
        expect(values(reconstructScorerEventGroup(group([history({ kind: "alternating-possession" }, "ALTERNATING_POSSESSION")], { reason: "NATURAL" }), gameplay))).toEqual([["ΕΝΑΛΛΑΣΣΟΜΕΝΗ ΚΑΤΟΧΗ", "ΚΑΤΑΧΩΡΙΣΜΕΝΟ"]]);
    });
});
