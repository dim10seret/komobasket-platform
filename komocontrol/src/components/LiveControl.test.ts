/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canCompleteLiveFlow, finalSubmissionPhase, firstLiveFlowStep, formatLiveClock, foulIndicator, gameLogGroupClass, gameplayEventLabel, gameplayEventTeamPresentation, historicalCorrectionIsNoop, isScorerFacingGameplayEvent, latestOpenTimeout, liveClockSeconds, liveKeyboardCommand, livePrimaryActionAvailable, livePrimaryActions, liveStatusPlayerStatistics, nextLivePeriod, periodScoreLabel, periodScoreValue, periodText, presentationTeams, teamReboundIntent, timeoutCountdownSeconds, timeoutGameplayIntents } from "./LiveControl";

const gameplay = {
    runId: "run", lifecycle: "live", eventHistoryRevision: 1, lastAcceptedSequence: 1, score: { home: 50, away: 45 }, period: { kind: "REGULATION", index: 4 }, periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 12, away: 8 }, { period: { kind: "REGULATION", index: 2 }, home: 11, away: 10 }, { period: { kind: "REGULATION", index: 3 }, home: 14, away: 12 }, { period: { kind: "REGULATION", index: 4 }, home: 13, away: 15 }], clockSeconds: 300, clockRunning: false, clockStartedAtMs: null, possession: "HOME", alternatingPossession: "AWAY", finished: false, latestEvent: null,
    rules: { startingPlayers: 5, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "REQUIRE_WINNER" },
    teams: [
        { side: "HOME", presentationSide: "RIGHT", teamId: "h", teamName: "Home", gameColor: "#DC2626", score: 50, timeouts: 2, timeoutAllowance: 3, teamFouls: 3, inBonus: false, discipline: { headCoachCategory1TechnicalCount: 0, benchCategory1TechnicalCount: 0, headCoachDisqualified: false, disqualifiedBenchCount: 0 }, captainPlayerId: null, starterPlayerIds: [], players: [], bench: [], statistics: {} },
        { side: "AWAY", presentationSide: "LEFT", teamId: "a", teamName: "Away", gameColor: "#15803D", score: 45, timeouts: 3, timeoutAllowance: 3, teamFouls: 4, inBonus: false, discipline: { headCoachCategory1TechnicalCount: 0, benchCategory1TechnicalCount: 0, headCoachDisqualified: false, disqualifiedBenchCount: 0 }, captainPlayerId: null, starterPlayerIds: [], players: [], bench: [], statistics: {} },
    ], penalty: null, sync: { status: "pending", acknowledgedRevision: 0, lastAttemptAtUtc: null, lastSuccessAtUtc: null, lastErrorCode: null },
} as KomoControlSafeMatchGameplay;

