import type { DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { MatchEventFacts, MatchGameplayHistoryPage, MatchGameplayHistoryQuery, MatchGameplayRecovery, MatchGameplayScorerEventEditContext, MatchGameplayScorerEventGroup, MatchGameplayScorerEventGroupingSource, MatchGameplayScorerEventMutationPreview } from "./match-gameplay.cjs";
import type { MatchStartReadinessIssue } from "./match-engine-bootstrap.cjs";
import type { StoredLocalGameplaySyncState } from "../persistence/local-database.cjs";

export type GameplayTeamSide = "HOME" | "AWAY";
export type GameplayPeriod = { kind: "REGULATION" | "OVERTIME"; index: number };
type GameplayFoulType = "PERSONAL_FOUL" | "TECHNICAL_FOUL" | "DISRUPTIVE_FOUL" | "FLAGRANT_FOUL" | "DISQUALIFYING_FOUL";
export type GameplayScorerEventTerminal = { reason: "NATURAL" | "ENTER_EARLY"; unresolvedStep?: "ASSIST" | "STEALER" | "FT1" | "FT2" | "FT3" | "REBOUNDER" | "CHOOSE_SHOOTER" | "FOULER" | "DRAWN_BY"; decisions?: { assist?: "NONE"; steal?: "NONE" }; resumeContext?: { penaltyShooterPlayerId?: string } };
export type GameplayScorerEventContext = { technicalStaffSource?: "COACH" | "BENCH" };
export interface GameplayScorerEventMetadata { scorerEventId?: string; scorerEventTerminal?: GameplayScorerEventTerminal; scorerEventContext?: GameplayScorerEventContext; }

export type GameplayIntent = GameplayScorerEventMetadata & (
    | { kind: "clock-start" }
    | { kind: "clock-stop" }
    | { kind: "clock-set"; remainingSeconds: number }
    | { kind: "period-start"; period: GameplayPeriod }
    | { kind: "period-end"; period: GameplayPeriod }
    | { kind: "jump-ball"; possession: GameplayTeamSide }
    | { kind: "alternating-possession" }
    | { kind: "shot"; team: GameplayTeamSide; playerId: string; points: 2 | 3; made: boolean; assistPlayerId?: string; stoppageId?: string }
    | { kind: "free-throw"; team: GameplayTeamSide; playerId: string; penaltyId: string; attemptIndex: number; made: boolean }
    | { kind: "penalty-administration-ended"; penaltyId: string }
    | { kind: "rebound"; team: GameplayTeamSide; offensive: boolean; playerId: string; teamRebound?: false }
    | { kind: "rebound"; team: GameplayTeamSide; offensive: boolean; teamRebound: true; playerId?: never }
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
    });

export type GameplayMutationInput =
    | { operation: "append"; runId: string; intent: GameplayIntent }
    | { operation: "remove"; runId: string; eventId: string; cascadeDependencies: boolean }
    | { operation: "correct"; runId: string; eventId: string; intent: GameplayIntent; cascadeDependencies: boolean };

export type GameplayScorerEventMutationInput =
    | { kind: "REPLACE_GROUP"; scorerEventGroupId: string; expectedHistoryRevision: number; mode?: GameplayScorerEventEditModeInput; events: Array<{ eventId?: string; intent: GameplayIntent }> }
    | { kind: "DELETE_GROUP"; scorerEventGroupId: string; expectedHistoryRevision: number };
export type GameplayScorerEventEditModeInput = { mode: "HISTORY" } | { mode: "CURRENT_OPEN"; scorerEventId: string };
export type GameplayScorerEventDraftActionInput = { kind: "CORRECT_PLAYER"; targetId: string; playerId: string } | { kind: "CORRECT_SHOT_RESULT" | "CORRECT_FREE_THROW_RESULT"; targetId: string; made: boolean } | { kind: "ASSIST"; playerId: string | null } | { kind: "STEALER"; playerId: string | null } | { kind: "CHOOSE_SHOOTER"; playerId: string } | { kind: "FREE_THROW_RESULT"; made: boolean } | { kind: "REBOUNDER"; team: GameplayTeamSide; playerId?: string; teamRebound: boolean };
export interface GameplayScorerEventMutationPreviewInput { scorerEventGroupId: string; expectedHistoryRevision: number; mode?: GameplayScorerEventEditModeInput; events: Array<{ draftId: string; eventId?: string; intent: GameplayIntent }>; action?: GameplayScorerEventDraftActionInput; }

