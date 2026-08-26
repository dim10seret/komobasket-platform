import type { DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { MatchEventFacts, MatchGameplayRecovery } from "./match-gameplay.cjs";
import type { MatchStartReadinessIssue } from "./match-engine-bootstrap.cjs";
import type { StoredLocalGameplaySyncState } from "../persistence/local-database.cjs";

export type GameplayTeamSide = "HOME" | "AWAY";
export type GameplayPeriod = { kind: "REGULATION" | "OVERTIME"; index: number };
type GameplayFoulType = "PERSONAL_FOUL" | "TECHNICAL_FOUL" | "DISRUPTIVE_FOUL" | "FLAGRANT_FOUL" | "DISQUALIFYING_FOUL";

export type GameplayIntent =
    | { kind: "clock-start" }
    | { kind: "clock-stop" }
    | { kind: "clock-set"; remainingSeconds: number }
    | { kind: "period-start"; period: GameplayPeriod }
    | { kind: "period-end"; period: GameplayPeriod }
    | { kind: "jump-ball"; possession: GameplayTeamSide }
    | { kind: "alternating-possession" }
    | { kind: "shot"; team: GameplayTeamSide; playerId: string; points: 2 | 3; made: boolean; assistPlayerId?: string; stoppageId?: string }
    | { kind: "free-throw"; team: GameplayTeamSide; playerId: string; penaltyId: string; attemptIndex: number; made: boolean }
    | { kind: "rebound"; team: GameplayTeamSide; playerId: string; offensive: boolean }
    | { kind: "steal" | "block" | "turnover"; team: GameplayTeamSide; playerId: string }
    | { kind: "timeout"; team: GameplayTeamSide }
    | { kind: "substitution"; team: GameplayTeamSide; playerInId: string; playerOutId: string }
    | { kind: "lineup-set"; team: GameplayTeamSide; playerIds: string[] }
    | {
        kind: "foul";
        foulType: GameplayFoulType;
        team: GameplayTeamSide;
        stoppageId: string;
        offender: { kind: "PLAYER"; playerId: string } | { kind: "BENCH"; personId: string; role: "HEAD_COACH" | "FIRST_ASSISTANT_COACH" | "SUBSTITUTE" | "EXCLUDED_PLAYER" | "ACCOMPANYING_DELEGATION" };
        context: { kind: "NON_SHOOTING"; teamControlFoul: boolean } | { kind: "SHOOTING" } | { kind: "NON_CONTACT" };
        fouledPlayerId?: string;
        relatedShotEventId?: string;
        category?: "CATEGORY_1" | "CATEGORY_2";
    };

export type GameplayMutationInput =
    | { operation: "append"; runId: string; intent: GameplayIntent }
    | { operation: "remove"; runId: string; eventId: string; cascadeDependencies: boolean }
    | { operation: "correct"; runId: string; eventId: string; intent: GameplayIntent; cascadeDependencies: boolean };

export type SafeGameplaySyncState = {
    status: "synced" | "pending" | "retry-needed" | "conflict";
    acknowledgedRevision: number;
    lastAttemptAtUtc: string | null;
    lastSuccessAtUtc: string | null;
    lastErrorCode: string | null;
};

export interface SafeGameplayPlayer {
    playerId: string;
    displayName: string;
    shirtNumber: string;
    participating: true;
    onCourt: boolean;
    fouls: { total: number; status: string; statusReason: string | null };
    statistics: Record<string, number>;
}
export interface SafeGameplayTeam {
    side: GameplayTeamSide;
    presentationSide: "LEFT" | "RIGHT";
    teamId: string;
    teamName: string;
    gameColor: string | null;
    score: number;
    timeouts: number;
    teamFouls: number;
    inBonus: boolean;
    captainPlayerId: string | null;
    starterPlayerIds: string[];
    players: SafeGameplayPlayer[];
    statistics: Record<string, number>;
}
export interface SafeGameplayPenaltySummary {
    stoppageId: string;
    entitlements: Array<{ kind: "FREE_THROWS" | "RESTART_ONLY"; beneficiaryTeam: GameplayTeamSide; attempts: number | null; completedAttempts: number | null; restartKind: string }>;
    cancelledCount: number;
    administrationStarted: boolean;
    finalRestart: { kind: string; team: GameplayTeamSide | null };
}

export interface SafeMatchGameplay {
    runId: string;
    lifecycle: "live" | "finalized";
    eventHistoryRevision: number;
    lastAcceptedSequence: number;
    score: { home: number; away: number };
    period: GameplayPeriod;
    clockSeconds: number;
    clockRunning: boolean;
    possession: GameplayTeamSide | null;
    alternatingPossession: GameplayTeamSide;
    finished: boolean;
    eventIds: string[];
    events: Array<{ eventId: string; sequence: number; occurredAt: number; type: string; team?: GameplayTeamSide; playerId?: string }>;
    teams: [SafeGameplayTeam, SafeGameplayTeam];
    penalty: SafeGameplayPenaltySummary | null;
    sync: SafeGameplaySyncState;
}

export type MatchGameplayOperationResult =
    | { ok: true; gameplay: SafeMatchGameplay; state: DesktopAuthState }
    | { ok: false; errorCode: string; dependentEventIds?: string[]; startReadiness?: MatchStartReadinessIssue; state: DesktopAuthState };

function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid gameplay input.");
    return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 200): string {
    if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("Invalid gameplay input.");
    return value;
}

