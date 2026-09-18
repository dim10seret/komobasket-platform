import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { activeGameLineupDecision, livePrimaryActionsForMode } from "./LiveControl";
import type { ActiveLineupPlayer } from "./LiveControl";

type Status = ActiveLineupPlayer["fouls"]["status"];

function player(playerId: string, onCourt: boolean, status: Status = "ELIGIBLE"): ActiveLineupPlayer {
    return { playerId, onCourt, fouls: { status } };
}

function lineup(active: number, unavailable: number, eligibleBench: number, ineligibleBench = 0): ActiveLineupPlayer[] {
    return [
        ...Array.from({ length: active }, (_, index) => player(`active-${index + 1}`, true)),
        ...Array.from({ length: unavailable }, (_, index) => player(`out-${index + 1}`, true, "EXCLUDED")),
        ...Array.from({ length: eligibleBench }, (_, index) => player(`bench-${index + 1}`, false)),
        ...Array.from({ length: ineligibleBench }, (_, index) => player(`ineligible-bench-${index + 1}`, false, "DISQUALIFIED")),
    ];
}

describe("active-game reduced-lineup rule", () => {
    it("keeps SIMPLE technical staff access and applies the same reduced-lineup decision to SIMPLE recovery data", () => {
        expect(livePrimaryActionsForMode("SIMPLE").map((action) => action.id)).toContain("TECH_FOUL");
        const simpleRecoveredPlayers = JSON.parse(JSON.stringify(lineup(4, 1, 0))) as ActiveLineupPlayer[];
        expect(activeGameLineupDecision(simpleRecoveredPlayers, 5)).toMatchObject({ projectedOnCourtCount: 4, reducedLineup: true, normalGameplayAllowed: true });
        expect(activeGameLineupDecision(simpleRecoveredPlayers, 5)).toEqual(activeGameLineupDecision(lineup(4, 1, 0), 5));
        expect(activeGameLineupDecision(lineup(4, 1, 1, 1), 5)).toMatchObject({ mandatoryReplacementIds: ["out-1"], projectedOnCourtCount: 5 });
    });

    it("keeps the SIMPLE coach technical disabled after disqualification without disabling bench", () => {
        const source = readFileSync(resolve("src/components/LiveControl.tsx"), "utf8");
        const staffSelection = source.slice(source.indexOf("const selectTechnicalStaffOffender ="), source.indexOf("const [assistPromptFlow"));
        expect(staffSelection).toContain('if (source === "COACH" && team(side).discipline.headCoachDisqualified) return;');
        expect(staffSelection).not.toContain("gameplay.gameMode");
        expect(source).toContain('(Boolean(flow) && !staffSelectionActive) || directCoachTechnicalUnavailable} onClick={() => selectTechnicalStaffOffender(current.side, "COACH")');
        expect(source).toContain('(Boolean(flow) && !staffSelectionActive)} onClick={() => selectTechnicalStaffOffender(current.side, "BENCH")');
        expect(source).toContain('railPlayers(current).filter((player) => player.fouls.status === "ELIGIBLE")');
    });
    it("still requires replacement when an eligible substitute exists", () => {
        expect(activeGameLineupDecision(lineup(4, 1, 1), 5)).toMatchObject({
            mandatoryReplacementIds: ["out-1"], projectedOnCourtCount: 5, reducedLineup: false, normalGameplayAllowed: true,
        });
    });

    it.each([[4, 1], [3, 2], [2, 3]])("allows %i active players only when no legal substitute exists", (active, unavailable) => {
        expect(activeGameLineupDecision(lineup(active, unavailable, 0), 5)).toMatchObject({
            mandatoryReplacementIds: [], projectedOnCourtCount: active, reducedLineup: true, normalGameplayAllowed: true,
        });
    });

    it("blocks normal gameplay at one active player", () => {
        expect(activeGameLineupDecision(lineup(1, 4, 0), 5)).toMatchObject({
            projectedOnCourtCount: 1, reducedLineup: true, normalGameplayAllowed: false,
        });
    });

    it("requires every replacement that is legally available without counting ineligible bench players", () => {
        expect(activeGameLineupDecision(lineup(3, 2, 1, 3), 5)).toMatchObject({
            eligibleSubstituteIds: ["bench-1"], mandatoryReplacementIds: ["out-1"], projectedOnCourtCount: 4,
        });
    });

    it("is deterministic after replay/recovery and applies equally to FULL and SIMPLE gameplay DTOs", () => {
        const recovered = JSON.parse(JSON.stringify(lineup(3, 2, 0))) as ActiveLineupPlayer[];
        expect(activeGameLineupDecision(recovered, 5)).toEqual(activeGameLineupDecision(lineup(3, 2, 0), 5));
    });
});