export interface GameplayHistoryQueryInput { limit?: number; beforeSequence?: number | null; period?: GameplayPeriod | null; }

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
    fouls: { total: number; category1TechnicalCount: number; category2TechnicalCount: number; disruptiveCount: number; flagrantCount: number; directDisqualification: boolean; status: string; statusReason: string | null };
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
    timeoutAllowance: number;
    teamFouls: number;
    inBonus: boolean;
    discipline: { headCoachCategory1TechnicalCount: number; benchCategory1TechnicalCount: number; headCoachDisqualified: boolean; disqualifiedBenchCount: number };
    captainPlayerId: string | null;
    starterPlayerIds: string[];
    players: SafeGameplayPlayer[];
    bench: Array<{ personId: string; displayName: string; role: "HEAD_COACH" | "FIRST_ASSISTANT_COACH" | "SUBSTITUTE" | "EXCLUDED_PLAYER" | "ACCOMPANYING_DELEGATION"; roleLabel: string; source: "PACKAGE" | "RUN" | "TEAM" }>;
    statistics: Record<string, number>;
}
export interface SafeGameplayPenaltySummary {
    stoppageId: string;
    activePenaltyIds: string[];
    entitlements: Array<{ penaltyId: string; sourceFoulEventId: string; kind: "FREE_THROWS" | "RESTART_ONLY"; beneficiaryTeam: GameplayTeamSide; shootingTeam: GameplayTeamSide | null; attempts: number | null; completedAttempts: number | null; shooterPolicy: "FOULED_PLAYER" | "ANY_OPPONENT" | null; designatedPlayerId: string | null; restartKind: string; cancelled: boolean }>;
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
    periodScores: SafeGameplayPeriodScore[];
    clockSeconds: number;
    clockRunning: boolean;
    clockStartedAtMs: number | null;
    possession: GameplayTeamSide | null;
    alternatingPossession: GameplayTeamSide;
    finished: boolean;
    latestEvent: { eventId: string; sequence: number; occurredAt: number; type: string; team?: GameplayTeamSide; playerId?: string; scorerEventId?: string; scorerEventTerminal?: GameplayScorerEventTerminal; scorerEventContext?: GameplayScorerEventContext } | null;
    rules: { startingPlayers: number; regulationPeriods: number; regulationPeriodSeconds: number; overtimeSeconds: number; resultPolicy: "ALLOW_TIE" | "REQUIRE_WINNER" };
    teams: [SafeGameplayTeam, SafeGameplayTeam];
    penalty: SafeGameplayPenaltySummary | null;
    sync: SafeGameplaySyncState;
}

export interface SafeGameplayPeriodScore {
    period: GameplayPeriod;
    home: number;
    away: number;
}

export type MatchGameplayOperationResult =
    | { ok: true; gameplay: SafeMatchGameplay; state: DesktopAuthState }
    | { ok: false; errorCode: string; dependentEventIds?: string[]; startReadiness?: MatchStartReadinessIssue; state: DesktopAuthState };

export interface ResumableLiveFlowInput {
    flowKind: "SHOOTING_FOUL";
    stage: "PENALTY";
    rootEventId: string;
    sourceFoulEventId: string;
    selectedFreeThrowShooterId: string;
    expectedHistoryRevision: number;
}

export interface SafeResumableLiveFlow extends ResumableLiveFlowInput {
    flowSchemaVersion: 1;
    createdAtUtc: string;
    updatedAtUtc: string;
}

export type ResumableLiveFlowOperationResult =
    | { ok: true; flow: SafeResumableLiveFlow | null; state: DesktopAuthState }
    | { ok: false; errorCode: string; state: DesktopAuthState };