function team(value: unknown): GameplayTeamSide {
    if (value !== "HOME" && value !== "AWAY") throw new Error("Invalid gameplay team.");
    return value;
}

function period(value: unknown): GameplayPeriod {
    const item = object(value);
    if ((item.kind !== "REGULATION" && item.kind !== "OVERTIME") || !Number.isInteger(item.index) || Number(item.index) < 1) throw new Error("Invalid gameplay period.");
    return { kind: item.kind, index: Number(item.index) };
}

function optionalText(value: unknown): string | undefined {
    return value === undefined ? undefined : text(value);
}

function number(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid gameplay projection.");
    return value;
}
function numericRecord(value: unknown): Record<string, number> {
    const source = object(value);
    return Object.fromEntries(Object.entries(source).map(([key, entry]) => [key, number(entry)]));
}
function safePenalty(value: unknown): SafeGameplayPenaltySummary | null {
    if (value === undefined) return null;
    const source = object(value);
    if (!Array.isArray(source.entitlements) || !Array.isArray(source.cancelledPenaltyIds) || typeof source.administrationStarted !== "boolean") throw new Error("Invalid gameplay penalty projection.");
    const finalRestart = object(source.finalRestart);
    return {
        stoppageId: text(source.stoppageId),
        entitlements: source.entitlements.map((entry) => {
            const entitlement = object(entry);
            if ((entitlement.kind !== "FREE_THROWS" && entitlement.kind !== "RESTART_ONLY") || (entitlement.beneficiaryTeam !== "HOME" && entitlement.beneficiaryTeam !== "AWAY")) throw new Error("Invalid gameplay penalty projection.");
            const restart = object(entitlement.restart);
            return {
                kind: entitlement.kind,
                beneficiaryTeam: entitlement.beneficiaryTeam,
                attempts: entitlement.kind === "FREE_THROWS" ? number(entitlement.attempts) : null,
                completedAttempts: entitlement.kind === "FREE_THROWS" ? number(entitlement.completedAttempts) : null,
                restartKind: text(restart.kind),
            };
        }),
        cancelledCount: source.cancelledPenaltyIds.length,
        administrationStarted: source.administrationStarted,
        finalRestart: {
            kind: text(finalRestart.kind),
            team: finalRestart.team === "HOME" || finalRestart.team === "AWAY" ? finalRestart.team : null,
        },
    };
}
function safeTeam(recovery: MatchGameplayRecovery, stateTeamValue: unknown, side: GameplayTeamSide, threshold: number): SafeGameplayTeam {
    const stateTeam = object(stateTeamValue);
    const currentTeam = recovery.currentConfiguration.teams.find((team) => team.side === side);
    if (!currentTeam || !Array.isArray(stateTeam.players)) throw new Error("Invalid gameplay team projection.");
    const enginePlayers = new Map(stateTeam.players.map((value) => {
        const player = object(value);
        return [text(player.playerId), player] as const;
    }));
    const participating = currentTeam.players.filter((player) => player.participating);
    if (enginePlayers.size !== participating.length || participating.some((player) => !enginePlayers.has(player.playerId) || player.gameShirtNumber === null)) throw new Error("Invalid gameplay roster projection.");
    const leftSide = recovery.currentConfiguration.presentation.leftSide;
    return {
        side,
        presentationSide: leftSide === side ? "LEFT" : "RIGHT",
        teamId: text(stateTeam.id),
        teamName: text(stateTeam.name),
        gameColor: currentTeam.gameColor,
        score: number(stateTeam.score),
        timeouts: number(stateTeam.timeouts),
        teamFouls: number(stateTeam.teamFouls),
        inBonus: number(stateTeam.teamFouls) >= threshold,
        captainPlayerId: currentTeam.captainPlayerId,
        starterPlayerIds: [...currentTeam.starterPlayerIds],
        players: participating.map((configurationPlayer) => {
            const player = enginePlayers.get(configurationPlayer.playerId)!;
            const foulState = object(player.foulState);
            return {
                playerId: configurationPlayer.playerId,
                displayName: text(player.displayName),
                shirtNumber: configurationPlayer.gameShirtNumber!,
                participating: true as const,
                onCourt: player.onCourt === true,
                fouls: {
                    total: number(foulState.total),
                    status: text(foulState.status),
                    statusReason: typeof foulState.statusReason === "string" ? foulState.statusReason : null,
                },
                statistics: numericRecord(player.statistics),
            };
        }),
        statistics: numericRecord(stateTeam.statistics),
    };
}
function publicSyncError(value: string | null): string | null {
    if (!value?.startsWith("SYNC_PENDING_CONFIGURATION")) return value;
    return value === "SYNC_PENDING_CONFIGURATION" ? null : value.slice("SYNC_PENDING_CONFIGURATION_".length);
}

