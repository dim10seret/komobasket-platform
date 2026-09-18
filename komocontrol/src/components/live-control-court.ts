export interface NormalizedCourtPosition {
    x: number;
    y: number;
}

export interface CourtPointerBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

export const LIVE_COURT_GEOMETRY = {
    hoopX: 0.5,
    hoopY: 0.14,
    threePointRadius: 0.44,
    cornerInset: 0.075,
} as const;

// Normalized squared-distance tolerance: absorbs floating-point noise on the line
// without classifying a visibly outside court position as a two-point attempt.
export const LIVE_COURT_BOUNDARY_EPSILON = 1e-9;

export const LIVE_COURT_CORNER_BREAK_Y = LIVE_COURT_GEOMETRY.hoopY + Math.sqrt(
    LIVE_COURT_GEOMETRY.threePointRadius ** 2
    - (LIVE_COURT_GEOMETRY.hoopX - LIVE_COURT_GEOMETRY.cornerInset) ** 2,
);

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

export function normalizedCourtPosition(
    clientX: number,
    clientY: number,
    bounds: CourtPointerBounds,
): NormalizedCourtPosition {
    if (bounds.width <= 0 || bounds.height <= 0) return { x: 0.5, y: 0.5 };
    return {
        x: clampUnit((clientX - bounds.left) / bounds.width),
        y: clampUnit((clientY - bounds.top) / bounds.height),
    };
}

export function shotTypeFromCourtPosition(position: NormalizedCourtPosition): 2 | 3 {
    const { hoopX, hoopY, threePointRadius, cornerInset } = LIVE_COURT_GEOMETRY;
    if (position.y <= LIVE_COURT_CORNER_BREAK_Y) {
        return position.x + LIVE_COURT_BOUNDARY_EPSILON >= cornerInset
            && position.x - LIVE_COURT_BOUNDARY_EPSILON <= 1 - cornerInset ? 2 : 3;
    }
    const distanceSquared = (position.x - hoopX) ** 2 + (position.y - hoopY) ** 2;
    return distanceSquared <= threePointRadius ** 2 + LIVE_COURT_BOUNDARY_EPSILON ? 2 : 3;
}

export function liveCourtThreePointSvgPath(): string {
    const left = LIVE_COURT_GEOMETRY.cornerInset * 100;
    const right = (1 - LIVE_COURT_GEOMETRY.cornerInset) * 100;
    const breakY = LIVE_COURT_CORNER_BREAK_Y * 100;
    const radius = LIVE_COURT_GEOMETRY.threePointRadius * 100;
    return `M ${left} 7 V ${breakY} M ${left} ${breakY} A ${radius} ${radius} 0 0 0 ${right} ${breakY} M ${right} 7 V ${breakY}`;
}

export type CourtSelectableFlow = Flow & {
    action: "SHOOT" | "FOUL" | "TECH_FOUL" | "PENALTY";
};

export function isFullCourtShotSelectionFlow(
    gameMode: "FULL" | "SIMPLE",
    flow: Flow | null,
): flow is CourtSelectableFlow {
    if (gameMode !== "FULL" || flow === null || flow.committedEventId) return false;
    if (flow.action !== "SHOOT" && flow.action !== "FOUL" && flow.action !== "TECH_FOUL" && flow.action !== "PENALTY") return false;
    const shootingFlow = flow.action === "SHOOT" || flow.context === "SHOOTING";
    return shootingFlow && (flow.step === "shot-points" || Boolean(flow.shotLocation));
}

export function applyCourtShotSelection<T extends CourtSelectableFlow>(
    flow: T,
    shotLocation: NormalizedCourtPosition,
): T & { points: 2 | 3; shotLocation: NormalizedCourtPosition } {
    const step = flow.step === "shot-points"
        ? flow.action === "SHOOT" ? "shooter" : "offender"
        : flow.step;
    return { ...flow, step, points: shotTypeFromCourtPosition(shotLocation), shotLocation };
}
import type { Flow } from "./LiveControl";
