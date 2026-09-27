import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyActiveCourtFlowSelection, currentFullActiveStep, livePrimaryActionsForMode, type Flow } from "./LiveControl";
import {
    LIVE_COURT_CORNER_BREAK_Y,
    LIVE_COURT_BOUNDARY_EPSILON,
    LIVE_COURT_GEOMETRY,
    applyCourtShotSelection,
    isCourtShotSelectionFlow,
    isFullCourtShotSelectionFlow,
    liveCourtThreePointSvgPath,
    normalizedCourtPosition,
    shotTypeFromCourtPosition,
} from "./live-control-court";

describe("LiveControl shared court shot selection", () => {
    it("classifies positions inside and outside the three-point arc", () => {
        expect(shotTypeFromCourtPosition({ x: 0.5, y: 0.45 })).toBe(2);
        expect(shotTypeFromCourtPosition({ x: 0.5, y: 0.7 })).toBe(3);
    });

    it("classifies corner shots against the straight corner line", () => {
        const y = LIVE_COURT_CORNER_BREAK_Y - 0.01;
        expect(shotTypeFromCourtPosition({ x: LIVE_COURT_GEOMETRY.cornerInset + 0.01, y })).toBe(2);
        expect(shotTypeFromCourtPosition({ x: LIVE_COURT_GEOMETRY.cornerInset - 0.01, y })).toBe(3);
    });

    it("classifies immediately inside, exactly on, and immediately outside the arc", () => {
        const lineY = LIVE_COURT_GEOMETRY.hoopY + LIVE_COURT_GEOMETRY.threePointRadius;
        expect(shotTypeFromCourtPosition({ x: LIVE_COURT_GEOMETRY.hoopX, y: lineY - 0.000001 })).toBe(2);
        expect(shotTypeFromCourtPosition({ x: LIVE_COURT_GEOMETRY.hoopX, y: lineY })).toBe(2);
        expect(shotTypeFromCourtPosition({ x: LIVE_COURT_GEOMETRY.hoopX, y: lineY + 0.000001 })).toBe(3);
        expect(LIVE_COURT_BOUNDARY_EPSILON).toBe(1e-9);
    });

    it("treats a click exactly on the straight corner line as 2PT", () => {
        expect(shotTypeFromCourtPosition({ x: LIVE_COURT_GEOMETRY.cornerInset, y: 0.1 })).toBe(2);
    });

    it("keeps the two corner segments and arc as three separate SVG move subpaths", () => {
        const path = liveCourtThreePointSvgPath();
        expect(path.match(/\bM\b/g)).toHaveLength(3);
        expect(path).toMatch(/^M .+ V .+ M .+ A .+ M .+ V .+$/);
    });


    it("removes only the decorative side lines while preserving the shared court and marker", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const court = source.match(/const renderShotCourt = \(\) => ([^\r\n]+)/)?.[1] ?? "";
        expect(court.match(/<svg\b.*?<\/svg>/)?.[0]).toBe(
            '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="1.5" y="1.5" width="97" height="97" rx="1"/><path d="M 6 7 H 94 M 6 93 H 94"/><path d="M 35 7 V 42 H 65 V 7 M 35 42 H 65"/><path d="M 42 10 H 58"/><circle cx="50" cy="14" r="3.5"/><circle cx="50" cy="42" r="12"/><path d="M 38 93 A 12 12 0 0 1 62 93"/><path className="live-court-three-line" d={courtThreePointPath}/></svg>',
        );
        expect(court).not.toContain("M 6 2 V 98");
        expect(court).not.toContain("M 94 2 V 98");
        expect(court).toContain("disabled={!courtSelectionActive} onClick={selectCourtPosition}");
        expect(court).toContain('style={{ left: `${flow.shotLocation.x * 100}%`, top: `${flow.shotLocation.y * 100}%` }}');
    });

    it("normalizes clicks independently of rendered court size", () => {
        expect(normalizedCourtPosition(210, 120, { left: 10, top: 20, width: 400, height: 200 })).toEqual({ x: 0.5, y: 0.5 });
        expect(normalizedCourtPosition(510, 270, { left: 10, top: 20, width: 1000, height: 500 })).toEqual({ x: 0.5, y: 0.5 });
    });

    it("advances the initial selector and moves one transient location on re-selection", () => {
        const initial = { action: "SHOOT" as const, step: "shot-points" };
        const inside = applyCourtShotSelection(initial, { x: 0.5, y: 0.45 });
        expect(inside).toMatchObject({ step: "shooter", points: 2, shotLocation: { x: 0.5, y: 0.45 } });
        const outside = applyCourtShotSelection(inside, { x: 0.5, y: 0.7 });
        expect(outside).toMatchObject({ step: "shooter", points: 3, shotLocation: { x: 0.5, y: 0.7 } });
    });

    it("accepts every eligible FULL court-selection action", () => {
        const shoot = { action: "SHOOT" as const, step: "shot-points" };
        const shootingFoul: Flow = { action: "FOUL", step: "shot-points", context: "SHOOTING" };
        expect(isFullCourtShotSelectionFlow("FULL", shoot)).toBe(true);
        expect(isFullCourtShotSelectionFlow("FULL", shootingFoul)).toBe(true);
        expect(isFullCourtShotSelectionFlow("FULL", { action: "TECH_FOUL", step: "shot-points", context: "SHOOTING" })).toBe(true);
        expect(isFullCourtShotSelectionFlow("FULL", { action: "PENALTY", step: "shot-points", context: "SHOOTING" })).toBe(true);
    });

    it("accepts SIMPLE normal-shot reselection and shooting-context foul flows", () => {
        expect(isCourtShotSelectionFlow({ action: "SHOOT", step: "shooter", points: 2, shotLocation: { x: 0.5, y: 0.45 } })).toBe(true);
        expect(isCourtShotSelectionFlow({ action: "FOUL", step: "shot-points", context: "SHOOTING" })).toBe(true);
        expect(isCourtShotSelectionFlow({ action: "TECH_FOUL", step: "shot-points", context: "SHOOTING" })).toBe(true);
        expect(isCourtShotSelectionFlow({ action: "FOUL", step: "offender", context: "NON_SHOOTING" })).toBe(false);
        expect(isCourtShotSelectionFlow({ action: "TIME_OUT", step: "team-target" })).toBe(false);
        expect(isCourtShotSelectionFlow(null)).toBe(false);
    });

    it("applies SIMPLE shooting-foul court locations without replacing the active FOUL flow", () => {
        const flow: Flow = { action: "FOUL", step: "shot-points", context: "SHOOTING", foulType: "PERSONAL_FOUL" };
        expect(applyActiveCourtFlowSelection(flow, { x: 0.5, y: 0.45 })).toMatchObject({ action: "FOUL", context: "SHOOTING", step: "offender", points: 2, shotLocation: { x: 0.5, y: 0.45 } });
        expect(applyActiveCourtFlowSelection(flow, { x: 0.5, y: 0.7 })).toMatchObject({ action: "FOUL", context: "SHOOTING", step: "offender", points: 3, shotLocation: { x: 0.5, y: 0.7 } });
        expect(applyActiveCourtFlowSelection(flow, { x: LIVE_COURT_GEOMETRY.cornerInset - 0.01, y: LIVE_COURT_CORNER_BREAK_Y - 0.01 })).toMatchObject({ action: "FOUL", step: "offender", points: 3 });
        expect(applyActiveCourtFlowSelection(flow, { x: LIVE_COURT_GEOMETRY.hoopX, y: LIVE_COURT_GEOMETRY.hoopY + LIVE_COURT_GEOMETRY.threePointRadius })).toMatchObject({ action: "FOUL", step: "offender", points: 2 });
    });

    it("applies shooting TECH locations to the same TECH flow", () => {
        const flow: Flow = { action: "TECH_FOUL", step: "shot-points", context: "SHOOTING", foulType: "FLAGRANT_FOUL" };
        expect(applyActiveCourtFlowSelection(flow, { x: 0.5, y: 0.45 })).toMatchObject({ action: "TECH_FOUL", context: "SHOOTING", step: "offender", points: 2 });
        expect(applyActiveCourtFlowSelection(flow, { x: 0.5, y: 0.7 })).toMatchObject({ action: "TECH_FOUL", context: "SHOOTING", step: "offender", points: 3 });
        expect(applyActiveCourtFlowSelection({ action: "TURN_OVER", step: "offender" }, { x: 0.5, y: 0.7 })).toEqual({ action: "TURN_OVER", step: "offender" });
        expect(applyActiveCourtFlowSelection(null, { x: 0.5, y: 0.7 })).toBeNull();
    });

    it("dispatches active court context before either idle normal-shot path", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const handler = source.slice(source.indexOf("const selectCourtPosition ="), source.indexOf("const flowPlayerLabel ="));
        expect(handler.indexOf("if (activeCourtSelectionFlow)")).toBeGreaterThanOrEqual(0);
        expect(handler.indexOf("if (activeCourtSelectionFlow)")).toBeLessThan(handler.indexOf("if (simpleCourtSelectionActive || fullCourtSelectionActive)"));
        expect(handler).toContain("applyActiveCourtFlowSelection(current, shotLocation)");
        expect(handler).not.toContain("appendIntent");
    });

    it("removes only the visible FULL SHOOT action and preserves the other actions", () => {
        expect(livePrimaryActionsForMode("FULL").map(action => action.id)).toEqual([
            "FOUL", "TURN_OVER", "SUBS", "TIME_OUT", "TECH_FOUL", "SHOOTING_FOUL", "OFFENSIVE_FOUL",
        ]);
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const columns = source.slice(source.indexOf("const fullPrimaryActionColumns"), source.indexOf("export const simplePrimaryActionColumns"));
        expect(columns).not.toMatch(/"SHOOT"/);
        expect(columns).toContain('["SHOOTING_FOUL", "FOUL", "TIME_OUT"]');
        expect(columns).toContain('["TURN_OVER", "TECH_FOUL", "OFFENSIVE_FOUL", "SUBS"]');
    });

    it("arms the FULL idle court only with no active flow, dialog, correction or pending obligation", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const guard = source.slice(source.indexOf("const fullCourtSelectionActive ="), source.indexOf("const courtSelectionActive ="));
        expect(guard).toContain('gameplay.gameMode === "FULL"');
        expect(guard).toContain("flow === null");
        expect(guard).toContain('gameplay.lifecycle === "live"');
        for (const blocker of ["busy", "historyPreview", "historyEdit", "localCurrentCorrection", "correctionTarget", "historyPreviewLoading", "selectedLogEvent", "resumableFlow", "subsModal", "statusTeam", "clockEditing", "pendingPeriodTransition", "finalizationEntry", "reconnectOpen", "mandatoryReplacementPending", "activeLineupBlocked", "hasPendingPenalty"]) {
            expect(guard).toMatch(new RegExp(`&& !${blocker}\\b`));
        }
        expect(source).toContain("const courtSelectionActive = activeCourtSelectionFlow || simpleCourtSelectionActive || fullCourtSelectionActive;");
    });

    it("starts only a pending shooter selection and a transient marker from the court", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const handler = source.slice(source.indexOf("const selectCourtPosition ="), source.indexOf("const flowPlayerLabel ="));
        expect(handler).toContain("if (!courtSelectionActive) return;");
        expect(handler).toContain("normalizedCourtPosition(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())");
        expect(handler).toContain('action: "SHOOT"');
        expect(handler).toContain('step: "shooter"');
        expect(handler).toContain("points: shotTypeFromCourtPosition(shotLocation)");
        expect(handler).toContain("shotLocation,");
        expect(handler).not.toMatch(/appendIntent|appendIntents|correctSpecific|bridge\.|made:/);
        expect(source).toContain('{flow?.shotLocation ? <span className="live-shot-marker"');
    });

    it.each([{ x: 0.5, y: 0.45, points: 2 }, { x: 0.5, y: 0.7, points: 3 }])("keeps FULL $points PT selection pending until the existing result step", ({ x, y, points }) => {
        const pending = applyCourtShotSelection({ action: "SHOOT" as const, step: "shot-points" }, { x, y });
        expect(pending).toMatchObject({ action: "SHOOT", step: "shooter", points });
        expect(pending).not.toHaveProperty("made");
        expect(pending).not.toHaveProperty("committedEventId");
        expect(currentFullActiveStep("FULL", pending)).toEqual({ kind: "instruction", text: "Επιλέξτε αριθμό από τα rails" });
        expect(currentFullActiveStep("FULL", { ...pending, side: "HOME", playerId: "home-1", step: "shot-result" })).toEqual({ kind: "shot-result" });
    });

    it("preserves the existing FULL result handlers and SIMPLE immediate made-shot completion", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const rails = source.slice(source.indexOf("const selectRailPlayer ="), source.indexOf("const renderFlow ="));
        expect(rails).toContain('if (gameplay.gameMode === "SIMPLE") {');
        expect(rails).toContain("await appendIntent(simpleMadeShotIntent(side, player.playerId, flow.points ?? 2, flow.stoppageId))");
        expect(rails).toContain('} else setFlow({ ...flow, side, playerId: player.playerId, step: "shot-result" });');
        expect(source).toContain('<p className="live-active-step-instruction">Μπήκε το καλάθι;</p>');
        expect(source).toContain('onClick={() => void finishShot(true)}>MADE</button>');
        expect(source).toContain('onClick={() => void finishShot(false)}>MISS</button>');
        expect(source).toContain('onClick={() => void finishAssist()}>NO ASSIST</button>');
        expect(source).toContain('if (flow.step === "rebound-player") { await finishMissRebound(side, player.playerId); return; }');
    });

    it("clears a pending normal shot and its marker through the existing ESC close path", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const cancel = source.slice(source.indexOf("const cancelFlow ="), source.indexOf("const maybePenalty ="));
        expect(source).toContain("const closeFlow = useCallback(() => { setFlow(null); setCorrectionTarget(null); }, []);");
        expect(cancel).toContain("closeFlow();");
        expect(cancel).not.toMatch(/appendIntent|appendIntents/);
        expect(currentFullActiveStep("FULL", null)).toBeNull();
        expect(isCourtShotSelectionFlow(null)).toBe(false);
    });

    it("rejects null, SIMPLE, unrelated actions, wrong steps, and committed flows", () => {
        const shoot = { action: "SHOOT" as const, step: "shot-points" };
        expect(isFullCourtShotSelectionFlow("FULL", null)).toBe(false);
        expect(isFullCourtShotSelectionFlow("SIMPLE", shoot)).toBe(false);
        expect(isFullCourtShotSelectionFlow("FULL", { action: "SUBS", step: "shot-points" })).toBe(false);
        expect(isFullCourtShotSelectionFlow("FULL", { action: "REBOUND", step: "shot-points" })).toBe(false);
        expect(isFullCourtShotSelectionFlow("FULL", { action: "SHOOT", step: "shot-result" })).toBe(false);
        expect(isFullCourtShotSelectionFlow("FULL", { action: "FOUL", step: "shot-points", context: "NON_SHOOTING" })).toBe(false);
        expect(isFullCourtShotSelectionFlow("FULL", { ...shoot, committedEventId: "event-1" })).toBe(false);
    });
});