export function parseGameplayIntent(value: unknown): GameplayIntent {
    const input = object(value);
    switch (input.kind) {
        case "clock-start": return { kind: "clock-start" };
        case "clock-stop": return { kind: "clock-stop" };
        case "clock-set": {
            if (!Number.isInteger(input.remainingSeconds) || Number(input.remainingSeconds) < 0) throw new Error("Invalid gameplay clock.");
            return { kind: "clock-set", remainingSeconds: Number(input.remainingSeconds) };
        }
        case "period-start": return { kind: "period-start", period: period(input.period) };
        case "period-end": return { kind: "period-end", period: period(input.period) };
        case "jump-ball": return { kind: "jump-ball", possession: team(input.possession) };
        case "alternating-possession": return { kind: "alternating-possession" };
        case "shot": {
            if ((input.points !== 2 && input.points !== 3) || typeof input.made !== "boolean") throw new Error("Invalid shot intent.");
            return { kind: "shot", team: team(input.team), playerId: text(input.playerId), points: input.points, made: input.made, assistPlayerId: optionalText(input.assistPlayerId), stoppageId: optionalText(input.stoppageId) };
        }
        case "free-throw": {
            if (!Number.isInteger(input.attemptIndex) || Number(input.attemptIndex) < 1 || typeof input.made !== "boolean") throw new Error("Invalid free throw intent.");
            return { kind: "free-throw", team: team(input.team), playerId: text(input.playerId), penaltyId: text(input.penaltyId), attemptIndex: Number(input.attemptIndex), made: input.made };
        }
        case "rebound": {
            if (typeof input.offensive !== "boolean") throw new Error("Invalid rebound intent.");
            return { kind: "rebound", team: team(input.team), playerId: text(input.playerId), offensive: input.offensive };
        }
        case "steal":
        case "block":
        case "turnover":
            return { kind: input.kind, team: team(input.team), playerId: text(input.playerId) };
        case "timeout": return { kind: "timeout", team: team(input.team) };
        case "substitution": return { kind: "substitution", team: team(input.team), playerInId: text(input.playerInId), playerOutId: text(input.playerOutId) };
        case "lineup-set": {
            if (!Array.isArray(input.playerIds) || input.playerIds.length > 20) throw new Error("Invalid lineup intent.");
            return { kind: "lineup-set", team: team(input.team), playerIds: input.playerIds.map((id) => text(id)) };
        }
        case "foul": {
            const foulTypes = ["PERSONAL_FOUL", "TECHNICAL_FOUL", "DISRUPTIVE_FOUL", "FLAGRANT_FOUL", "DISQUALIFYING_FOUL"] as const;
            if (!foulTypes.includes(input.foulType as typeof foulTypes[number])) throw new Error("Invalid foul intent.");
            const offenderValue = object(input.offender);
            const offender = offenderValue.kind === "PLAYER"
                ? { kind: "PLAYER" as const, playerId: text(offenderValue.playerId) }
                : offenderValue.kind === "BENCH" && ["HEAD_COACH", "FIRST_ASSISTANT_COACH", "SUBSTITUTE", "EXCLUDED_PLAYER", "ACCOMPANYING_DELEGATION"].includes(String(offenderValue.role))
                    ? { kind: "BENCH" as const, personId: text(offenderValue.personId), role: offenderValue.role as "HEAD_COACH" | "FIRST_ASSISTANT_COACH" | "SUBSTITUTE" | "EXCLUDED_PLAYER" | "ACCOMPANYING_DELEGATION" }
                    : (() => { throw new Error("Invalid foul offender."); })();
            const contextValue = object(input.context);
            const context = contextValue.kind === "NON_SHOOTING" && typeof contextValue.teamControlFoul === "boolean"
                ? { kind: "NON_SHOOTING" as const, teamControlFoul: contextValue.teamControlFoul }
                : contextValue.kind === "SHOOTING"
                    ? { kind: "SHOOTING" as const }
                    : contextValue.kind === "NON_CONTACT"
                        ? { kind: "NON_CONTACT" as const }
                        : (() => { throw new Error("Invalid foul context."); })();
            const category = input.category === undefined ? undefined : input.category === "CATEGORY_1" || input.category === "CATEGORY_2" ? input.category : (() => { throw new Error("Invalid foul category."); })();
            return {
                kind: "foul",
                foulType: input.foulType as GameplayFoulType,
                team: team(input.team),
                stoppageId: text(input.stoppageId),
                offender,
                context,
                fouledPlayerId: optionalText(input.fouledPlayerId),
                relatedShotEventId: optionalText(input.relatedShotEventId),
                category,
            } as GameplayIntent;
        }
        default: throw new Error("Unsupported gameplay intent.");
    }
}