describe("Full Stats Live Control presentation contract", () => {
    it("builds an atomic terminalized TIMEOUT with an independent CLOCK_STOP only while running", () => {
        const running = timeoutGameplayIntents("HOME", "timeout-group", true);
        expect(running).toEqual([
            { kind: "timeout", team: "HOME", scorerEventId: "timeout-group", scorerEventTerminal: { reason: "NATURAL" } },
            { kind: "clock-stop" },
        ]);
        expect(running[1]).not.toHaveProperty("scorerEventId");
        expect(timeoutGameplayIntents("AWAY", "stopped-timeout", false)).toEqual([
            { kind: "timeout", team: "AWAY", scorerEventId: "stopped-timeout", scorerEventTerminal: { reason: "NATURAL" } },
        ]);
    });

    it("keeps the timeout countdown renderer-only, starts at 01:00, and clamps at 00:00", () => {
        expect(timeoutCountdownSeconds(1_000, 1_000)).toBe(60);
        expect(timeoutCountdownSeconds(1_000, 1_001)).toBe(60);
        expect(timeoutCountdownSeconds(1_000, 2_000)).toBe(59);
        expect(timeoutCountdownSeconds(1_000, 61_000)).toBe(0);
        expect(timeoutCountdownSeconds(1_000, 90_000)).toBe(0);
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('setActiveTimeoutCountdown({ scorerEventGroupId: `explicit:${scorerEventId}`');
        expect(source).toContain('if (next) {');
        expect(source).toContain('role="timer"');
        expect(source).not.toContain('saveResumableLiveFlow(gameplay.runId, activeTimeoutCountdown');
    });

    it("recovers only the latest timeout after the latest CLOCK_START", () => {
        const item = (sequence: number, type: string, scorerEventId?: string): KomoControlGameplayHistoryItem => ({ eventId: `event-${sequence}`, sequence, occurredAt: sequence, type, ...(type === "TIMEOUT" ? { team: "HOME" as const } : {}), ...(scorerEventId ? { scorerEventId } : {}), scorerEventGroupId: scorerEventId ? `explicit:${scorerEventId}` : `atomic:event-${sequence}`, scorerEventGroupOrdinal: sequence, scorerEventGroupingSource: scorerEventId ? "EXPLICIT" : "LEGACY_ATOMIC", scorerEventGroupSafeForReconstruction: Boolean(scorerEventId), period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, intent: null });
        const timeoutA = item(2, "TIMEOUT", "timeout-a");
        const clockStart = item(3, "CLOCK_START");
        const timeoutB = item(4, "TIMEOUT", "timeout-b");
        expect(latestOpenTimeout([timeoutB, clockStart, timeoutA])).toBe(timeoutB);
        expect(latestOpenTimeout([clockStart, timeoutA])).toBeNull();
    });

    it("clears countdown only after successful clock start or deletion of its own group", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const next = await appendIntent({ kind: "clock-start" });');
        expect(source).toContain('if (activeTimeoutCountdown?.scorerEventGroupId === scorerEventGroupId)');
        expect(source).toContain('const next = flow.action === "TIME_OUT" ? await appendTimeout');
        expect(source.indexOf('const next = applyResult(result);')).toBeLessThan(source.indexOf('if (activeTimeoutCountdown?.scorerEventGroupId === scorerEventGroupId)'));
    });
    it("derives final submission UX only from authoritative finalized sync and authentication state", () => {
        const context = { scorerId: "scorer", username: "scorer", organizationId: "organization", organizationName: "Organization", expiresAt: "2026-09-01T20:00:00.000Z" };
        const authenticated: Extract<KomoControlAuthState, { kind: "authenticated" }> = { kind: "authenticated", connection: "online", deviceIdSuffix: "123456", context };
        const authenticatedOffline: Extract<KomoControlAuthState, { kind: "authenticated" }> = { kind: "authenticated", connection: "offline", deviceIdSuffix: "123456", context };
        const finalized = (status: KomoControlSafeMatchGameplay["sync"]["status"]) => ({ ...gameplay, lifecycle: "finalized" as const, finished: true, eventHistoryRevision: 926, lastAcceptedSequence: 468, sync: { ...gameplay.sync, status, acknowledgedRevision: status === "synced" ? 926 : 924 } });
        expect(finalSubmissionPhase(gameplay, authenticated)).toBeNull();
        expect(finalSubmissionPhase(finalized("pending"), authenticated)).toBe("sending");
        expect(finalSubmissionPhase(finalized("retry-needed"), authenticated)).toBe("failure");
        expect(finalSubmissionPhase(finalized("retry-needed"), authenticated, true)).toBe("sending");
        expect(finalSubmissionPhase(finalized("synced"), authenticated)).toBe("success");
        expect(finalSubmissionPhase(finalized("conflict"), authenticated)).toBe("conflict");
        expect(finalSubmissionPhase(finalized("retry-needed"), { kind: "live-continuity", deviceIdSuffix: "123456", context: { scorerId: "scorer", organizationId: "organization", runIds: ["run"] } })).toBe("auth-required");
        expect(finalSubmissionPhase(finalized("retry-needed"), authenticatedOffline)).toBe("auth-required");
    });

    it("uses the existing finalized retry and reconnect paths without creating another finalization", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(source).toContain('const result = await bridge.retryGameplaySync(gameplay.runId);');
        expect(source).toContain('else { setBusy(true); try { applyResult(await bridge.finalizeMatch(gameplay.runId)); } finally { setBusy(false); } }');
        expect(source.match(/bridge\.finalizeMatch\(gameplay\.runId\)/g)).toHaveLength(1);
        expect(source).toContain('Η ΑΠΟΣΤΟΛΗ ΟΛΟΚΛΗΡΩΘΗΚΕ');
        expect(source).toContain('Η ΑΠΟΣΤΟΛΗ ΔΕΝ ΟΛΟΚΛΗΡΩΘΗΚΕ');
        expect(source).toContain('Ο αγώνας έχει αποθηκευτεί με ασφάλεια τοπικά.');
        expect(source).toContain('finalSubmission === "failure" ? <button');
        expect(source).toContain('finalSubmission === "auth-required" ? <button');
        expect(source).not.toContain('finalSubmission === "conflict" ? <button type="button" className="is-primary"');
        expect(styles).toContain('.live-final-submission');
    });
    it("treats same-value factual corrections as renderer-only no-ops", () => {
        const target = (
            kind: KomoControlHistoricalEditTargetKind,
            currentPlayerId: string | null,
            currentValue?: "MADE" | "MISS",
        ): KomoControlHistoricalEditTarget => ({
            targetId: `target-${kind}`,
            kind,
            eventId: "event-1",
            currentPlayerId,
            canonicalSide: "HOME",
            candidatePlayerIds: ["player-1", "player-2"],
            sameTeamOnly: true,
            forwardPropagation: false,
            ...(currentValue ? { currentValue, allowedValues: ["MADE", "MISS"] } : {}),
            editable: true,
            readOnlyReason: null,
        });

        expect(historicalCorrectionIsNoop(target("SHOT_RESULT", null, "MADE"), { kind: "CORRECT_SHOT_RESULT", targetId: "target-SHOT_RESULT", made: true })).toBe(true);
        expect(historicalCorrectionIsNoop(target("SHOT_RESULT", null, "MISS"), { kind: "CORRECT_SHOT_RESULT", targetId: "target-SHOT_RESULT", made: false })).toBe(true);
        expect(historicalCorrectionIsNoop(target("FREE_THROW_RESULT", null, "MADE"), { kind: "CORRECT_FREE_THROW_RESULT", targetId: "target-FREE_THROW_RESULT", made: true })).toBe(true);
        expect(historicalCorrectionIsNoop(target("FREE_THROW_RESULT", null, "MISS"), { kind: "CORRECT_FREE_THROW_RESULT", targetId: "target-FREE_THROW_RESULT", made: false })).toBe(true);
        expect(historicalCorrectionIsNoop(target("SHOOTER", "player-1"), { kind: "CORRECT_PLAYER", targetId: "target-SHOOTER", playerId: "player-1" })).toBe(true);
        expect(historicalCorrectionIsNoop(target("SHOT_RESULT", null, "MISS"), { kind: "CORRECT_SHOT_RESULT", targetId: "target-SHOT_RESULT", made: true })).toBe(false);
        expect(historicalCorrectionIsNoop(target("SHOOTER", "player-1"), { kind: "CORRECT_PLAYER", targetId: "target-SHOOTER", playerId: "player-2" })).toBe(false);

        const source = fs.readFileSync(path.join(process.cwd(), "src/components/LiveControl.tsx"), "utf8");
        const guard = source.indexOf("if (historicalCorrectionIsNoop(activeTarget, action))");
        const preview = source.indexOf("bridge.previewScorerEventMutation", guard);
        expect(guard).toBeGreaterThan(-1);
        expect(preview).toBeGreaterThan(guard);
        expect(source).toContain("{ ...current, activeTargetId: null, error: null }");
    });

    it("exposes exactly eight primary scorer actions without FREE THROW", () => {
        expect(livePrimaryActions.map((action) => action.label)).toEqual(["SHOOT", "FOUL", "TURN OVER", "SUBS", "TIME OUT", "TECH. FOUL", "JUMP BALL", "OFFENSIVE FOUL"]);
        expect(livePrimaryActions).toHaveLength(8);
    });
    it("moves authoritative team identity and color together with presentation side", () => {
        const [left, right] = presentationTeams(gameplay);
        expect(left).toMatchObject({ side: "AWAY", gameColor: "#15803D" }); expect(right).toMatchObject({ side: "HOME", gameColor: "#DC2626" });
    });
    it("formats and derives a running clock without persistence ticks", () => {
        expect(formatLiveClock(295)).toBe("04:55"); expect(liveClockSeconds({ clockSeconds: 300, clockRunning: true, clockStartedAtMs: 1_000 }, 6_400)).toBe(295);
    });
    it("persists natural clock expiration once with CLOCK_SET zero only", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const naturalZero = source.slice(source.indexOf("if (!gameplay.clockRunning || displayedClock > 0 || autoStopRef.current) return;"), source.indexOf("    const enterAction", source.indexOf("if (!gameplay.clockRunning || displayedClock > 0 || autoStopRef.current) return;")));
        expect(naturalZero).toContain("autoStopRef.current = true;");
        expect(naturalZero).toContain('appendIntents([{ kind: "clock-set", remainingSeconds: 0 }])');
        expect(naturalZero).not.toContain('kind: "clock-stop"');
        expect(naturalZero).toContain("autoStopRef.current = false;");
        expect(naturalZero).not.toContain("closeFlow");
        expect(naturalZero).not.toContain("period-end");
        expect(naturalZero).not.toContain("finalizeMatch");
    });
    it("supports unlimited overtime and tie-allowed finish", () => {
        const tied = { ...gameplay, score: { home: 50, away: 50 } };
        expect(nextLivePeriod(tied)).toEqual({ kind: "OVERTIME", index: 1 });
        expect(nextLivePeriod({ ...tied, period: { kind: "OVERTIME", index: 7 } })).toEqual({ kind: "OVERTIME", index: 8 });
        expect(nextLivePeriod({ ...tied, rules: { ...tied.rules, resultPolicy: "ALLOW_TIE" } })).toBeNull(); expect(periodText({ kind: "REGULATION", index: 2 })).toBe("2η ΠΕΡΙΟΔΟΣ"); expect(periodText({ kind: "OVERTIME", index: 12 })).toBe("OT12");
    });
    it("renders truthful sync diagnostics and owner-bound reconnect without blocking gameplay", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8"); const app = fs.readFileSync(path.resolve("src/App.tsx"), "utf8"); const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(source).toContain('label: "LOCAL SAVED · SYNCED"'); expect(source).toContain('label: "LOCAL SAVED · SYNC PENDING"'); expect(source).toContain('label: "LOCAL SAVED · RETRY NEEDED"'); expect(source).toContain('label: "LOCAL SAVED · SESSION EXPIRED"'); expect(source).toContain('label: "LOCAL SAVED · SYNC CONFLICT"');
        expect(source).toContain('authState.kind === "live-continuity"'); expect(source).toContain('bridge.reconnectGameplaySync(gameplay.runId'); expect(source).toContain('bridge.onGameplaySyncStateChanged'); expect(source).toContain('REV {gameplay.eventHistoryRevision} · ACK {gameplay.sync.acknowledgedRevision}'); expect(source).toContain('const [reconnectBusy, setReconnectBusy]'); expect(source).not.toContain('setBusy(true); setReconnectError');
        expect(app).toContain('<LiveControl gameplay={matchGameplay} authState={authState}'); expect(styles).toContain('.live-reconnect-panel'); expect(styles).toContain('.live-sync.is-retry-needed');
    });
    it("renders authoritative partial period scores in HOME-AWAY order between the side controls", () => {
        expect(periodScoreLabel({ kind: "REGULATION", index: 4 })).toBe("Q4");
        expect(periodScoreLabel({ kind: "OVERTIME", index: 3 })).toBe("OT3");
        expect(periodScoreValue({ period: { kind: "REGULATION", index: 1 }, home: 12, away: 8 })).toBe("12-8");
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const strip = source.slice(source.indexOf('<div className="live-side-strip">'), source.indexOf('<div className="live-control-body">'));
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(strip).toContain('className="live-period-score-strip"');
        expect(strip).toContain("gameplay.periodScores.map((score)");
        expect(strip).toContain("periodScoreValue(score)");
        expect(strip).toContain('score.period.kind === gameplay.period.kind && score.period.index === gameplay.period.index ? "is-current"');
        expect(styles).toContain(".live-period-score-strip");
        expect(styles).toContain("overflow-x: auto");
    });
    it("records TEAM rebound without inventing a player identity", () => {
        expect(teamReboundIntent("HOME", true)).toEqual({ kind: "rebound", team: "HOME", offensive: true, teamRebound: true });
    });
    it("opens each team status panel only from STATUS while preserving rail, SUBS, and correction selection", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const playerHandler = source.slice(source.indexOf("const selectRailPlayer"), source.indexOf("const selectTechnicalStaffOffender"));
        const staffHandler = source.slice(source.indexOf("const selectTechnicalStaffOffender"), source.indexOf("const renderFlow ="));
        const regularRail = source.slice(source.indexOf("const candidates = railPlayers(current);"), source.indexOf("const toggleSubsPlayer"));
        const subsRail = source.slice(source.indexOf("const toggleSubsPlayer"), source.indexOf("const renderScoreTeam"));
        const sideStrip = source.slice(source.indexOf('<div className="live-side-strip">'), source.indexOf('<div className="live-control-body">'));

        expect(playerHandler).toContain("if (!flow || busy) return;");
        expect(playerHandler).not.toContain("setStatusTeam");
        expect(playerHandler).toContain("applyLocalCurrentPlayerCorrection(side, player.playerId)");
        expect(playerHandler).toContain('if (flow.step === "shooter") { setFlow');
        expect(playerHandler).toContain("await finishMissRebound(side, player.playerId)");
        expect(staffHandler).not.toContain("setStatusTeam");
        expect(staffHandler).toContain('void submitFoul({ side, technicalStaffSource: source');
        expect(regularRail.match(/setStatusTeam\(current\.side\)/g)).toHaveLength(1);
        expect(regularRail).toContain('className="live-status-button" disabled={Boolean(historyPreview)} onClick={() => setStatusTeam(current.side)}>STATUS</button>');
        expect(regularRail).toContain('if ((flow?.action === "SHOOT" && flow.step === "rebound-player") || (flow?.action === "REBOUND"');
        expect(regularRail).not.toContain("else setStatusTeam(current.side)");
        expect(sideStrip).not.toContain("setStatusTeam");
        expect(subsRail).toContain("toggleSubsPlayer(side, player.playerId, source)");
        expect(subsRail).not.toContain("setStatusTeam");
        expect(source).toContain('if (activeTarget) void previewHistoricalAction({ kind: "CORRECT_PLAYER", targetId: activeTarget.targetId, playerId });');
        expect(source).toContain('<button type="button" onClick={() => setStatusTeam(null)}>Κλείσιμο</button>');
    });
    it("projects authoritative shooting splits and approved efficiency in the STATUS table", () => {
        const authoritative = {
            points: 16,
            twoPointMade: 5,
            twoPointAttempts: 10,
            threePointMade: 1,
            threePointAttempts: 4,
            freeThrowMade: 3,
            freeThrowAttempts: 4,
            offensiveRebounds: 1,
            defensiveRebounds: 2,
            assists: 2,
            steals: 1,
            blocks: 0,
            turnovers: 2,
        };
        expect(liveStatusPlayerStatistics(authoritative)).toEqual({ points: 16, twoPoints: "5/10", threePoints: "1/4", freeThrows: "3/4", rebounds: 3, assists: 2, steals: 1, blocks: 0, turnovers: 2, efficiency: 11 });
        expect(liveStatusPlayerStatistics({})).toEqual({ points: 0, twoPoints: "0/0", threePoints: "0/0", freeThrows: "0/0", rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, efficiency: 0 });

        const twoPointMadeToMiss = { ...authoritative, points: 14, twoPointMade: 4 };
        const threePointMissToMade = { ...authoritative, points: 19, threePointMade: 2 };
        const freeThrowMadeToMiss = { ...authoritative, points: 15, freeThrowMade: 2 };
        expect(liveStatusPlayerStatistics(twoPointMadeToMiss)).toMatchObject({ points: 14, twoPoints: "4/10", efficiency: 8 });
        expect(liveStatusPlayerStatistics(threePointMissToMade)).toMatchObject({ points: 19, threePoints: "2/4", efficiency: 15 });
        expect(liveStatusPlayerStatistics(freeThrowMadeToMiss)).toMatchObject({ points: 15, freeThrows: "2/4", efficiency: 9 });
        expect(liveStatusPlayerStatistics({ ...authoritative })).toEqual(liveStatusPlayerStatistics(authoritative));

        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const statusPanel = source.slice(source.indexOf("{statusTeam ?"), source.indexOf("{selectedLogEvent ?"));
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(statusPanel).toContain("<span>PTS</span><span>2PTS</span><span>3PTS</span><span>1PTS</span><span>REB</span><span>AST</span><span>STL</span><span>BLK</span><span>TO</span><span>F</span><span>EFF</span>");
        expect(statusPanel).toContain("const statistics = liveStatusPlayerStatistics(player.statistics);");
        expect(statusPanel).toContain('player.onCourt ? "Στο παρκέ" : player.fouls.status === "ELIGIBLE" ? "Πάγκος" : player.fouls.status');
        expect(statusPanel).toContain("<span>{player.fouls.total}</span>");
        expect(statusPanel).not.toContain("foulIndicator(player.fouls)");
        expect(styles).toContain("repeat(3, 52px) repeat(7, 42px)");
        expect(styles).toContain("min-width: 880px");
    });
    it("completes only optional guided stages with Enter", () => {
        expect(canCompleteLiveFlow("SHOOT", "assist-choice")).toBe(true); expect(canCompleteLiveFlow("SHOOT", "assist")).toBe(true); expect(canCompleteLiveFlow("TURN_OVER", "steal")).toBe(false); expect(canCompleteLiveFlow("REBOUND", "rebound-player")).toBe(true); expect(canCompleteLiveFlow("FOUL", "offender")).toBe(false);
    });

    it("keeps paired steals on the opposing rail and distinguishes explicit no-steal from Enter early", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('if (flow.action === "TURN_OVER") return flow.step === "offender" || (flow.step === "steal" && side === flow.side);');
        expect(source).toContain('flow.step === "steal" && side === flow.side');
        expect(source).toContain('const finishTurnoverWithoutSteal = useCallback(async () => {');
        expect(source).toContain('const finishTurnoverEarly = useCallback(async () => {');
        expect(source).toContain('scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "STEALER" }');
        expect(source).toContain('if (flow?.action === "TURN_OVER" && flow.step === "steal") { void finishTurnoverEarly(); return; }');
        expect(source).toContain('onClick={() => void finishTurnoverWithoutSteal()}>ΧΩΡΙΣ STEAL</button>');
    });
    it("renders compact FIBA disciplinary indicators without changing identity", () => {
        expect(foulIndicator({ total: 5, category1TechnicalCount: 1, category2TechnicalCount: 0, disruptiveCount: 1, flagrantCount: 1, directDisqualification: false, status: "EXCLUDED", statusReason: "FIVE_FOULS" })).toBe("5F · T1×1 · D×1 · FL×1 · ΕΚΤΟΣ");
    });
    it("keeps the 1366x768 and 1920x1080 primary scorer surfaces in a bounded desktop grid", () => {
        const css = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(css).toMatch(/\.live-control-shell\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
        expect(css).toMatch(/\.live-control-shell\s*\{[^}]*grid-template-columns:\s*minmax\(360px, 30vw\) minmax\(720px, 1fr\);/s);
        expect(css).toMatch(/\.live-control-pane\s*\{[^}]*grid-template-rows:\s*clamp\(142px, 17vh, 164px\) 42px minmax\(0, 1fr\) 35px;/s);
        expect(css).toMatch(/\.live-control-body\s*\{[^}]*grid-template-columns:\s*minmax\(160px, 21%\) minmax\(0, 58%\) minmax\(160px, 21%\);/s);
        expect(css).toMatch(/@media \(max-height: 800px\)[\s\S]*\.live-primary-grid/);
        expect(css).toMatch(/@media \(min-width: 1700px\)[\s\S]*\.live-control-shell/);
        expect(css).toMatch(/\.live-event-workspace\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
        expect(css).toMatch(/\.live-log-list > button\s*\{[^}]*display:\s*flex;/s);
        expect(css).not.toContain(".live-log-head");
    });
    it("keeps keyboard shortcuts out of form fields and clock editing", () => {
        expect(liveKeyboardCommand(" ", false, false)).toBe("clock"); expect(liveKeyboardCommand(" ", false, true)).toBeNull(); expect(liveKeyboardCommand("Enter", true, false)).toBeNull(); expect(liveKeyboardCommand("Escape", true, true)).toBe("cancel");
    });
    it("renders safe event labels from IDs already present in the DTO", () => {
        expect(gameplayEventLabel({ eventId: "e", sequence: 2, occurredAt: 1, type: "TIMEOUT", team: "HOME", scorerEventGroupId: "atomic:e", scorerEventGroupOrdinal: 2, scorerEventGroupingSource: "LEGACY_ATOMIC", scorerEventGroupSafeForReconstruction: false, period: { kind: "REGULATION", index: 1 }, clockSeconds: 500, intent: { kind: "timeout", team: "HOME" } }, gameplay)).toContain("Home");
    });
    it("renders factual player and staff offenders in foul Game Log labels", () => {
        const labeledGameplay = {
            ...gameplay,
            teams: [
                { ...gameplay.teams[0], players: [{ playerId: "home-11", displayName: "ΚΑΚΑΛΗΣ ΙΩΑΝΝΗΣ", shirtNumber: "11", participating: true, onCourt: true, fouls: { total: 1, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE", statusReason: null }, statistics: {} }], bench: [{ personId: "coach-home", displayName: "ΝΙΚΟΣ ΠΡΟΠΟΝΗΤΗΣ", role: "HEAD_COACH", roleLabel: "Head Coach", source: "RUN" }] },
                { ...gameplay.teams[1], bench: [{ personId: "bench-away", displayName: "ΜΑΡΙΑ ΠΑΓΚΟΥ", role: "ACCOMPANYING_DELEGATION", roleLabel: "Bench", source: "RUN" }] },
            ],
        } as KomoControlSafeMatchGameplay;
        const historyItem = { eventId: "foul", sequence: 2, occurredAt: 1, team: "HOME" as const, scorerEventGroupId: "explicit:foul", scorerEventGroupOrdinal: 2, scorerEventGroupingSource: "EXPLICIT" as const, scorerEventGroupSafeForReconstruction: true, period: { kind: "REGULATION" as const, index: 1 }, clockSeconds: 500 };
        expect(gameplayEventLabel({ ...historyItem, type: "PERSONAL_FOUL", intent: { kind: "foul", offender: { kind: "PLAYER", playerId: "home-11" } } }, labeledGameplay)).toBe("Προσωπικό φάουλ · #11 ΚΑΚΑΛΗΣ ΙΩΑΝΝΗΣ");
        expect(gameplayEventLabel({ ...historyItem, type: "TECHNICAL_FOUL", intent: { kind: "foul", category: "CATEGORY_1", offender: { kind: "BENCH", personId: "coach-home", role: "HEAD_COACH" } } }, labeledGameplay)).toBe("Τεχνική ποινή GD · COACH · ΝΙΚΟΣ ΠΡΟΠΟΝΗΤΗΣ");
        expect(gameplayEventLabel({ ...historyItem, eventId: "bench-foul", team: "AWAY", type: "DISQUALIFYING_FOUL", intent: { kind: "foul", offender: { kind: "BENCH", personId: "bench-away", role: "ACCOMPANYING_DELEGATION" } } }, labeledGameplay)).toBe("Αποβολή · BENCH · ΜΑΡΙΑ ΠΑΓΚΟΥ");
    });
    it("renders authoritative GOAL FOUL labels and team-only color presentation", () => {
        const labeledGameplay = {
            ...gameplay,
            teams: [
                { ...gameplay.teams[0], players: [{ playerId: "home-6", displayName: "ΠΑΠΑΔΟΠΟΥΛΟΣ ΝΙΚΟΣ", shirtNumber: "6", participating: true, onCourt: true, fouls: { total: 0, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE", statusReason: null }, statistics: {} }] },
                { ...gameplay.teams[1], players: [{ playerId: "away-7", displayName: "AWAY PLAYER", shirtNumber: "7", participating: true, onCourt: true, fouls: { total: 0, category1TechnicalCount: 0, category2TechnicalCount: 0, disruptiveCount: 0, flagrantCount: 0, directDisqualification: false, status: "ELIGIBLE", statusReason: null }, statistics: {} }] },
            ],
        } as KomoControlSafeMatchGameplay;
        const item = { eventId: "shot", sequence: 2, occurredAt: 1, team: "HOME" as const, playerId: "home-6", scorerEventGroupId: "explicit:shot", scorerEventGroupOrdinal: 2, scorerEventGroupingSource: "EXPLICIT" as const, scorerEventGroupSafeForReconstruction: true, period: { kind: "REGULATION" as const, index: 1 }, clockSeconds: 500, intent: { kind: "shot" as const, team: "HOME" as const, playerId: "home-6", points: 2 as const, made: true } };
        expect(gameplayEventLabel({ ...item, type: "TWO_POINT", isGoalFoul: true }, labeledGameplay)).toBe("2PT εύστοχο GOAL FOUL · #6 ΠΑΠΑΔΟΠΟΥΛΟΣ ΝΙΚΟΣ");
        expect(gameplayEventLabel({ ...item, type: "THREE_POINT", intent: { ...item.intent, points: 3 }, isGoalFoul: true }, labeledGameplay)).toBe("3PT εύστοχο GOAL FOUL · #6 ΠΑΠΑΔΟΠΟΥΛΟΣ ΝΙΚΟΣ");
        expect(gameplayEventLabel({ ...item, type: "TWO_POINT" }, labeledGameplay)).toBe("2PT εύστοχο · #6 ΠΑΠΑΔΟΠΟΥΛΟΣ ΝΙΚΟΣ");
        expect(gameplayEventTeamPresentation({ ...item, type: "TWO_POINT" }, labeledGameplay)).toEqual({ teamName: "Home", gameColor: "#DC2626" });
        expect(gameplayEventTeamPresentation({ ...item, eventId: "away-shot", team: "AWAY", playerId: "away-7", type: "TWO_POINT", intent: { ...item.intent, team: "AWAY", playerId: "away-7" } }, labeledGameplay)).toEqual({ teamName: "Away", gameColor: "#15803D" });
        expect(gameplayEventTeamPresentation({ ...item, type: "TWO_POINT" }, { ...labeledGameplay, teams: [{ ...labeledGameplay.teams[0], gameColor: null }, labeledGameplay.teams[1]] })).toEqual({ teamName: "Home", gameColor: null });
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('className="live-log-team-name" style={teamPresentation.gameColor ? { color: teamPresentation.gameColor } : undefined}');
        expect(source).toContain('{teamPresentation.teamName}</span>');
        expect(source).toContain('history.filter(isScorerFacingGameplayEvent).map((item) => {');
    });
    it("keeps administrative early completion in canonical history but out of the scorer Game Log", () => {
        expect(isScorerFacingGameplayEvent({ type: "PENALTY_ADMINISTRATION_ENDED" })).toBe(false);
        expect(isScorerFacingGameplayEvent({ type: "FLAGRANT_FOUL" })).toBe(true);
        expect(isScorerFacingGameplayEvent({ type: "FREE_THROW" })).toBe(true);
        expect(isScorerFacingGameplayEvent({ type: "TURNOVER" })).toBe(true);
    });
    it("shades atomic Game Log rows only by their full-history scorer-event ordinal", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const css = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        const explicit = { scorerEventGroupOrdinal: 7, scorerEventGroupingSource: "EXPLICIT" as const };
        const legacy = { scorerEventGroupOrdinal: 7, scorerEventGroupingSource: "LEGACY_ATOMIC" as const };
        expect(gameLogGroupClass(explicit.scorerEventGroupOrdinal)).toBe(gameLogGroupClass(legacy.scorerEventGroupOrdinal));
        expect(gameLogGroupClass(7)).toBe(gameLogGroupClass(7));
        expect(gameLogGroupClass(7)).not.toBe(gameLogGroupClass(8));
        expect(gameLogGroupClass(7)).toBe(gameLogGroupClass(13));
        expect(source).toContain('history.filter(isScorerFacingGameplayEvent).map((item) => {');
        expect(source).toContain('const teamPresentation = gameplayEventTeamPresentation(item, gameplay);');
        expect(source).toContain('return <button type="button" key={item.eventId} className={gameLogGroupClass(item.scorerEventGroupOrdinal)}');
        expect(source).toContain('style={teamPresentation.gameColor ? { color: teamPresentation.gameColor } : undefined}');
        expect(source).toContain('onDoubleClick={() => void openHistoryPreview(item)}');
        expect(css.match(/\.live-log-group-[0-5]\s*\{/g)).toHaveLength(6);
        expect(css).toContain("background: var(--live-log-group-bg, transparent)");
        expect(css).toContain("box-shadow: inset 3px 0 0 var(--live-log-group-accent, transparent)");
        expect(css.slice(css.indexOf(".live-log-group-0"), css.indexOf(".live-log-list time"))).not.toContain("--live-team");
    });
    it("routes safe editable Game Log groups into the historical edit workspace", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const [historyPreview, setHistoryPreview] = useState<HistoricalScorerEventPreview | null>(null);');
        expect(source).toContain('const [historyEdit, setHistoryEdit] = useState<HistoricalEditSession | null>(null);');
        expect(source).toContain('if (!item.scorerEventGroupSafeForReconstruction)');
        expect(source).toContain('await bridge.getScorerEventGroup(gameplay.runId, item.scorerEventGroupId)');
        expect(source).toContain('if (!result.group?.safeForReconstruction)');
        expect(source).toContain('reconstructScorerEventGroup(result.group, gameplay)');
        expect(source).toContain('await bridge.getScorerEventEditContext(gameplay.runId, item.scorerEventGroupId)');
        expect(source).toContain('if (context?.editCapabilities.safeForEdit)');
        expect(source).toContain('reconstructHistoricalScorerEventEdit(context, gameplay)');
        expect(source).toContain('ΕΠΕΞΕΡΓΑΣΙΑ ΣΥΜΒΑΝΤΟΣ');
        expect(source).toContain('ΠΡΟΒΟΛΗ ΣΥΜΒΑΝΤΟΣ');
        expect(source).toContain('historyEdit ? renderHistoryEdit()');
        expect(source).toContain('historyPreview ? renderHistoryPreview()');
        expect(source).toContain('title="Διπλό κλικ για προβολή ή επεξεργασία συμβάντος"');
        expect(source).not.toContain('else setSelectedLogEvent(item);');
    });
    it("stages historical edits through authoritative preview and historical candidates", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('if (flow || subsModal || busy || correctionTarget || selectedLogEvent || historyPreview || historyEdit || historyPreviewLoading || resumableFlow)');
        expect(source).toContain('const result = await bridge.previewScorerEventMutation');
        expect(source).toContain('action: KomoControlScorerEventDraftAction');
        expect(source).toContain('context.historicalState.teams.find');
        expect(source).toContain('const candidatePlayerIds = new Set');
        expect(source).toContain('{ kind: "CORRECT_PLAYER", targetId: activeTarget.targetId, playerId }');
        expect(source).toContain('{ kind: "CORRECT_SHOT_RESULT", targetId: activeTarget.targetId, made: true }');
        expect(source).toContain('{ kind: "CORRECT_FREE_THROW_RESULT", targetId: activeTarget.targetId, made: true }');
        expect(source).toContain('return item.editTargetId && item.editable');
        expect(source).toContain('<strong>{active ? "" : item.value}</strong>');
        expect(source).toContain('activeTarget?.kind === "FREE_THROW_RESULT"');
        expect(source).toContain('{ kind: "FREE_THROW_RESULT", made: true }');
        expect(source).toContain('{ kind: "ASSIST", playerId: null }');
        expect(source).toContain('{ kind: "STEALER", playerId: null }');
        expect(source).toContain('{ kind: "REBOUNDER", team: current.side, teamRebound: true }');
        expect(source).toContain('className="live-flow-trail is-history-preview is-history-edit"');
        const gameLogEntryPoint = source.slice(source.indexOf('<section className="live-game-log">'), source.indexOf('{renderRail(leftTeam)}'));
        expect(gameLogEntryPoint).not.toContain('setCorrectionTarget(item)');
    });
    it("shares factual RESULT and FT correction between current and historical scorer events", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('mode: "HISTORY" | "CURRENT"');
        expect(source).toContain('const openCurrentCorrection = useCallback');
        expect(source).toContain('await bridge.previewScorerEventMutation');
        expect(source).toContain('await bridge.mutateScorerEventGroup');
        expect(source).toContain('if (historyEdit.mode === "CURRENT")');
        expect(source).toContain('sourceEventId: next.latestEvent?.eventId');
        expect(source).not.toContain('CORRECT_SHOT_TYPE');
    });
    it("keeps current factual corrections on the shared durable editor or a renderer-local snapshot", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('interface LocalCurrentCorrection');
        expect(source).toContain('correctionKind?: KomoControlHistoricalEditTargetKind');
        expect(source).toContain('if (durableCorrection) void openCurrentCorrection');
        expect(source).toContain('else if (localCorrection) openLocalCurrentPlayerCorrection');
        expect(source).toContain('if (applyLocalCurrentPlayerCorrection(side, player.playerId)) return;');
        expect(source).toContain('if (playerId === currentPlayerId) setFlow(resumeFlow);');
        expect(source).toContain('if (historyEdit.mode === "CURRENT") { setFlow(historyEdit.resumeFlow); closeHistoricalWorkspace(); }');
        expect(source).toContain('if (event.key === "Escape") { setFlow(localCurrentCorrection.resumeFlow); setLocalCurrentCorrection(null); }');
        expect(source).toContain('if (historyEdit.mode === "CURRENT") { if (!historyEdit.activeTargetId) { closeHistoricalWorkspace(); setFlow(null); } }');
        expect(source).toContain('{activeLocalCorrection ? "" : item.value}');
        expect(source).toContain('{activeTrailEntry?.label ?? "FT"} MADE');
        expect(source.indexOf('await bridge.previewScorerEventMutation')).toBeLessThan(source.indexOf('await bridge.mutateScorerEventGroup'));
    });
    it("keeps a current Shooting Foul RESULT editable after progression to FT1", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('getScorerEventEditContext(gameplay.runId, scorerEventGroupId, { mode: "CURRENT_OPEN", scorerEventId: flow.scorerEventId })');
        expect(source).toContain('historyEdit.mode === "CURRENT" && historyEdit.resumeFlow?.scorerEventId && !historyEdit.context.group.scorerEventTerminal');
        expect(source).toContain('...(currentMode ? { mode: currentMode } : {}), events, action');
        expect(source).toContain('...(currentMode ? { mode: currentMode } : {}), events: result.preview.draftEvents');
        expect(source).toContain('const refreshMode = result.preview.normalizedGroup.scorerEventTerminal ? undefined : currentMode;');
        expect(source).toContain('const currentPreview = reconstructHistoricalScorerEventEdit(context, next);');
        expect(source).toContain('plan?.kind === "ASSIST"');
        expect(source).toContain('if (historicalCorrectionIsNoop(activeTarget, action))');
        expect(source.indexOf('if (historicalCorrectionIsNoop(activeTarget, action))')).toBeLessThan(source.indexOf('bridge.previewScorerEventMutation'));
        expect(source).not.toContain('setFlow(historyEdit.resumeFlow); await bridge.previewScorerEventMutation');
    });
    it("saves or deletes one complete scorer-event group atomically", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('if (!historyEdit.dirty) { closeHistoricalWorkspace(); return; }');
        expect(source).toContain('kind: "REPLACE_GROUP"');
        expect(source).toContain('kind: "DELETE_GROUP"');
        expect(source).toContain('expectedHistoryRevision: historyEdit.expectedHistoryRevision');
        expect(source).toContain('disabled={busy || !historyEdit.context.editCapabilities.canDeleteGroup}');
        expect(source).toContain('disabled={busy || !historyPreviewContext?.editCapabilities.canDeleteGroup}');
        expect(source).toContain('Θέλεις να διαγράψεις ολόκληρο το συμβάν;');
        expect(source).not.toContain('removeGameplayEvent(gameplay.runId, historyEdit');
        expect(source).not.toContain('correctGameplayEvent(gameplay.runId, historyEdit');
    });
    it("keeps historical ENTER and ESC scoped to the staged editor", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('if (historyEdit) {');
        expect(source).toContain('else if (historyEdit.activeTargetId) setHistoryEdit');
        expect(source).toContain('if (!historyEdit.activeTargetId && !historyDeleteConfirm) void saveHistoricalEdit();');
        expect(source).toContain('busy || Boolean(historyPreview) || Boolean(historyEdit) || Boolean(localCurrentCorrection) || Boolean(subsModal)');
        expect(source).toContain('ENTER · αποθήκευση');
        expect(source).toContain('ESC · ακύρωση');
    });
    it("starts player-led guided events without a generic team question", () => {
        expect(firstLiveFlowStep("SHOOT")).toBe("shooter");
        expect(firstLiveFlowStep("TURN_OVER")).toBe("offender");
        expect(firstLiveFlowStep("SUBS")).toBe("out");
        expect(firstLiveFlowStep("FOUL")).toBe("offender");
    });
    it("keeps SUBS as an isolated two-team modal over the current scorer flow", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const [subsModal, setSubsModal] = useState<SubsModalState | null>(null);');
        expect(source).not.toContain("suspendedFlow");
        expect(source).not.toContain('flow.action === "SUBS"');
        expect(source).toContain('if (action === "SUBS") {');
        expect(source).toContain('setSubsModal({ drafts: { HOME: createSubsTeamDraft(team("HOME")), AWAY: createSubsTeamDraft(team("AWAY")) }, scorerEventId: crypto.randomUUID(), error: null, mode: "ORDINARY", mandatoryOutIds: { HOME: [], AWAY: [] } });');
        expect(source).toContain('(hasPendingPenalty && action.id !== "SUBS")');
        expect(source).toContain('const intents = [...substitutionIntentsFor("HOME"), ...substitutionIntentsFor("AWAY")];');
        expect(source).toContain('const next = await appendIntents(intents);');
        expect(source).toContain('replacementShooterRequired: true, step: "shooter"');
        expect(source).toContain('if (subsModal) {');
        expect(source).toContain('if (event.key === "Escape" || event.key === "Enter" || modalCommand)');
        expect(source).toContain('if (event.key === "Escape" && subsModal.mode === "ORDINARY") setSubsModal(null);');
    });
    it("keeps one guided event open while allowing SUBS to suspend and resume it", () => {
        for (const action of ["SHOOT", "FOUL", "TURN_OVER", "TIME_OUT", "TECH_FOUL", "JUMP_BALL", "OFFENSIVE_FOUL"] as const) {
            expect(livePrimaryActionAvailable(action, "SHOOT")).toBe(false);
        }
        expect(livePrimaryActionAvailable("SHOOT", "SHOOT")).toBe(false);
        expect(livePrimaryActionAvailable("SUBS", "SHOOT")).toBe(true);
        expect(livePrimaryActionAvailable("SUBS", "SUBS")).toBe(false);
        expect(livePrimaryActionAvailable("FOUL", null)).toBe(true);

        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const [subsModal, setSubsModal] = useState<SubsModalState | null>(null);');
        expect(source).toContain('if (action === "SUBS") {');
        expect(source).toContain('setSubsModal({ drafts: { HOME: createSubsTeamDraft(team("HOME")), AWAY: createSubsTeamDraft(team("AWAY")) }, scorerEventId: crypto.randomUUID(), error: null, mode: "ORDINARY", mandatoryOutIds: { HOME: [], AWAY: [] } });');
        expect(source).not.toContain('suspendedFlow');
        expect(source).not.toContain('flow.action === "SUBS"');
        const startAction = source.slice(source.indexOf('const startAction = useCallback'), source.indexOf('useEffect(() => {', source.indexOf('const startAction = useCallback')));
        expect(startAction).not.toContain('appendIntent');
    });
    it("forces authoritative on-court ineligible players through the existing atomic SUBS modal", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(source).toContain('player.onCourt && player.fouls.status !== "ELIGIBLE"');
        expect(source).toContain('mode: "MANDATORY"');
        expect(source).toContain('drafts.HOME.selectedOutIds = [...mandatoryReplacementIds.HOME]');
        expect(source).toContain('drafts.AWAY.selectedOutIds = [...mandatoryReplacementIds.AWAY]');
        expect(source).toContain("mandatoryReplacementIds[side].length > eligibleBench(team(side)).length");
        expect(source).toContain('current.mode === "MANDATORY" && source !== "IN"');
        expect(source).toContain('disabled={locked} className={`live-subs-player is-${source.toLowerCase()}${selected ? " is-selected" : ""}`}');
        expect(source).toContain('`${foulIndicator(player.fouls)} · REQUIRED OUT`');
        expect(styles).toContain('.live-subs-player.is-out.is-selected');
        expect(source).toContain('if (event.key === "Escape" && subsModal.mode === "ORDINARY") setSubsModal(null);');
        expect(source).toContain('subsModal.mode === "ORDINARY" ? <button type="button" className="live-subs-cancel"');
        expect(source).toContain('const intents = [...substitutionIntentsFor("HOME"), ...substitutionIntentsFor("AWAY")];');
        expect(source).toContain('const next = await appendIntents(intents.map');
        expect(source).toContain('if (player.fouls.status !== "ELIGIBLE") return false;');
        expect(source).toContain('replacementShooterRequired: true, step: "shooter"');
        expect(source).not.toContain('player.onCourt = false');
    });

    it("seeds one scorer-event identity per LiveControl action and records terminal workflow decisions", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('scorerEventId: crypto.randomUUID(), stoppageId: crypto.randomUUID()');
        expect(source).toContain('scorerEventId: crypto.randomUUID(), error: null');
        expect(source).toContain('const withScorerEvent = useCallback');
        expect(source).toContain('scorerEventTerminal: { reason: "NATURAL", decisions: { steal: "NONE" } }');
        expect(source).toContain('const unresolvedStep: NonNullable<KomoControlScorerEventTerminal["unresolvedStep"]>');
        expect(source).toContain('? "CHOOSE_SHOOTER"');
        expect(source).toContain(': `FT${attemptIndex}` as "FT1" | "FT2" | "FT3"');
        expect(source).toContain('penaltyShooterPlayerId: flow.playerId');
    });
    it("renders one confirmation-free alternating-possession control using the arrow target team", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const clockArea = source.slice(source.indexOf('<header className="live-scoreboard">'), source.indexOf('<div className="live-primary-grid">'));
        expect(source).toContain('const useArrow = useCallback(async () => { await appendIntent({ kind: "alternating-possession", scorerEventId: crypto.randomUUID(), scorerEventTerminal: { reason: "NATURAL" } }); }, [appendIntent]);');
        expect(source).not.toContain('window.confirm("Χρήση της εναλλασσόμενης κατοχής;")');
        expect(clockArea).toContain('onClick={() => void useArrow()}>ΚΑΤΟΧΗ · {team(gameplay.alternatingPossession).teamName}</button>');
        expect(clockArea).toContain('className={gameplay.alternatingPossession === "HOME" ? "is-home" : "is-away"}');
        expect(clockArea).not.toContain('gameplay.possession');
        expect(clockArea).not.toContain('Βέλος · {gameplay.alternatingPossession}');
    });

    it("uses the authoritative clock state for prominent running and stopped clock presentation", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const clockArea = source.slice(source.indexOf('<header className="live-scoreboard">'), source.indexOf('<div className="live-primary-grid">'));
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(clockArea).toContain('className={`live-clock ${gameplay.clockRunning ? "is-running" : "is-stopped"}`}');
        expect(clockArea).toContain('<span className="live-clock-time">{formatLiveClock(displayedClock)}</span>');
        expect(clockArea).toContain('onClick={() => void toggleClock()}');
        expect(source).toContain('const toggleClock = useCallback');
        expect(source).not.toContain('const [clockRunning, setClockRunning]');
        expect(clockArea).toContain('ΚΑΤΟΧΗ · {team(gameplay.alternatingPossession).teamName}');
        expect(styles).toContain('.live-clock .live-clock-time');
    });
    it("renders the authoritative period timeout allowance without deriving it in React", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const scoreboard = source.slice(source.indexOf("const renderScoreTeam"), source.indexOf('<main className="live-control-shell">'));
        expect(scoreboard).toContain('{current.timeouts}/{current.timeoutAllowance}');
        expect(scoreboard).toContain('Τάιμ άουτ ${current.timeouts}/${current.timeoutAllowance}');
        expect(scoreboard).not.toContain("gameplay.period.index <= 2");
        expect(gameplay.teams.map((team) => `${team.timeouts}/${team.timeoutAllowance}`)).toEqual(["2/3", "3/3"]);
    });
    it("routes ordinary and shooting fouls through rails into engine-derived penalties", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('if (action === "SHOOT") return "shooter";');
        expect(source).toContain('if (action === "FOUL") return "offender";');
        expect(source).toContain('setFlow({ ...next, points: 2 });');
        expect(source).toContain('setFlow({ ...next, foulType: "PERSONAL_FOUL", context: "NON_SHOOTING" });');
        expect(source).toContain('const selectShotPoints = (points: 2 | 3)');
        expect(source).toContain('onClick={() => selectShotPoints(3)}>3PT</button>');
        expect(source).toContain('className="live-context-exception" onClick={() => setFlow({ ...flow, context: "SHOOTING", step: "shot-points" })}>SHOOTING FOUL</button>');
        expect(source).not.toContain('if (flow.step === "points") return <><h3>SHOT TYPE</h3>');
        expect(source).not.toContain('flow.action === "FOUL" ? "SHOOTING FOUL" : "SHOOTING"');
        expect(source).toContain('flow.context === "SHOOTING" ? "shot-victim" : "victim"');
        expect(source).toContain('if (flow.step === "victim") { await submitFoul({ fouledPlayerId: player.playerId }); return; }');
        expect(source).toContain('const nextFlow = { ...flow, made,');
        expect(source).toContain('if (made) { setFlow({ ...nextFlow, step: "assist-choice" }); return; }');
        expect(source).toContain('const foulState = flow.sourceFoulEventId ? await correctSpecific(flow.sourceFoulEventId, foul) : await appendIntent(foul);');
        expect(source).toContain('label: `FT ${attemptIndex}`');
        expect(source).toContain('action: "REBOUND", step: "rebound-player"');
        expect(source).toContain('const severeContactFoul = value.action === "TECH_FOUL" && isSevereContactFoul(value.foulType);');
        expect(source).toContain('const playerContactDisqualification = value.action === "TECH_FOUL" && value.foulType === "DISQUALIFYING_FOUL" && value.offender?.kind === "PLAYER";');
        expect(source).toContain('if (value.action !== "FOUL" && !playerContactFoul && !staffDisqualification) return steps;');
        expect(source).toContain('label: "FOULER"');
        expect(source).toContain('step: flow.context === "SHOOTING" ? "shot-victim" : "victim"');
        expect(source).toContain('if (flow.action === "FOUL" && flow.step === "offender") steps.push({ step: "offender", label: "FOULER", value: "" });');
        expect(source).toContain('else if (flow.action === "FOUL" && (flow.step === "victim" || flow.step === "shot-victim")) steps.push({ step: flow.step, label: "DRAWN BY", value: "", teamSide: opposite(flow.side!) });');
        const reboundRenderer = source.slice(source.indexOf('if (flow.action === "REBOUND")'), source.indexOf('if (flow.action === "TURN_OVER")'));
        expect(reboundRenderer).not.toContain("HOME TEAM");
        expect(reboundRenderer).not.toContain("AWAY TEAM");
    });

    it("highlights only the active 3PT SHOT TYPE trail state without changing shot selection behavior", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(source).toContain('const isThreePointShotType = flow.action === "SHOOT" && item.step === "points" && flow.points === 3;');
        expect(source).toContain('const itemClassName = [isThreePointShotType ? "is-three-point" : "", itemTeam ? "is-team-owned" : ""].filter(Boolean).join(" ") || undefined;');
        expect(source).toContain('setFlow({ ...next, points: 2 });');
        expect(source).toContain('onClick={() => selectShotPoints(3)}>3PT</button>');
        expect(styles).toContain('.live-flow-trail button.is-three-point');
    });
    it("clears transient foul state on natural close or Escape before a new event opens", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const closeFlow = useCallback(() => { setFlow(null); setCorrectionTarget(null); }, []);');
        expect(source).toContain('const next: Flow = { action, step: firstLiveFlowStep(action), scorerEventId: crypto.randomUUID(), stoppageId: crypto.randomUUID() };');
        expect(source).toContain('if (!next) return;');
        expect(source).toContain('else closeFlow();');
    expect(source).toContain('flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "PLAYER"');
    expect(source).toContain('if ((flow?.action === "PENALTY" || openMadeShootingFoul) && flow?.committedEventId && bridge)');
        expect(source).toContain('if (!flow) setFlow({ action: "PENALTY", step: "shooter" });');
        expect(source).toContain('disabled={busy || Boolean(historyPreview) || Boolean(historyEdit) || Boolean(localCurrentCorrection) || Boolean(subsModal) || (hasPendingPenalty && action.id !== "SUBS") || gameplay.lifecycle !== "live"');
        expect(source).toContain('replacementShooterRequired: false, step: "free-throw"');
        expect(source).toContain('if (flow.replacementShooterRequired || !shooterId) return <><h3>CHOOSE SHOOTER</h3>');
    });
    it("keeps turnover trail positions empty until their factual player selection", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('else if (flow.step === "offender") steps.push({ step: "offender", label: "TURNOVER BY", value: "" });');
        expect(source).toContain('if (flow.step === "steal") steps.push({ step: "steal", label: "STEALER", value: flow.stealerId ? flowPlayerLabel(flow.stealerId) : "", playerId: flow.stealerId, teamSide: flow.stealerId ? undefined : flow.side, correctionKind: "STEALER" });');
        expect(source).toContain('setFlow({ ...flow, stealerId: player.playerId });');
        expect(source).toContain('flow.baseIntent ? await appendIntents([flow.baseIntent, steal]) : await appendIntent(steal);');
        expect(source).toContain('if (next) closeFlow();');
        expect(source).toContain('finishTurnoverWithoutSteal');
    });

    it("derives team-owned trail presentation from player and side metadata without using presentation position", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(source).toContain('playerId?: string;');
        expect(source).toContain('teamSide?: Side;');
        expect(source).toContain('const trailTeam = (item: FlowTrailEntry) => item.playerId');
        expect(source).toContain('candidate.players.some((player) => player.playerId === item.playerId)');
        expect(source).toContain('teamSide: opposite(flow.side!)');
        expect(source).toContain('teamSide: opposite(flow.shotSide!)');
        expect(source).toContain('teamSide: penaltyBeneficiaryTeam');
        expect(source).toContain('teamSide: flow.stealerId ? undefined : flow.side');
        expect(source).toContain('style={itemTeam ? teamColorStyle(itemTeam) : undefined}');
        expect(source).not.toContain('presentationSide: item');
        expect(styles).toContain('.live-flow-trail button.is-team-owned, .live-flow-trail span.is-team-owned');
        expect(styles).toContain('border-color: var(--live-team)');
        expect(styles).toContain('color-mix(in srgb, var(--live-team) 15%, #0a1c27)');
    });

    it("maps the five technical-foul scorer choices directly and keeps Category 2 player-only", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain(">ΤΕΧΝ. ΠΟΙΝΗ</Choice>");
        expect(source).toContain(">ΤΕΧΝ. ΠΟΙΝΗ GD</Choice>");
        expect(source).toContain(">FLAGRANT GD</Choice>");
        expect(source).toContain(">DISRUPTIVE</Choice>");
        expect(source).toContain(">DISQUALIFYING</Choice>");
        expect(source).toContain('foulType: "TECHNICAL_FOUL", category: "CATEGORY_2", context: "NON_CONTACT", step: "offender"');
        expect(source).toContain('foulType: "TECHNICAL_FOUL", category: "CATEGORY_1", context: "NON_CONTACT", step: "offender"');
        expect(source).not.toContain(">CATEGORY 1</Choice>");
        expect(source).not.toContain(">CATEGORY 2</Choice>");
        expect(source).toContain('flow.foulType === "TECHNICAL_FOUL" && flow.category === "CATEGORY_1"');
        expect(source).toContain('const beneficiaryTeam = gameplay.penalty?.entitlements.find((item) => gameplay.penalty?.activePenaltyIds.includes(item.penaltyId))?.beneficiaryTeam;');
        expect(source).toContain('if (flow.step === "shooter" || flow.step === "free-throw") return side === beneficiaryTeam;');
    });

    it("shows only the expected open technical-foul trail fields before factual rail selections", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const technicalFoul = flow.action === "TECH_FOUL" && flow.foulType === "TECHNICAL_FOUL";');
        expect(source).toContain('if (technicalFoul && flow.step === "offender" && !flow.offender) steps.push({ step: "offender", label: "FOUL", value: "" });');
        expect(source).toContain('const technicalPenalty = flow.action === "PENALTY" && flow.foulType === "TECHNICAL_FOUL";');
        expect(source).toContain('steps.push({ step: "offender", label: flow.action === "FOUL" || isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL" ? "FOULER" : "FOUL", value: offender, playerId: flow.offender.kind === "PLAYER" ? flow.offender.playerId : undefined, teamSide: flow.offender.kind === "BENCH" ? flow.side : undefined, correctionKind: flow.foulType === "TECHNICAL_FOUL" ? "TECHNICAL_PLAYER" : "FOULER" });');
        expect(source).toContain('steps.push({ step: "offender", label: "FOUL", value: offender, frozen: true, playerId: flow.offender.kind === "PLAYER" ? flow.offender.playerId : undefined, teamSide: flow.offender.kind === "BENCH" ? flow.side : undefined, sourceEventId: flow.sourceFoulEventId, correctionKind: "TECHNICAL_PLAYER" });');
        expect(source).toContain('if (manualPenaltyShooter && flow.step === "shooter" && !flow.playerId) steps.push({ step: "shooter", label: "CHOOSE SHOOTER", value: "", teamSide: penaltyBeneficiaryTeam });');
        expect(source).toContain('else if (manualPenaltyShooter && flow.playerId) steps.push({ step: "shooter", label: "CHOOSE SHOOTER", value: flowPlayerLabel(flow.playerId), playerId: flow.playerId, correctionKind: "FREE_THROW_SHOOTER" });');
        expect(source).toContain('const preservedPenaltyTrail = flow.action === "PENALTY" && ((flow.trail?.length ?? 0) > 0 || technicalPenalty);');
        expect(source).toContain('preservedReboundTrail || preservedPenaltyTrail ? "is-preserved-trail-card" : ""');
        expect(source).not.toContain('technicalPenalty && flow.step === "victim"');
        expect(source).not.toContain('technicalPenalty && flow.step === "rebound-player"');
    });

    it("keeps severe and disqualifying foul trails open only for their current rail selections", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const awaitingSevereOrDisqualifyingOffender = flow.action === "TECH_FOUL"');
        expect(source).toContain('if (awaitingSevereOrDisqualifyingOffender) steps.push({ step: "offender", label: "FOULER", value: "" });');
        expect(source).toContain('const playerContactTechFoul = flow.action === "TECH_FOUL" && (isSevereContactFoul(flow.foulType) || playerContactDisqualification);');
        expect(source).toContain('if (playerContactTechFoul && (flow.step === "victim" || flow.step === "shot-victim") && !flow.fouledPlayerId) steps.push({ step: flow.step, label: "DRAWN BY", value: "", teamSide: opposite(flow.side!) });');
        expect(source).toContain('flow.context === "SHOOTING" && flow.step === "assist" && !flow.assistPlayerId');
        expect(source).toContain('const manualPenaltyShooter = technicalPenalty || (flow.action === "PENALTY" && flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "BENCH");');
        expect(source).toContain('manualPenaltyShooter && flow.step === "shooter" && !flow.playerId');
        expect(source).not.toContain('manualPenaltyShooter && flow.step === "victim"');
        expect(source).not.toContain('playerContactTechFoul && flow.step === "rebound-player"');
    });

    it("submits a technical foul from rails without duplicate staff targets or a confirmation step", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('if (flow.action === "TECH_FOUL" && flow.foulType === "TECHNICAL_FOUL") {');
        expect(source).toContain('await submitFoul({ side, offender: { kind: "PLAYER", playerId: player.playerId } });');
        expect(source).toContain('void submitFoul({ side, technicalStaffSource: source, offender: { kind: "BENCH", personId: `coach:${side}`, role: "HEAD_COACH" } });');
        expect(source).toContain('scorerEventContext: { technicalStaffSource: value.technicalStaffSource }');
        expect(source).toContain('const technicalCategory1 = flow.action === "TECH_FOUL" && flow.foulType === "TECHNICAL_FOUL" && flow.category === "CATEGORY_1";');
        expect(source).not.toContain('const showBenchChoices = flow.foulType === "DISQUALIFYING_FOUL"');
        expect(source).toContain('selectTechnicalStaffOffender(current.side, "COACH")');
        expect(source).toContain('selectTechnicalStaffOffender(current.side, "BENCH")');
    });

    it("ends an open technical administration through the shared early-end path without inventing free-throw facts", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('value.foulType === "TECHNICAL_FOUL" || value.foulType === "DISQUALIFYING_FOUL"');
        expect(source).toContain('if (flow?.action === "TECH_FOUL" && !flow.committedEventId) { closeFlow(); return; }');
        expect(source).toContain('flow?.action === "PENALTY" && (flow.foulType === "PERSONAL_FOUL" || flow.foulType === "TECHNICAL_FOUL" || isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL") && flow.committedEventId');
        expect(source).toContain('const completePenalty = flow.sourceFoulEventId ? appendAndResolveResumableFlow : appendIntent;');
        expect(source).toContain('completePenalty({ kind: "penalty-administration-ended", penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY"');
        expect(source).toContain('if (!flow) setFlow({ action: "PENALTY", step: "shooter" });');
        expect(source).not.toContain('pausedTechnicalPenaltyEventId');
        expect(source).not.toContain('ΣΥΝΕΧΕΙΑ ΤΕΧΝΙΚΗΣ ΒΟΛΗΣ');
        expect(source).not.toContain('bridge.saveResumableLiveFlow(gameplay.runId');
    });

    it("ends every durable FLAGRANT penalty without fabricating free throws or saving a shooting resumable flow", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('foulType: "FLAGRANT_FOUL", context: "NON_SHOOTING", step: "offender"');
        expect(source).toContain('flow.foulType === "FLAGRANT_FOUL" ? "SHOOTING FL" : "SHOOTING DI"');
        expect(source).toContain('context: "SHOOTING", step: "shot-points"');
        expect(source).toContain('flow?.action === "PENALTY" && (flow.foulType === "PERSONAL_FOUL" || flow.foulType === "TECHNICAL_FOUL" || isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL") && flow.committedEventId');
        expect(source).toContain('const completePenalty = flow.sourceFoulEventId ? appendAndResolveResumableFlow : appendIntent;');
        expect(source).toContain('completePenalty({ kind: "penalty-administration-ended", penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY"');
        expect(source).not.toContain('bridge.saveResumableLiveFlow(gameplay.runId');
        expect(source).not.toContain('pausedFlagrantPenaltyEventId');
        expect(source).not.toContain('ΣΥΝΕΧΕΙΑ FLAGRANT GD');
        expect(source).toContain('const severeContactFoul = value.action === "TECH_FOUL" && isSevereContactFoul(value.foulType);');
        expect(source).toContain('function severeFoulLabel(foulType: FoulType | undefined): string');
        expect(source).toContain('return foulType === "FLAGRANT_FOUL" ? "FLAGRANT GD" : "DISRUPTIVE";');
        expect(source).toContain('const isNonShootingPlayerContactFoul = flow.context === "NON_SHOOTING"');
        expect(source).toContain('`${flow.foulType === "DISQUALIFYING_FOUL" ? "DISQUALIFYING" : severeFoulLabel(flow.foulType)} · Βολή ${(pending.completedAttempts ?? 0) + 1}/${pending.attempts} · ${flowPlayerLabel(shooterId)}`');
    });
    it("reuses the severe-foul lifecycle for DISRUPTIVE without a second context chooser", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('function isSevereContactFoul(foulType: FoulType | undefined): boolean');
        expect(source).toContain('foulType: "DISRUPTIVE_FOUL", context: "NON_SHOOTING", step: "offender"');
        expect(source).not.toContain('foulType: "DISRUPTIVE_FOUL", step: "context"');
        expect(source).toContain('flow.foulType === "FLAGRANT_FOUL" ? "SHOOTING FL" : "SHOOTING DI"');
        expect(source).toContain('flow?.action === "PENALTY" && (flow.foulType === "PERSONAL_FOUL" || flow.foulType === "TECHNICAL_FOUL" || isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL") && flow.committedEventId');
        expect(source).toContain('const playerContactFoul = isSevereContactFoul(flow.foulType) || defaultDisqualifying;');
        expect(source).toContain('isSevereContactFoul(flow.foulType) || playerContactDisqualification');
    });

    it("routes DISQUALIFYING directly from FOULER while keeping player contact separate from staff DQ", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('foulType: "DISQUALIFYING_FOUL", context: "NON_SHOOTING", step: "offender"');
        expect(source).not.toContain('foulType: "DISQUALIFYING_FOUL", step: "context"');
        expect(source).toContain('const defaultDisqualifying = flow.action === "TECH_FOUL" && flow.foulType === "DISQUALIFYING_FOUL" && flow.context === "NON_SHOOTING" && !flow.offender;');
        expect(source).toContain('const nextStep = flow.context === "NON_CONTACT" ? "commit-foul" : flow.context === "SHOOTING" ? "shot-victim" : "victim";');
        expect(source).toContain('context: "NON_CONTACT", offender: { kind: "BENCH", personId: `coach:${side}`, role: "HEAD_COACH" }');
        expect(source).toContain('const benchPerson = team(side).bench.find(');
        expect(source).toContain('const staffSelectionActive = flow?.action === "TECH_FOUL" && flow.step === "offender"');
        expect(source).toContain('flow.context === "NON_SHOOTING" && !flow.offender');
        expect(source).toContain('onClick={() => setFlow({ ...flow, context: "SHOOTING", step: "shot-points" })}');
        expect(source).toContain('disabled={Boolean(historyPreview) || (Boolean(flow) && !staffSelectionActive)}');
        expect(source).toContain('flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "PLAYER"');
        expect(source).toContain('flow?.action === "PENALTY" && (flow.foulType === "PERSONAL_FOUL" || flow.foulType === "TECHNICAL_FOUL" || isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL") && flow.committedEventId');
        expect(source).toContain('const completePenalty = flow.sourceFoulEventId ? appendAndResolveResumableFlow : appendIntent;');
        expect(source).toContain('completePenalty({ kind: "penalty-administration-ended", penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY"');
        expect(source).toContain('value.foulType === "DISQUALIFYING_FOUL" ? "DISQUALIFYING"');
        expect(source).toContain('staffDisqualification && value.offender?.kind === "BENCH"');
        expect(source).toContain('flow.foulType === "DISQUALIFYING_FOUL" ? "DISQUALIFYING" : flow.action === "PENALTY"');
    });

    it("keeps a FLAGRANT early completion closed across stale penalty props without suppressing a different later penalty", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const [endingPenaltyId, setEndingPenaltyId] = useState<string | null>(null);');
        expect(source).toContain('const hasPendingPenalty = (gameplay.penalty?.activePenaltyIds.length ?? 0) > 0;');
        expect(source).toContain('const activePendingPenaltyId = gameplay.penalty?.activePenaltyIds[0] ?? null;');
        expect(source).toContain('history.filter(isScorerFacingGameplayEvent).map((item) =>');
        expect(source).toContain('if (endingPenaltyId === activePendingPenaltyId) return;');
        expect(source).toContain('if (endingPenaltyId !== null) setEndingPenaltyId(null);');
        expect(source).toContain('setEndingPenaltyId(penaltyId);');
        expect(source).toContain('if (next) { closeFlow(); return; }');
        expect(source).toContain('setEndingPenaltyId(null);');
    });

    it("keeps recovery infrastructure while ENTER permanently ends bonus and shooting-foul penalties", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('value.action === "FOUL" && value.foulType === "PERSONAL_FOUL" && value.context === "NON_SHOOTING"');
        expect(source).toContain('const completePenalty = flow.sourceFoulEventId ? appendAndResolveResumableFlow : appendIntent;');
        expect(source).toContain('completePenalty({ kind: "penalty-administration-ended", penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY"');
        expect(source).toContain('completePenalty({ kind: "penalty-administration-ended", penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY"');
        expect(source).toContain("getResumableLiveFlow(gameplay.runId)");
        expect(source).not.toContain("bridge.saveResumableLiveFlow(gameplay.runId");
        expect(source).toContain("Σε εξέλιξη");
        expect(source).toContain("appendAndResolveResumableGameplayFlow");
        expect(source).toContain('historyPreview || historyEdit || historyPreviewLoading || resumableFlow)');
    });
    it("preserves only factual input on Enter and marks the exact unresolved scorer step", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('const finishAssistEarly = useCallback(async () => {');
        const finishAssistEarlyStart = source.indexOf('const finishAssistEarly = useCallback(async () => {');
        const finishAssistEarly = source.slice(finishAssistEarlyStart, source.indexOf('const finishReboundEarly = useCallback', finishAssistEarlyStart));
        expect(finishAssistEarly).toContain('const terminal = { reason: "ENTER_EARLY" as const, unresolvedStep: "ASSIST" as const };');
        expect(finishAssistEarly).toContain('const { assistPlayerId: _previousAssist, ...shotIntent } = flow.baseIntent;');
        expect(finishAssistEarly).toContain('scorerEventTerminal: terminal');
        expect(finishAssistEarly).not.toContain('decisions: { assist: "NONE"');
        expect(source).toContain('const finishMissWithoutRebound = useCallback(async () => {');
        expect(source).toContain('unresolvedStep: "REBOUNDER" as const');
        expect(source).toContain('intents.push({ kind: "block", team: opposite(flow.shotSide!), playerId: flow.blockerId, scorerEventTerminal: terminal });');
        expect(source).toContain('lastFactEventId: next.latestEvent?.eventId, lastFactIntent: intent');
        expect(source).toContain('const finishReboundEarly = useCallback(async () => {');
        expect(source).toContain('if (flow) closeFlow();');
        expect(source).not.toContain('void finishAssist(); return; }\n        if (flow?.action === "PENALTY"');
        expect(source).toContain('scorerEventTerminal: { reason: "NATURAL", decisions: { steal: "NONE" } }');
        expect(source).toContain('decisions: { assist: "NONE" as const }');
    });
    it("keeps selected guided steps visible while side rails remain the only player targets", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain("live-flow-trail");
        expect(source).not.toContain("Επιλογή ομάδας");
        expect(source).toContain("BLOCKER");
        expect(source).not.toContain('label: "RECEIVER"');
        expect(source).toContain("REBOUNDER");
        expect(source).toContain('step: "assist-choice"');
        expect(source).toContain("NO ASSIST");
        expect(source).toContain("await appendIntent(intent)");
        expect(source).toContain('if (flow.step === "shooter" || flow.step === "rebound-player") return true;');
        expect(source).toContain('receiverId: flow.playerId, step: "rebound-player"');
        const renderFlowStart = source.indexOf("const renderFlow =");
        const shootRenderer = source.slice(source.indexOf('if (flow.action === "SHOOT")', renderFlowStart), source.indexOf('if (flow.action === "REBOUND")', renderFlowStart));
        const railSelection = source.slice(source.indexOf("const selectRailPlayer"), renderFlowStart);
        expect(shootRenderer).not.toContain("HOME TEAM");
        expect(shootRenderer).not.toContain('flow.step === "receiver"');
        expect(railSelection).not.toContain('flow.step === "receiver"');
        expect(source).toContain('disabled={busy || gameplay.lifecycle !== "live"}');
        expect(source).toContain("railPlayerAllowed");
        expect(source).toContain("selectRailPlayer");
        expect(source).not.toContain("renderAllOnCourtPlayers");
    });
    it("routes a missed shot directly to rebound selection with BLOCK as the contextual exception", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('step: made ? "assist" : "rebound-player"');
        expect(source).toContain('made, step: "rebound-player", baseIntent: intent, shotSide: flow.side');
        expect(source).toContain('if (flow.made === false && flow.step === "rebound-player") steps.push({ step: "rebound-player", label: "REBOUNDER", value: "" });');
        expect(source).toContain('if (flow.step === "blocker") steps.push({ step: "blocker", label: "BLOCKER", value: "", teamSide: opposite(flow.shotSide!) });');
        expect(source).toContain('if (flow.blockerId) steps.push({ step: "blocker", label: "BLOCKER", value: flowPlayerLabel(flow.blockerId), playerId: flow.blockerId, correctionKind: "BLOCKER" });');
        const renderFlowStart = source.indexOf("const renderFlow =");
        const shootRenderer = source.slice(source.indexOf('if (flow.action === "SHOOT")', renderFlowStart), source.indexOf('if (flow.action === "REBOUND")', renderFlowStart));
        expect(shootRenderer).not.toContain('flow.step === "block-choice"');
        expect(shootRenderer).not.toContain('>REBOUND</Choice>');
        expect(shootRenderer).toContain('if (flow.step === "rebound-player") return <><h3>MISS</h3>');
        expect(shootRenderer).toContain('{!flow.blockerId ? <button type="button" className="live-context-exception"');
        expect(shootRenderer).toContain('className="live-context-exception" onClick={() => setFlow({ ...flow, step: "blocker" })}>BLOCK</button>');
        expect(source).toContain('if (flow.step === "shooter" || flow.step === "rebound-player") return true;');
        expect(source).toContain('if (flow.blockerId) intents.push({ kind: "block", team: opposite(flow.shotSide), playerId: flow.blockerId });');
        expect(source).toContain('const terminalRebound = { ...rebound, scorerEventTerminal: { reason: "NATURAL" as const } };');
        expect(source).toContain('intents.push(terminalRebound);');
    });
    it("shows an open rebounder trail only when a final live-ball free-throw miss reaches rebound selection", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        const styles = fs.readFileSync(path.resolve("src/styles/global.css"), "utf8");
        expect(source).toContain('else if (!made && pending.restartKind === "LIVE_BALL") setFlow({ ...flow, action: "REBOUND", step: "rebound-player"');
        expect(source).toContain('if (flow.action === "REBOUND" && flow.step === "rebound-player") steps.push({ step: "rebound-player", label: "REBOUNDER", value: "" });');
        expect(source).toContain('const preservedReboundTrail = flow.action === "REBOUND" && (flow.trail?.length ?? 0) > 0;');
        expect(source).toContain('preservedReboundTrail || preservedPenaltyTrail ? "is-preserved-trail-card"');
        expect(styles).toContain('.live-flow-trail span.is-preserved-trail-card');
        expect(source).toContain('if (flow.action === "REBOUND" && (flow.step === "rebound-team" || flow.step === "rebound-player")) { await finishMissRebound(side, player.playerId); return; }');
        expect(source).toContain('(flow?.action === "REBOUND" && (flow.step === "rebound-team" || flow.step === "rebound-player"))');
        expect(source).toContain('else closeFlow();');
    });
    it("routes a made shot directly to assist selection with NO ASSIST as the contextual exception", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('step: made ? "assist" : "rebound-player"');
        expect(source).toContain('committedEventId: eventId, step: "assist"');
        expect(source).toContain('if (flow.made === true && flow.step === "assist") steps.push({ step: "assist", label: "ASSIST", value: "", teamSide: flow.side });');
        const renderFlowStart = source.indexOf("const renderFlow =");
        const shootRenderer = source.slice(source.indexOf('if (flow.action === "SHOOT")', renderFlowStart), source.indexOf('if (flow.action === "REBOUND")', renderFlowStart));
        expect(shootRenderer).not.toContain('flow.step === "assist-choice"');
        expect(shootRenderer).not.toContain('>ASSIST</Choice>');
        expect(shootRenderer).toContain('if (flow.step === "assist" && flow.side) return <><h3>ASSIST</h3>');
        expect(shootRenderer).toContain('className="live-context-exception" onClick={() => void finishAssist()}>NO ASSIST</button>');
        expect(source).toContain('if (flow.step === "assist") { await finishAssist(player.playerId); return; }');
        expect(source).toContain('const next = await appendIntent({ ...(assistPlayerId ? { ...flow.baseIntent, assistPlayerId } : flow.baseIntent), ...(flow.foulType ? {} : { scorerEventTerminal: { reason: "NATURAL"');
    });
    it("keeps shooting-foul administration as one readable, clickable scorer trail", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('flow.action === "PENALTY" && flow.sourceFoulEventId ? "SHOOTING FOUL"');
        expect(source).toContain('step: isShootingFoul ? "free-throw" : "shooter"');
        expect(source).toContain('playerId: source?.playerId ?? (isShootingFoul ? source?.fouledPlayerId : undefined)');
        expect(source).toContain('label: "FREE THROW"');
        expect(source).toContain("editableShootingFoulTrail");
        expect(source).toContain("FT{(pending.completedAttempts ?? 0) + 1} MADE");
        expect(source).toContain("FT{(pending.completedAttempts ?? 0) + 1} MISS");
        expect(source).toContain('return player?.shirtNumber ? `#${player.shirtNumber}` : "—";');
    });
    it("defers a made shooting foul until the assist decision and rolls back Escape safely", () => {
        const source = fs.readFileSync(path.resolve("src/components/LiveControl.tsx"), "utf8");
        expect(source).toContain('flow.action === "TECH_FOUL" && (isSevereContactFoul(flow.foulType) || (flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "PLAYER"))');
        expect(source).toContain('if ((flow?.action === "PENALTY" || openMadeShootingFoul) && flow?.committedEventId && bridge)');
        expect(source).toContain('if (flow.context === "SHOOTING" && flow.made && flow.committedEventId && !flow.sourceFoulEventId');
        expect(source).toContain('const shotState = assistPlayerId ? await correctSpecific(flow.committedEventId, completedShot) : gameplay;');
        expect(source).toContain('const foulState = await appendIntent(foul);');
        expect(source).toContain('if (flow.context === "SHOOTING" && flow.step === "assist-choice")');
        expect(source).toContain('if (flow.context === "SHOOTING" && flow.step === "assist") return side === opposite(flow.side!) && player.playerId !== flow.fouledPlayerId;');
        const startAction = source.slice(source.indexOf('const startAction = useCallback'), source.indexOf('useEffect(() => {', source.indexOf('const startAction = useCallback')));
        expect(startAction).not.toContain('appendIntent');
    });
});
