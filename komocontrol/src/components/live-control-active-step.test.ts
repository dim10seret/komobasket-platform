import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { currentFullActiveStep, shouldShowFullActiveStep, type Flow } from "./LiveControl";

describe("FULL LiveControl active-step panel", () => {
    it("shows only the current step of the requested FULL flows", () => {
        const activeFlows: Flow[] = [
            { action: "SHOOT", step: "shot-points" },
            { action: "FOUL", step: "shot-points", context: "SHOOTING" },
            { action: "TURN_OVER", step: "offender" },
            { action: "OFFENSIVE_FOUL", step: "offender" },
            { action: "TECH_FOUL", step: "offender", foulType: "FLAGRANT_FOUL" },
        ];
        for (const flow of activeFlows) expect(shouldShowFullActiveStep("FULL", flow)).toBe(true);
    });

    it("leaves SIMPLE, TECH subtype selection and unrelated flows out of the new panel", () => {
        expect(shouldShowFullActiveStep("FULL", null)).toBe(false);
        expect(shouldShowFullActiveStep("SIMPLE", { action: "SHOOT", step: "shot-points" })).toBe(false);
        expect(shouldShowFullActiveStep("FULL", { action: "TECH_FOUL", step: "foul-type" })).toBe(false);
        expect(shouldShowFullActiveStep("FULL", { action: "FOUL", step: "offender", context: "NON_SHOOTING" })).toBe(true);
        expect(shouldShowFullActiveStep("FULL", { action: "TIME_OUT", step: "team-target" })).toBe(false);
        expect(shouldShowFullActiveStep("FULL", { action: "PENALTY", step: "shooter" })).toBe(false);
    });

    it("shows only the unresolved SHOOT step as court, rail, result, assist and completion progress", () => {
        expect(currentFullActiveStep("FULL", { action: "SHOOT", step: "shot-points" })).toEqual({ kind: "instruction", text: "Επιλέξτε σημείο προσπάθειας στο γήπεδο" });
        expect(currentFullActiveStep("FULL", { action: "SHOOT", step: "shooter", points: 3 })).toEqual({ kind: "instruction", text: "Επιλέξτε αριθμό από τα rails" });
        expect(currentFullActiveStep("FULL", { action: "SHOOT", step: "shot-result", playerId: "player-4", points: 3 })).toEqual({ kind: "shot-result" });
        expect(currentFullActiveStep("FULL", { action: "SHOOT", step: "assist", made: true })).toEqual({ kind: "shot-assist-choice" });
        expect(currentFullActiveStep("FULL", { action: "SHOOT", step: "assist", made: true }, true)).toEqual({ kind: "instruction", text: "Επιλέξτε αριθμό από τα rails" });
        expect(currentFullActiveStep("FULL", null)).toBeNull();
        expect(currentFullActiveStep("SIMPLE", { action: "SHOOT", step: "shot-points" })).toBeNull();
    });

    it("renders only the current SHOOTING FOUL, TURN OVER, OFFENSIVE FOUL and TECH step", () => {
        expect(currentFullActiveStep("FULL", { action: "FOUL", context: "SHOOTING", step: "shot-points" })).toMatchObject({ kind: "instruction" });
        expect(currentFullActiveStep("FULL", { action: "FOUL", context: "SHOOTING", step: "offender" })).toEqual({ kind: "instruction", text: "Επιλέξτε παίκτη που έκανε το φάουλ" });
        expect(currentFullActiveStep("FULL", { action: "FOUL", context: "SHOOTING", step: "shooting-result" })).toEqual({ kind: "foul-result" });
        expect(currentFullActiveStep("FULL", { action: "FOUL", context: "SHOOTING", step: "assist-choice" })).toEqual({ kind: "foul-assist-choice" });
        expect(currentFullActiveStep("FULL", { action: "TURN_OVER", step: "offender" })).toMatchObject({ kind: "instruction" });
        expect(currentFullActiveStep("FULL", { action: "TURN_OVER", step: "steal" })).toEqual({ kind: "turnover-steal" });
        expect(currentFullActiveStep("FULL", { action: "OFFENSIVE_FOUL", step: "offender" })).toMatchObject({ kind: "instruction" });
        expect(currentFullActiveStep("FULL", { action: "TECH_FOUL", step: "foul-type" })).toBeNull();
        expect(currentFullActiveStep("FULL", { action: "TECH_FOUL", step: "offender", foulType: "FLAGRANT_FOUL" })).toMatchObject({ kind: "instruction" });
        expect(currentFullActiveStep("FULL", { action: "TECH_FOUL", step: "shot-points", context: "SHOOTING" })).toMatchObject({ kind: "instruction" });
    });

    it("mirrors the existing current-step renderer without replacing New Event", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const styles = readFileSync(resolve("src/styles/global.css"), "utf8");
        expect(source).toContain('aria-label="Τρέχον βήμα" aria-live="polite">{renderCurrentFlowStep()}</section>');
        expect(source).toContain('{renderFlowTrail()}{renderFlow()}</>');
        const stepRenderer = source.slice(source.indexOf('const renderCurrentFlowStep = () => {'), source.indexOf('return <main className="live-control-shell">'));
        expect(stepRenderer).not.toContain('renderFlowTrail()');
        expect(stepRenderer).not.toContain('renderFlow()');
        expect(stepRenderer).toContain('onClick={() => void finishShot(true)}>MADE</button>');
        expect(stepRenderer).toContain('onClick={() => void finishShot(false)}>MISS</button>');
        expect(stepRenderer).toContain('onClick={() => void finishAssist()}>NO ASSIST</button>');
        expect(source).toContain('flow.step !== "foul-type"');
        expect(source).toContain('gameMode !== "FULL"');
        expect(styles).toContain('.live-control-main > .live-active-step-panel');
        expect(styles).toContain('.live-active-step-choices { min-width: 0; max-width: 100%; display: flex;');
        expect(styles).toContain('.live-control-body.has-active-step .live-control-main > .live-event-workspace { grid-row: 3; }');
    });
});