export function eventFactsFromIntent(intent: GameplayIntent): MatchEventFacts {
    switch (intent.kind) {
        case "clock-start": return { type: "CLOCK_START" };
        case "clock-stop": return { type: "CLOCK_STOP" };
        case "clock-set": return { type: "CLOCK_SET", remainingSeconds: intent.remainingSeconds };
        case "period-start": return { type: "PERIOD_START", period: intent.period };
        case "period-end": return { type: "PERIOD_END", period: intent.period };
        case "jump-ball": return { type: "JUMP_BALL", possession: intent.possession };
        case "alternating-possession": return { type: "ALTERNATING_POSSESSION" };
        case "shot": return {
            type: intent.points === 2 ? intent.made ? "TWO_POINT" : "TWO_POINT_MISSED" : intent.made ? "THREE_POINT" : "THREE_POINT_MISSED",
            team: intent.team,
            playerId: intent.playerId,
            ...(intent.assistPlayerId ? { assistPlayerId: intent.assistPlayerId } : {}),
            ...(intent.stoppageId ? { stoppageId: intent.stoppageId } : {}),
        };
        case "free-throw": return { type: "FREE_THROW", team: intent.team, playerId: intent.playerId, penaltyId: intent.penaltyId, attemptIndex: intent.attemptIndex, made: intent.made };
        case "rebound": return { type: "REBOUND", team: intent.team, playerId: intent.playerId, offensive: intent.offensive };
        case "steal": return { type: "STEAL", team: intent.team, playerId: intent.playerId };
        case "block": return { type: "BLOCK", team: intent.team, playerId: intent.playerId };
        case "turnover": return { type: "TURNOVER", team: intent.team, playerId: intent.playerId };
        case "timeout": return { type: "TIMEOUT", team: intent.team };
        case "substitution": return { type: "SUBSTITUTION", team: intent.team, playerInId: intent.playerInId, playerOutId: intent.playerOutId };
        case "lineup-set": return { type: "LINEUP_SET", team: intent.team, playerIds: intent.playerIds };
        case "foul": return {
            type: intent.foulType,
            team: intent.team,
            stoppageId: intent.stoppageId,
            offender: intent.offender,
            context: intent.context,
            ...(intent.fouledPlayerId ? { fouledPlayerId: intent.fouledPlayerId } : {}),
            ...(intent.relatedShotEventId ? { relatedShotEventId: intent.relatedShotEventId } : {}),
            ...(intent.category ? { category: intent.category } : {}),
        };
    }
}

