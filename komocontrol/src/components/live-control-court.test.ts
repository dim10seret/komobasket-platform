import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyActiveCourtFlowSelection, type Flow } from "./LiveControl";
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

    it("dispatches active court context before the SIMPLE idle made-shot path", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const handler = source.slice(source.indexOf("const selectCourtPosition ="), source.indexOf("const flowPlayerLabel ="));
        expect(handler.indexOf("if (activeCourtSelectionFlow)")).toBeGreaterThanOrEqual(0);
        expect(handler.indexOf("if (activeCourtSelectionFlow)")).toBeLessThan(handler.indexOf('if (gameplay.gameMode === "SIMPLE")'));
        expect(handler).toContain("applyActiveCourtFlowSelection(current, shotLocation)");
        expect(handler).not.toContain("appendIntent");
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