export interface SafeGameplayHistoryItem {
    eventId: string;
    sequence: number;
    occurredAt: number;
    type: string;
    team?: GameplayTeamSide;
    playerId?: string;
    scorerEventId?: string;
    scorerEventTerminal?: GameplayScorerEventTerminal;
    scorerEventContext?: GameplayScorerEventContext;
    scorerEventGroupId: string;
    scorerEventGroupOrdinal: number;
    scorerEventGroupingSource: MatchGameplayScorerEventGroupingSource;
    scorerEventGroupSafeForReconstruction: boolean;
    isGoalFoul?: boolean;
    period: GameplayPeriod;
    clockSeconds: number;
    intent: GameplayIntent | null;
}
export interface SafeGameplayHistoryPage { runId: string; items: SafeGameplayHistoryItem[]; nextBeforeSequence: number | null; total: number; }
export type GameplayHistoryOperationResult = { ok: true; history: SafeGameplayHistoryPage; state: DesktopAuthState } | { ok: false; errorCode: string; state: DesktopAuthState };
export interface SafeGameplayScorerEventGroup {
    scorerEventGroupId: string;
    groupingSource: MatchGameplayScorerEventGroupingSource;
    groupOrdinal: number;
    canonicalEventIds: string[];
    visibleEventIds: string[];
    firstSequence: number;
    lastSequence: number;
    period: GameplayPeriod;
    clockSeconds: number;
    scorerEventTerminal?: GameplayScorerEventTerminal;
    terminalConflict: boolean;
    safeForReconstruction: boolean;
    items: SafeGameplayHistoryItem[];
}
export type GameplayScorerEventGroupOperationResult = { ok: true; group: SafeGameplayScorerEventGroup | null; state: DesktopAuthState } | { ok: false; errorCode: string; state: DesktopAuthState };
export type SafeGameplayScorerEventEditContext = Omit<MatchGameplayScorerEventEditContext, "group"> & { group: SafeGameplayScorerEventGroup };
export type GameplayScorerEventEditContextOperationResult = { ok: true; context: SafeGameplayScorerEventEditContext | null; state: DesktopAuthState } | { ok: false; errorCode: string; state: DesktopAuthState };
export interface SafeGameplayScorerEventMutationPreview { scorerEventGroupId: string; expectedHistoryRevision: number; normalizedGroup: SafeGameplayScorerEventGroup; editContext: SafeGameplayScorerEventEditContext; draftEvents: Array<{ draftId: string; eventId?: string; intent: GameplayIntent | null }> }
export type GameplayScorerEventMutationPreviewOperationResult = { ok: true; preview: SafeGameplayScorerEventMutationPreview; state: DesktopAuthState } | { ok: false; errorCode: string; dependentEventIds?: string[]; state: DesktopAuthState };

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

function sameGameplayPeriod(left: GameplayPeriod, right: GameplayPeriod): boolean {
    return left.kind === right.kind && left.index === right.index;
}