export function safeGameplay(
    recovery: MatchGameplayRecovery,
    sync: StoredLocalGameplaySyncState,
): SafeMatchGameplay {
    const state = recovery.state;
    const home = object(state.home);
    const away = object(state.away);
    const currentPeriod = period(state.period);
    const currentRevision = recovery.eventHistoryRevision;
    const configurationPending = sync.lastErrorCode?.startsWith("SYNC_PENDING_CONFIGURATION") === true;
    const pending = currentRevision > sync.lastAcknowledgedHistoryRevision
        || configurationPending
        || (recovery.lifecycle === "finalized" && sync.lastAcknowledgedFinalizationHash === null);
    const lastErrorCode = publicSyncError(sync.lastErrorCode);
    const syncStatus = lastErrorCode === "SYNC_RUN_CONFLICT" || lastErrorCode === "SYNC_INTEGRITY_CONFLICT"
        ? "conflict"
        : lastErrorCode && pending
            ? "retry-needed"
            : pending
                ? "pending"
                : "synced";
    const rules = object(state.rules);
    const threshold = number(rules.teamFoulPenaltyThreshold);
    const homeTeam = safeTeam(recovery, home, "HOME", threshold);
    const awayTeam = safeTeam(recovery, away, "AWAY", threshold);
    return {
        runId: recovery.runId,
        lifecycle: recovery.lifecycle,
        eventHistoryRevision: currentRevision,
        lastAcceptedSequence: recovery.lastAcceptedSequence,
        score: { home: Number(home.score), away: Number(away.score) },
        period: currentPeriod,
        clockSeconds: Number(state.clock),
        clockRunning: state.clockRunning === true,
        possession: state.possession === "HOME" || state.possession === "AWAY" ? state.possession : null,
        alternatingPossession: team(state.alternatingPossession),
        finished: state.finished === true,
        eventIds: recovery.eventIds,
        events: recovery.events,
        teams: [homeTeam, awayTeam],
        penalty: safePenalty(state.penaltyResolution),
        sync: {
            status: syncStatus,
            acknowledgedRevision: sync.lastAcknowledgedHistoryRevision,
            lastAttemptAtUtc: sync.lastAttemptAtUtc,
            lastSuccessAtUtc: sync.lastSuccessAtUtc,
            lastErrorCode,
        },
    };
}