export function gameplayPeriodScores(
    events: MatchGameplayRecovery["events"],
    currentPeriod: GameplayPeriod,
): SafeGameplayPeriodScore[] {
    const scores: SafeGameplayPeriodScore[] = [];
    const ensureScore = (target: GameplayPeriod): SafeGameplayPeriodScore => {
        const existing = scores.find((score) => sameGameplayPeriod(score.period, target));
        if (existing) return existing;
        const created: SafeGameplayPeriodScore = { period: { ...target }, home: 0, away: 0 };
        scores.push(created);
        return created;
    };

    let activePeriod: GameplayPeriod = { kind: "REGULATION", index: 1 };
    ensureScore(activePeriod);
    for (const event of [...events].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId))) {
        if (event.type === "PERIOD_START" && event.period) {
            activePeriod = { ...event.period };
            ensureScore(activePeriod);
            continue;
        }
        const points = event.type === "TWO_POINT"
            ? 2
            : event.type === "THREE_POINT"
                ? 3
                : event.type === "FREE_THROW" && event.made === true
                    ? 1
                    : 0;
        if (points > 0 && (event.team === "HOME" || event.team === "AWAY")) {
            const score = ensureScore(activePeriod);
            if (event.team === "HOME") score.home += points;
            else score.away += points;
        }
    }
    ensureScore(currentPeriod);
    return scores;
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
    if (!Array.isArray(source.entitlements) || !Array.isArray(source.freeThrowQueue) || !Array.isArray(source.cancelledPenaltyIds) || typeof source.administrationStarted !== "boolean") throw new Error("Invalid gameplay penalty projection.");
    const finalRestart = object(source.finalRestart);
    const cancelled = new Set(source.cancelledPenaltyIds.filter((entry): entry is string => typeof entry === "string"));
    const activePenaltyIds = source.freeThrowQueue.map((entry) => text(object(entry).penaltyId));
    return {
        stoppageId: text(source.stoppageId),
        activePenaltyIds,
        entitlements: source.entitlements.map((entry) => {
            const entitlement = object(entry);
            if ((entitlement.kind !== "FREE_THROWS" && entitlement.kind !== "RESTART_ONLY") || (entitlement.beneficiaryTeam !== "HOME" && entitlement.beneficiaryTeam !== "AWAY")) throw new Error("Invalid gameplay penalty projection.");
            const restart = object(entitlement.restart);
            return {
                penaltyId: text(entitlement.penaltyId),
                sourceFoulEventId: text(entitlement.sourceFoulEventId),
                kind: entitlement.kind,
                beneficiaryTeam: entitlement.beneficiaryTeam,
                shootingTeam: entitlement.shootingTeam === "HOME" || entitlement.shootingTeam === "AWAY" ? entitlement.shootingTeam : null,
                attempts: entitlement.kind === "FREE_THROWS" ? number(entitlement.attempts) : null,
                completedAttempts: entitlement.kind === "FREE_THROWS" ? number(entitlement.completedAttempts) : null,
                shooterPolicy: entitlement.shooterPolicy === "FOULED_PLAYER" || entitlement.shooterPolicy === "ANY_OPPONENT" ? entitlement.shooterPolicy : null,
                designatedPlayerId: typeof entitlement.designatedPlayerId === "string" ? entitlement.designatedPlayerId : null,
                restartKind: text(restart.kind),
                cancelled: cancelled.has(text(entitlement.penaltyId)),
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

function engineBenchRole(value: string): SafeGameplayTeam["bench"][number]["role"] {
    const role = value.trim().toLocaleLowerCase("el").replace(/[\s-]+/g, "_");
    if (role === "coach" || role.includes("head_coach") || role.includes("προπονητ")) return "HEAD_COACH";
    if (role === "assistant_coach" || role.includes("assistant") || role.includes("βοηθ")) return "FIRST_ASSISTANT_COACH";
    if (role.includes("substitute")) return "SUBSTITUTE";
    return "ACCOMPANYING_DELEGATION";
}
function safeTeam(recovery: MatchGameplayRecovery, stateTeamValue: unknown, side: GameplayTeamSide, threshold: number): SafeGameplayTeam {
    const stateTeam = object(stateTeamValue);
    const currentTeam = recovery.currentConfiguration.teams.find((team) => team.side === side);
    const sourceTeam = side === "HOME" ? recovery.setup.home : recovery.setup.away;
    if (!currentTeam || currentTeam.teamId !== sourceTeam.teamId || !Array.isArray(stateTeam.players)) throw new Error("Invalid gameplay team projection.");
    const enginePlayers = new Map(stateTeam.players.map((value) => {
        const player = object(value);
        return [text(player.playerId), player] as const;
    }));
    const participating = currentTeam.players.filter((player) => player.participating);
    if (enginePlayers.size !== participating.length || participating.some((player) => !enginePlayers.has(player.playerId) || player.gameShirtNumber === null)) throw new Error("Invalid gameplay roster projection.");
    const leftSide = recovery.currentConfiguration.presentation.leftSide;
    const discipline = object(stateTeam.discipline);
    const participatingStaff = new Set(currentTeam.staff.filter((member) => member.participating).map((member) => member.staffId));
    const packageBench = sourceTeam.staff.filter((member) => participatingStaff.has(member.staffId)).map((member) => ({ personId: member.staffId, displayName: member.displayName, role: engineBenchRole(member.role), roleLabel: member.roleLabel ?? member.role, source: "PACKAGE" as const }));
    const runBench = currentTeam.extraBench.map((member) => ({ personId: member.entryId, displayName: member.name, role: engineBenchRole(member.role), roleLabel: member.role, source: "RUN" as const }));
    const systemBench: SafeGameplayTeam["bench"] = [
        { personId: `team:${side}`, displayName: `TEAM ${side}`, role: "ACCOMPANYING_DELEGATION", roleLabel: "Ομάδα", source: "TEAM" },
        { personId: `coach:${side}`, displayName: `COACH ${side}`, role: "HEAD_COACH", roleLabel: "Προπονητής", source: "TEAM" },
        { personId: `bench:${side}`, displayName: `BENCH ${side}`, role: "ACCOMPANYING_DELEGATION", roleLabel: "Πάγκος", source: "TEAM" },
    ];
    return {
        side,
        presentationSide: leftSide === side ? "LEFT" : "RIGHT",
        teamId: text(stateTeam.id),
        teamName: text(stateTeam.name),
        gameColor: currentTeam.gameColor,
        score: number(stateTeam.score),
        timeouts: number(stateTeam.timeouts),
        timeoutAllowance: typeof stateTeam.timeoutAllowance === "number" ? number(stateTeam.timeoutAllowance) : 5,
        teamFouls: number(stateTeam.teamFouls),
        inBonus: number(stateTeam.teamFouls) >= threshold,
        discipline: {
            headCoachCategory1TechnicalCount: number(discipline.headCoachCategory1TechnicalCount),
            benchCategory1TechnicalCount: number(discipline.benchCategory1TechnicalCount),
            headCoachDisqualified: discipline.headCoachDisqualified === true,
            disqualifiedBenchCount: Array.isArray(discipline.disqualifiedBenchPersonIds) ? discipline.disqualifiedBenchPersonIds.length : 0,
        },
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
                    category1TechnicalCount: number(foulState.category1TechnicalCount),
                    category2TechnicalCount: number(foulState.category2TechnicalCount),
                    disruptiveCount: number(foulState.disruptiveCount),
                    flagrantCount: number(foulState.flagrantCount),
                    directDisqualification: foulState.directDisqualification === true,
                    status: text(foulState.status),
                    statusReason: typeof foulState.statusReason === "string" ? foulState.statusReason : null,
                },
                statistics: numericRecord(player.statistics),
            };
        }),
        bench: [...packageBench, ...runBench, ...systemBench],
        statistics: numericRecord(stateTeam.statistics),
    };
}
function publicSyncError(value: string | null): string | null {
    if (!value?.startsWith("SYNC_PENDING_CONFIGURATION")) return value;
    return value === "SYNC_PENDING_CONFIGURATION" ? null : value.slice("SYNC_PENDING_CONFIGURATION_".length);
}

function scorerEventMetadata(input: Record<string, unknown>): GameplayScorerEventMetadata {
    const scorerEventId = optionalText(input.scorerEventId);
    const contextValue = input.scorerEventContext === undefined ? undefined : object(input.scorerEventContext);
    const technicalStaffSource = contextValue?.technicalStaffSource === "COACH" || contextValue?.technicalStaffSource === "BENCH" ? contextValue.technicalStaffSource : undefined;
    if (contextValue && !technicalStaffSource) throw new Error("Invalid scorer event context.");
    const scorerEventContext: GameplayScorerEventContext | undefined = technicalStaffSource ? { technicalStaffSource } : undefined;
    if (input.scorerEventTerminal === undefined) return { ...(scorerEventId ? { scorerEventId } : {}), ...(scorerEventContext ? { scorerEventContext } : {}) };
    const terminal = object(input.scorerEventTerminal);
    if (terminal.reason !== "NATURAL" && terminal.reason !== "ENTER_EARLY") throw new Error("Invalid scorer event terminal.");
    const unresolvedStep = terminal.unresolvedStep === undefined ? undefined : terminal.unresolvedStep;
    if (unresolvedStep !== undefined && !["ASSIST", "STEALER", "FT1", "FT2", "FT3", "REBOUNDER", "CHOOSE_SHOOTER", "FOULER", "DRAWN_BY"].includes(String(unresolvedStep))) throw new Error("Invalid scorer event terminal.");
    const decisionsValue = terminal.decisions === undefined ? undefined : object(terminal.decisions);
    if (decisionsValue && ((decisionsValue.assist !== undefined && decisionsValue.assist !== "NONE") || (decisionsValue.steal !== undefined && decisionsValue.steal !== "NONE"))) throw new Error("Invalid scorer event terminal.");
    const decisions = decisionsValue ? { ...(decisionsValue.assist === "NONE" ? { assist: "NONE" as const } : {}), ...(decisionsValue.steal === "NONE" ? { steal: "NONE" as const } : {}) } : undefined;
    const resumeValue = terminal.resumeContext === undefined ? undefined : object(terminal.resumeContext);
    const penaltyShooterPlayerId = resumeValue ? optionalText(resumeValue.penaltyShooterPlayerId) : undefined;
    return {
        ...(scorerEventId ? { scorerEventId } : {}),
        ...(scorerEventContext ? { scorerEventContext } : {}),
        scorerEventTerminal: {
            reason: terminal.reason,
            ...(unresolvedStep ? { unresolvedStep: unresolvedStep as GameplayScorerEventTerminal["unresolvedStep"] } : {}),
            ...(decisions && Object.keys(decisions).length ? { decisions } : {}),
            ...(penaltyShooterPlayerId ? { resumeContext: { penaltyShooterPlayerId } } : {}),
        },
    };
}

function scorerEventFacts(intent: GameplayScorerEventMetadata): GameplayScorerEventMetadata {
    return { ...(intent.scorerEventId ? { scorerEventId: intent.scorerEventId } : {}), ...(intent.scorerEventTerminal ? { scorerEventTerminal: intent.scorerEventTerminal } : {}), ...(intent.scorerEventContext ? { scorerEventContext: intent.scorerEventContext } : {}) };
}

export function parseGameplayIntent(value: unknown): GameplayIntent {
    const input = object(value);
    const metadata = scorerEventMetadata(input);
    const parsed = (() => { switch (input.kind) {
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
        case "penalty-administration-ended": return { kind: "penalty-administration-ended", penaltyId: text(input.penaltyId) };
        case "rebound": {
            if (typeof input.offensive !== "boolean") throw new Error("Invalid rebound intent.");
            if (input.teamRebound === true) return { kind: "rebound", team: team(input.team), offensive: input.offensive, teamRebound: true };
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
    } })();
    return { ...parsed, ...metadata } as GameplayIntent;
}

export function parseGameplayIntents(value: unknown): GameplayIntent[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error("Invalid gameplay intent batch.");
    return value.map(parseGameplayIntent);
}

export function parseGameplayScorerEventMutationInput(value: unknown): GameplayScorerEventMutationInput {
    const input = object(value);
    const scorerEventGroupId = text(input.scorerEventGroupId);
    const expectedHistoryRevision = Number(input.expectedHistoryRevision);
    if (!Number.isInteger(expectedHistoryRevision) || expectedHistoryRevision < 1) throw new Error("Invalid scorer-event mutation revision.");
    if (input.kind === "DELETE_GROUP") return { kind: "DELETE_GROUP", scorerEventGroupId, expectedHistoryRevision };
    if (input.kind !== "REPLACE_GROUP" || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 64) throw new Error("Invalid scorer-event replacement.");
    const mode = input.mode === undefined ? undefined : parseGameplayScorerEventEditModeInput(input.mode);
    return {
        kind: "REPLACE_GROUP",
        scorerEventGroupId,
        expectedHistoryRevision,
        ...(mode ? { mode } : {}),
        events: input.events.map((value) => {
            const replacement = object(value);
            const eventId = optionalText(replacement.eventId);
            return { ...(eventId ? { eventId } : {}), intent: parseGameplayIntent(replacement.intent) };
        }),
    };
}

export function parseGameplayScorerEventMutationPreviewInput(value: unknown): GameplayScorerEventMutationPreviewInput {
    const input = object(value); const scorerEventGroupId = text(input.scorerEventGroupId); const expectedHistoryRevision = Number(input.expectedHistoryRevision);
    if (!Number.isInteger(expectedHistoryRevision) || expectedHistoryRevision < 1 || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 64) throw new Error("Invalid scorer-event mutation preview.");
    const events = input.events.map((value) => { const event = object(value); return { draftId: text(event.draftId), ...(event.eventId === undefined ? {} : { eventId: text(event.eventId) }), intent: parseGameplayIntent(event.intent) }; });
    let action: GameplayScorerEventDraftActionInput | undefined;
    if (input.action !== undefined) {
        const value = object(input.action); const kind = text(value.kind);
        if (kind === "CORRECT_PLAYER") action = { kind, targetId: text(value.targetId), playerId: text(value.playerId) };
        else if ((kind === "CORRECT_SHOT_RESULT" || kind === "CORRECT_FREE_THROW_RESULT") && typeof value.made === "boolean") action = { kind, targetId: text(value.targetId), made: value.made };
        else if (kind === "ASSIST" || kind === "STEALER") action = { kind, playerId: value.playerId === null ? null : text(value.playerId) };
        else if (kind === "CHOOSE_SHOOTER") action = { kind, playerId: text(value.playerId) };
        else if (kind === "FREE_THROW_RESULT" && typeof value.made === "boolean") action = { kind, made: value.made };
        else if (kind === "REBOUNDER" && typeof value.teamRebound === "boolean") action = { kind, team: team(value.team), ...(value.playerId === undefined ? {} : { playerId: text(value.playerId) }), teamRebound: value.teamRebound };
        else throw new Error("Invalid scorer-event draft action.");
    }
    const mode = input.mode === undefined ? undefined : parseGameplayScorerEventEditModeInput(input.mode);
    return { scorerEventGroupId, expectedHistoryRevision, ...(mode ? { mode } : {}), events, ...(action ? { action } : {}) };
}

export function parseGameplayScorerEventEditModeInput(value: unknown): GameplayScorerEventEditModeInput {
    const input = object(value);
    if (input.mode === "HISTORY") return { mode: "HISTORY" };
    if (input.mode === "CURRENT_OPEN") return { mode: "CURRENT_OPEN", scorerEventId: text(input.scorerEventId) };
    throw new Error("Invalid scorer-event edit mode.");
}

export function parseResumableLiveFlowInput(value: unknown): ResumableLiveFlowInput {
    const input = object(value);
    if (input.flowKind !== "SHOOTING_FOUL" || input.stage !== "PENALTY" || !Number.isInteger(input.expectedHistoryRevision) || Number(input.expectedHistoryRevision) < 1) throw new Error("Invalid resumable Live flow.");
    return {
        flowKind: "SHOOTING_FOUL", stage: "PENALTY", rootEventId: text(input.rootEventId), sourceFoulEventId: text(input.sourceFoulEventId),
        selectedFreeThrowShooterId: text(input.selectedFreeThrowShooterId), expectedHistoryRevision: Number(input.expectedHistoryRevision),
    };
}

export function parseGameplayHistoryQuery(value: unknown): MatchGameplayHistoryQuery {
    const input = value === undefined || value === null ? {} : object(value);
    const limit = input.limit === undefined ? 30 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid gameplay history limit.");
    const beforeSequence = input.beforeSequence === undefined || input.beforeSequence === null ? null : Number(input.beforeSequence);
    if (beforeSequence !== null && (!Number.isInteger(beforeSequence) || beforeSequence < 2)) throw new Error("Invalid gameplay history cursor.");
    const selectedPeriod = input.period === undefined || input.period === null ? null : period(input.period);
    return { limit, beforeSequence, period: selectedPeriod };
}

export function eventFactsFromIntent(intent: GameplayIntent): MatchEventFacts {
    const facts = (() => { switch (intent.kind) {
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
        case "penalty-administration-ended": return { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: intent.penaltyId };
        case "rebound": return intent.teamRebound === true
            ? { type: "REBOUND", team: intent.team, offensive: intent.offensive, teamRebound: true }
            : { type: "REBOUND", team: intent.team, playerId: intent.playerId, offensive: intent.offensive };
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
    } })();
    return { ...facts, ...scorerEventFacts(intent) } as MatchEventFacts;
}

export function intentFromEventFacts(facts: MatchEventFacts): GameplayIntent | null {
    try {
        const intent = (() => { switch (facts.type) {
            case "CLOCK_START": return { kind: "clock-start" };
            case "CLOCK_STOP": return { kind: "clock-stop" };
            case "CLOCK_SET": return parseGameplayIntent({ kind: "clock-set", remainingSeconds: facts.remainingSeconds });
            case "PERIOD_START": return parseGameplayIntent({ kind: "period-start", period: facts.period });
            case "PERIOD_END": return parseGameplayIntent({ kind: "period-end", period: facts.period });
            case "JUMP_BALL": return parseGameplayIntent({ kind: "jump-ball", possession: facts.possession });
            case "ALTERNATING_POSSESSION": return { kind: "alternating-possession" };
            case "TWO_POINT": case "TWO_POINT_MISSED": case "THREE_POINT": case "THREE_POINT_MISSED": return parseGameplayIntent({ kind: "shot", team: facts.team, playerId: facts.playerId, points: facts.type.startsWith("TWO") ? 2 : 3, made: !facts.type.endsWith("MISSED"), assistPlayerId: facts.assistPlayerId, stoppageId: facts.stoppageId });
            case "FREE_THROW": return parseGameplayIntent({ kind: "free-throw", team: facts.team, playerId: facts.playerId, penaltyId: facts.penaltyId, attemptIndex: facts.attemptIndex, made: facts.made });
            case "PENALTY_ADMINISTRATION_ENDED": return parseGameplayIntent({ kind: "penalty-administration-ended", penaltyId: facts.penaltyId });
            case "REBOUND": return parseGameplayIntent({ kind: "rebound", team: facts.team, playerId: facts.playerId, offensive: facts.offensive, teamRebound: facts.teamRebound });
            case "STEAL": case "BLOCK": case "TURNOVER": return parseGameplayIntent({ kind: facts.type.toLocaleLowerCase().replace("_", "-"), team: facts.team, playerId: facts.playerId });
            case "TIMEOUT": return parseGameplayIntent({ kind: "timeout", team: facts.team });
            case "SUBSTITUTION": return parseGameplayIntent({ kind: "substitution", team: facts.team, playerInId: facts.playerInId, playerOutId: facts.playerOutId });
            case "LINEUP_SET": return parseGameplayIntent({ kind: "lineup-set", team: facts.team, playerIds: facts.playerIds });
            case "PERSONAL_FOUL": case "TECHNICAL_FOUL": case "DISRUPTIVE_FOUL": case "FLAGRANT_FOUL": case "DISQUALIFYING_FOUL": return parseGameplayIntent({ kind: "foul", foulType: facts.type, team: facts.team, stoppageId: facts.stoppageId, offender: facts.offender, context: facts.context, fouledPlayerId: facts.fouledPlayerId, relatedShotEventId: facts.relatedShotEventId, category: facts.category });
            default: return null;
        } })();
        return intent ? { ...intent, ...scorerEventFacts(facts) } as GameplayIntent : null;
    } catch { return null; }
}

function safeGameplayHistoryItem(item: MatchGameplayHistoryPage["items"][number]): SafeGameplayHistoryItem {
    return { eventId: item.eventId, sequence: item.sequence, occurredAt: item.occurredAt, type: item.type, ...(item.team ? { team: item.team } : {}), ...(item.playerId ? { playerId: item.playerId } : {}), ...(item.scorerEventId ? { scorerEventId: item.scorerEventId } : {}), ...(item.scorerEventTerminal ? { scorerEventTerminal: item.scorerEventTerminal } : {}), ...(item.scorerEventContext ? { scorerEventContext: item.scorerEventContext } : {}), scorerEventGroupId: item.scorerEventGroupId, scorerEventGroupOrdinal: item.scorerEventGroupOrdinal, scorerEventGroupingSource: item.scorerEventGroupingSource, scorerEventGroupSafeForReconstruction: item.scorerEventGroupSafeForReconstruction, ...(item.isGoalFoul === true ? { isGoalFoul: true } : {}), period: item.period, clockSeconds: item.clockSeconds, intent: intentFromEventFacts(item.facts) };
}

export function safeGameplayHistory(page: MatchGameplayHistoryPage): SafeGameplayHistoryPage {
    return { runId: page.runId, nextBeforeSequence: page.nextBeforeSequence, total: page.total, items: page.items.map(safeGameplayHistoryItem) };
}

export function safeGameplayScorerEventGroup(group: MatchGameplayScorerEventGroup): SafeGameplayScorerEventGroup {
    return { scorerEventGroupId: group.scorerEventGroupId, groupingSource: group.groupingSource, groupOrdinal: group.groupOrdinal, canonicalEventIds: [...group.canonicalEventIds], visibleEventIds: [...group.visibleEventIds], firstSequence: group.firstSequence, lastSequence: group.lastSequence, period: group.period, clockSeconds: group.clockSeconds, ...(group.scorerEventTerminal ? { scorerEventTerminal: group.scorerEventTerminal } : {}), terminalConflict: group.terminalConflict, safeForReconstruction: group.safeForReconstruction, items: group.items.map(safeGameplayHistoryItem) };
}

export function safeGameplayScorerEventEditContext(context: MatchGameplayScorerEventEditContext): SafeGameplayScorerEventEditContext {
    return { ...context, group: safeGameplayScorerEventGroup(context.group), historicalState: { anchor: "BEFORE_GROUP", teams: context.historicalState.teams.map((team) => ({ side: team.side, players: team.players.map((player) => ({ ...player })) })) }, editCapabilities: { ...context.editCapabilities, targets: context.editCapabilities.targets.map((target) => ({ ...target, candidatePlayerIds: [...target.candidatePlayerIds], ...(target.allowedValues ? { allowedValues: [...target.allowedValues] as ["MADE", "MISS"] } : {}) })) }, continuationPlan: context.continuationPlan ? { ...context.continuationPlan, candidatePlayerIds: [...context.continuationPlan.candidatePlayerIds], ...(context.continuationPlan.kind === "FREE_THROW_RESULT" ? { allowedResults: [...context.continuationPlan.allowedResults] as ["MADE", "MISS"] } : {}) } : null, timeContext: { ...context.timeContext, period: { ...context.timeContext.period } } };
}

export function safeGameplayScorerEventMutationPreview(preview: MatchGameplayScorerEventMutationPreview): SafeGameplayScorerEventMutationPreview {
    return { scorerEventGroupId: preview.scorerEventGroupId, expectedHistoryRevision: preview.expectedHistoryRevision, normalizedGroup: safeGameplayScorerEventGroup(preview.normalizedGroup), editContext: safeGameplayScorerEventEditContext(preview.editContext), draftEvents: preview.draftEvents.map((event) => ({ draftId: event.draftId, ...(event.eventId ? { eventId: event.eventId } : {}), intent: intentFromEventFacts(event.facts) })) };
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
    let clockStartedAtMs: number | null = null;
    for (const event of recovery.events) {
        if (event.type === "CLOCK_START") clockStartedAtMs = event.occurredAt;
        else if (event.type === "CLOCK_STOP" || event.type === "CLOCK_SET" || event.type === "PERIOD_START" || event.type === "PERIOD_END") clockStartedAtMs = null;
    }
    const resultPolicy = rules.resultPolicy === "ALLOW_TIE" || rules.resultPolicy === "REQUIRE_WINNER" ? rules.resultPolicy : (() => { throw new Error("Invalid gameplay rules projection."); })();
    return {
        runId: recovery.runId,
        lifecycle: recovery.lifecycle,
        eventHistoryRevision: currentRevision,
        lastAcceptedSequence: recovery.lastAcceptedSequence,
        score: { home: Number(home.score), away: Number(away.score) },
        period: currentPeriod,
        periodScores: gameplayPeriodScores(recovery.events, currentPeriod),
        clockSeconds: Number(state.clock),
        clockRunning: state.clockRunning === true,
        clockStartedAtMs: state.clockRunning === true ? clockStartedAtMs : null,
        possession: state.possession === "HOME" || state.possession === "AWAY" ? state.possession : null,
        alternatingPossession: team(state.alternatingPossession),
        finished: state.finished === true,
        latestEvent: recovery.events.length > 0 ? recovery.events[recovery.events.length - 1] : null,
        rules: { startingPlayers: number(rules.startingPlayers), regulationPeriods: number(rules.regulationPeriods), regulationPeriodSeconds: number(rules.regulationPeriodSeconds), overtimeSeconds: number(rules.overtimeSeconds), resultPolicy },
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
