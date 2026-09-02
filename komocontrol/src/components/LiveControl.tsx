import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { reconstructHistoricalScorerEventEdit, reconstructScorerEventGroup, type HistoricalScorerEventPreview } from "./live-control-history-preview";

type Side = KomoControlTeamSide;
type ActionId = "SHOOT" | "FOUL" | "TURN_OVER" | "SUBS" | "TIME_OUT" | "TECH_FOUL" | "JUMP_BALL" | "OFFENSIVE_FOUL";
type FoulType = "PERSONAL_FOUL" | "TECHNICAL_FOUL" | "DISRUPTIVE_FOUL" | "FLAGRANT_FOUL" | "DISQUALIFYING_FOUL";

function isSevereContactFoul(foulType: FoulType | undefined): boolean {
    return foulType === "FLAGRANT_FOUL" || foulType === "DISRUPTIVE_FOUL";
}

function severeFoulLabel(foulType: FoulType | undefined): string {
    return foulType === "FLAGRANT_FOUL" ? "FLAGRANT GD" : "DISRUPTIVE";
}

export const livePrimaryActions = [
    { id: "SHOOT", label: "SHOOT", glyph: "◎" },
    { id: "FOUL", label: "FOUL", glyph: "!" },
    { id: "TURN_OVER", label: "TURN OVER", glyph: "↻" },
    { id: "SUBS", label: "SUBS", glyph: "⇄" },
    { id: "TIME_OUT", label: "TIME OUT", glyph: "◷" },
    { id: "TECH_FOUL", label: "TECH. FOUL", glyph: "⚠" },
    { id: "JUMP_BALL", label: "JUMP BALL", glyph: "↕" },
    { id: "OFFENSIVE_FOUL", label: "OFFENSIVE FOUL", glyph: "✋" },
] as const;

export function firstLiveFlowStep(action: ActionId): string {
    if (action === "SHOOT") return "shooter";
    if (action === "FOUL") return "offender";
    if (action === "TURN_OVER" || action === "OFFENSIVE_FOUL") return "offender";
    if (action === "SUBS") return "out";
    if (action === "TIME_OUT" || action === "JUMP_BALL") return "team-target";
    return "foul-type";
}

export function livePrimaryActionAvailable(action: ActionId, activeAction: string | null): boolean {
    return activeAction === null || (action === "SUBS" && activeAction !== "SUBS");
}

export function formatLiveClock(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function liveClockCorrectionMaximumSeconds(gameplay: KomoControlSafeMatchGameplay): number {
    return gameplay.period.kind === "OVERTIME" ? gameplay.rules.overtimeSeconds : gameplay.rules.regulationPeriodSeconds;
}

export function validateLiveClockCorrection(value: string, maximumSeconds: number): { remainingSeconds: number; error: null } | { remainingSeconds: null; error: string } {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match || Number(match[2]) > 59) return { remainingSeconds: null, error: "Χρησιμοποιήστε μορφή ΛΛ:ΔΔ." };
    const remainingSeconds = Number(match[1]) * 60 + Number(match[2]);
    if (!Number.isInteger(remainingSeconds) || remainingSeconds < 0) return { remainingSeconds: null, error: "Χρησιμοποιήστε μορφή ΛΛ:ΔΔ." };
    if (remainingSeconds > maximumSeconds) return { remainingSeconds: null, error: `Το ρολόι δεν μπορεί να υπερβαίνει τα ${formatLiveClock(maximumSeconds)}.` };
    return { remainingSeconds, error: null };
}

export const INCIDENT_REPORT_MAX_LENGTH = 20_000;

export function normalizeIncidentReport(value: string): string | null {
    const normalized = value.replace(/\r\n?/g, "\n").trim();
    return normalized || null;
}

export function validateIncidentReport(value: string): { incidentReport: string | null; error: null } | { incidentReport: null; error: string } {
    const incidentReport = normalizeIncidentReport(value);
    if (incidentReport !== null && incidentReport.length > INCIDENT_REPORT_MAX_LENGTH) {
        return { incidentReport: null, error: `Η αναφορά δεν μπορεί να υπερβαίνει τους ${INCIDENT_REPORT_MAX_LENGTH.toLocaleString("el-GR")} χαρακτήρες.` };
    }
    return { incidentReport, error: null };
}

export function liveClockSeconds(gameplay: Pick<KomoControlSafeMatchGameplay, "clockSeconds" | "clockRunning" | "clockStartedAtMs">, nowMs: number): number {
    if (!gameplay.clockRunning || gameplay.clockStartedAtMs === null) return gameplay.clockSeconds;
    return Math.max(0, gameplay.clockSeconds - Math.floor(Math.max(0, nowMs - gameplay.clockStartedAtMs) / 1000));
}

export function timeoutGameplayIntents(team: Side, scorerEventId: string, clockRunning: boolean): KomoControlGameplayIntent[] {
    const timeout: KomoControlGameplayIntent = { kind: "timeout", team, scorerEventId, scorerEventTerminal: { reason: "NATURAL" } };
    return clockRunning ? [timeout, { kind: "clock-stop" }] : [timeout];
}

export function timeoutCountdownSeconds(startedAtMs: number, nowMs: number): number {
    return Math.max(0, Math.ceil((60_000 - Math.max(0, nowMs - startedAtMs)) / 1000));
}

export function latestOpenTimeout(history: KomoControlGameplayHistoryItem[]): KomoControlGameplayHistoryItem | null {
    const latestClockStartSequence = history.reduce((latest, item) => item.type === "CLOCK_START" ? Math.max(latest, item.sequence) : latest, 0);
    return history.reduce<KomoControlGameplayHistoryItem | null>((latest, item) => item.type === "TIMEOUT" && item.team && item.scorerEventId && item.sequence > latestClockStartSequence && (!latest || item.sequence > latest.sequence) ? item : latest, null);
}

export function periodText(period: KomoControlSafeMatchGameplay["period"]): string {
    return period.kind === "REGULATION" ? `${period.index}η ΠΕΡΙΟΔΟΣ` : `OT${period.index}`;
}

export function periodScoreLabel(period: KomoControlGameplayPeriodScore["period"]): string {
    return period.kind === "REGULATION" ? `Q${period.index}` : `OT${period.index}`;
}

export function periodScoreValue(score: KomoControlGameplayPeriodScore): string {
    return `${score.home}-${score.away}`;
}

export function presentationTeams(gameplay: KomoControlSafeMatchGameplay): [KomoControlSafeGameplayTeam, KomoControlSafeGameplayTeam] {
    const left = gameplay.teams.find((team) => team.presentationSide === "LEFT");
    const right = gameplay.teams.find((team) => team.presentationSide === "RIGHT");
    if (!left || !right) return gameplay.teams;
    return [left, right];
}

export function nextLivePeriod(gameplay: Pick<KomoControlSafeMatchGameplay, "period" | "score" | "rules">): KomoControlSafeMatchGameplay["period"] | null {
    if (gameplay.period.kind === "REGULATION" && gameplay.period.index < gameplay.rules.regulationPeriods) return { kind: "REGULATION", index: gameplay.period.index + 1 };
    const tied = gameplay.score.home === gameplay.score.away;
    if (!tied || gameplay.rules.resultPolicy === "ALLOW_TIE") return null;
    return gameplay.period.kind === "REGULATION" ? { kind: "OVERTIME", index: 1 } : { kind: "OVERTIME", index: gameplay.period.index + 1 };
}

export function teamReboundIntent(team: Side, offensive: boolean): KomoControlGameplayIntent {
    return { kind: "rebound", team, offensive, teamRebound: true };
}

export function liveKeyboardCommand(key: string, formTarget: boolean, clockEditing: boolean): "clock" | "complete" | "cancel" | null {
    if (key === "Escape") return "cancel";
    if (key === "Enter" && !formTarget) return "complete";
    if (key === " " && !formTarget && !clockEditing) return "clock";
    return null;
}

export function canCompleteLiveFlow(action: string, step: string): boolean {
    return (action === "SHOOT" && (step === "assist-choice" || step === "assist")) || (action === "REBOUND" && (step === "block-choice" || step === "rebound-team" || step === "rebound-player"));
}

export function foulIndicator(fouls: KomoControlSafeGameplayPlayer["fouls"]): string {
    const parts = [`${fouls.total}F`];
    if (fouls.category1TechnicalCount) parts.push(`T1×${fouls.category1TechnicalCount}`);
    if (fouls.category2TechnicalCount) parts.push(`T2×${fouls.category2TechnicalCount}`);
    if (fouls.disruptiveCount) parts.push(`D×${fouls.disruptiveCount}`);
    if (fouls.flagrantCount) parts.push(`FL×${fouls.flagrantCount}`);
    if (fouls.directDisqualification || fouls.status === "DISQUALIFIED") parts.push("DQ");
    else if (fouls.status === "EXCLUDED") parts.push("ΕΚΤΟΣ");
    return parts.join(" · ");
}

export function gdAccumulationCount(fouls: KomoControlSafeGameplayPlayer["fouls"]): number {
    return Math.min(2, fouls.category1TechnicalCount + fouls.flagrantCount);
}

function opposite(side: Side): Side { return side === "HOME" ? "AWAY" : "HOME"; }
function teamColorStyle(team: KomoControlSafeGameplayTeam): CSSProperties { return { "--live-team": team.gameColor ?? "#64748b" } as CSSProperties; }
function onCourt(team: KomoControlSafeGameplayTeam): KomoControlSafeGameplayPlayer[] { return team.players.filter((player) => player.onCourt); }
function eligibleBench(team: KomoControlSafeGameplayTeam): KomoControlSafeGameplayPlayer[] { return team.players.filter((player) => !player.onCourt && player.fouls.status === "ELIGIBLE"); }
function playerById(gameplay: KomoControlSafeMatchGameplay, playerId: string | undefined): KomoControlSafeGameplayPlayer | undefined { return gameplay.teams.flatMap((team) => team.players).find((player) => player.playerId === playerId); }
function eventTeamName(gameplay: KomoControlSafeMatchGameplay, side: Side | undefined): string { return gameplay.teams.find((team) => team.side === side)?.teamName ?? side ?? ""; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function foulOffenderLabel(item: KomoControlGameplayHistoryItem, gameplay: KomoControlSafeMatchGameplay): string | undefined {
    if (item.intent?.kind !== "foul") return undefined;
    const offender = item.intent.offender;
    if (!isRecord(offender)) return undefined;
    if (offender.kind === "PLAYER" && typeof offender.playerId === "string") {
        const player = playerById(gameplay, offender.playerId);
        return player ? `#${player.shirtNumber} ${player.displayName}` : undefined;
    }
    if (offender.kind !== "BENCH") return undefined;
    const currentTeam = gameplay.teams.find((team) => team.side === item.team);
    const person = typeof offender.personId === "string" ? currentTeam?.bench.find((candidate) => candidate.personId === offender.personId) : undefined;
    const role = offender.role === "HEAD_COACH" ? "COACH" : "BENCH";
    return `${role} · ${person?.displayName.trim() || currentTeam?.teamName || item.team || ""}`;
}

export interface LiveStatusPlayerStatistics {
    points: number;
    twoPoints: string;
    threePoints: string;
    freeThrows: string;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    efficiency: number;
}

export function liveStatusPlayerStatistics(statistics: Record<string, number>): LiveStatusPlayerStatistics {
    const value = (key: string) => statistics[key] ?? 0;
    const points = value("points");
    const twoPointMade = value("twoPointMade");
    const twoPointAttempts = value("twoPointAttempts");
    const threePointMade = value("threePointMade");
    const threePointAttempts = value("threePointAttempts");
    const freeThrowMade = value("freeThrowMade");
    const freeThrowAttempts = value("freeThrowAttempts");
    const rebounds = value("offensiveRebounds") + value("defensiveRebounds");
    const assists = value("assists");
    const steals = value("steals");
    const blocks = value("blocks");
    const turnovers = value("turnovers");
    const efficiency = points + rebounds + assists + steals + blocks - turnovers
        - (freeThrowAttempts - freeThrowMade)
        - (twoPointAttempts - twoPointMade)
        - (threePointAttempts - threePointMade);
    return {
        points,
        twoPoints: `${twoPointMade}/${twoPointAttempts}`,
        threePoints: `${threePointMade}/${threePointAttempts}`,
        freeThrows: `${freeThrowMade}/${freeThrowAttempts}`,
        rebounds,
        assists,
        steals,
        blocks,
        turnovers,
        efficiency,
    };
}

export function gameplayEventTeamPresentation(item: KomoControlGameplayHistoryItem, gameplay: KomoControlSafeMatchGameplay): { teamName: string; gameColor: string | null } | null {
    const hasFactualPerson = Boolean(playerById(gameplay, item.playerId) || foulOffenderLabel(item, gameplay));
    if (!hasFactualPerson || !item.team) return null;
    const team = gameplay.teams.find((candidate) => candidate.side === item.team);
    return team ? { teamName: team.teamName, gameColor: team.gameColor } : null;
}

export function gameplayEventLabel(item: KomoControlGameplayHistoryItem, gameplay: KomoControlSafeMatchGameplay): string {
    const player = playerById(gameplay, item.playerId);
    const actor = foulOffenderLabel(item, gameplay) ?? (player ? `#${player.shirtNumber} ${player.displayName}` : eventTeamName(gameplay, item.team));
    const labels: Record<string, string> = {
        MATCH_START: "Έναρξη αγώνα", MATCH_END: "Λήξη αγώνα", TWO_POINT: "2PT εύστοχο", TWO_POINT_MISSED: "2PT άστοχο", THREE_POINT: "3PT εύστοχο", THREE_POINT_MISSED: "3PT άστοχο", FREE_THROW: "Ελεύθερη βολή", PERSONAL_FOUL: "Προσωπικό φάουλ", TECHNICAL_FOUL: "Τεχνική ποινή", DISRUPTIVE_FOUL: "Disruptive foul", FLAGRANT_FOUL: "Flagrant foul", DISQUALIFYING_FOUL: "Αποβολή", TURNOVER: "Λάθος", SUBSTITUTION: "Αλλαγή", TIMEOUT: "Time out", REBOUND: "Ριμπάουντ", STEAL: "Κλέψιμο", BLOCK: "Τάπα", JUMP_BALL: "Jump ball", ALTERNATING_POSSESSION: "Εναλλασσόμενη κατοχή", CLOCK_START: "Ρολόι start", CLOCK_STOP: "Ρολόι stop", CLOCK_SET: "Διόρθωση ρολογιού", PERIOD_START: "Έναρξη περιόδου", PERIOD_END: "Λήξη περιόδου", LINEUP_SET: "Πεντάδα", ROSTER_PLAYER_ADDED: "Προσθήκη παίκτη",
    };
    const baseEventLabel = item.type === "TECHNICAL_FOUL" && item.intent?.category === "CATEGORY_1" ? "Τεχνική ποινή GD" : labels[item.type] ?? item.type;
    const eventLabel = `${baseEventLabel}${item.isGoalFoul === true && (item.type === "TWO_POINT" || item.type === "THREE_POINT") ? " GOAL FOUL" : ""}`;
    return `${eventLabel}${actor ? ` · ${actor}` : ""}`;
}

export function isScorerFacingGameplayEvent(item: Pick<KomoControlGameplayHistoryItem, "type">): boolean {
    return item.type !== "PENALTY_ADMINISTRATION_ENDED";
}

const GAME_LOG_GROUP_SHADE_COUNT = 6;
export function gameLogGroupClass(scorerEventGroupOrdinal: number): string {
    return `live-log-group-${scorerEventGroupOrdinal % GAME_LOG_GROUP_SHADE_COUNT}`;
}

interface FlowTrailEntry {
    step: string;
    label: string;
    value: string;
    frozen?: true;
    playerId?: string;
    teamSide?: Side;
    sourceEventId?: string;
    correctionKind?: KomoControlHistoricalEditTargetKind;
}

interface Flow {
    action: ActionId | "REBOUND" | "PENALTY";
    step: string;
    scorerEventId?: string;
    side?: Side;
    points?: 2 | 3;
    playerId?: string;
    made?: boolean;
    assistPlayerId?: string;
    noAssist?: boolean;
    stoppageId?: string;
    foulType?: FoulType;
    category?: "CATEGORY_1" | "CATEGORY_2";
    technicalStaffSource?: "COACH" | "BENCH";
    context?: "NON_SHOOTING" | "SHOOTING" | "NON_CONTACT";
    offender?: { kind: "PLAYER"; playerId: string } | { kind: "BENCH"; personId: string; role: string };
    fouledPlayerId?: string;
    committedEventId?: string;
    sourceFoulEventId?: string;
    lastFactEventId?: string;
    lastFactIntent?: KomoControlGameplayIntent;
    replacementShooterRequired?: boolean;
    baseIntent?: KomoControlGameplayIntent;
    shotSide?: Side;
    blockerId?: string;
    stealerId?: string;
    receiverId?: string;
    trail?: FlowTrailEntry[];
}

interface SubsTeamDraft {
    initialOnCourtIds: string[];
    selectedOutIds: string[];
    selectedInIds: string[];
    rebuildMode: boolean;
    rebuiltFiveIds: string[];
}

interface SubsModalState {
  drafts: Record<Side, SubsTeamDraft>;
  scorerEventId: string;
  error: string | null;
  mode: "ORDINARY" | "MANDATORY";
  mandatoryOutIds: Record<Side, string[]>;
}

function createSubsTeamDraft(team: KomoControlSafeGameplayTeam): SubsTeamDraft {
    return { initialOnCourtIds: onCourt(team).map((player) => player.playerId), selectedOutIds: [], selectedInIds: [], rebuildMode: false, rebuiltFiveIds: [] };
}

interface LiveControlProps {
    gameplay: KomoControlSafeMatchGameplay;
    authState: KomoControlAuthState;
    footer: ReactNode;
    onGameplayChange(gameplay: KomoControlSafeMatchGameplay, state: KomoControlAuthState): void;
    onAuthStateChange(state: KomoControlAuthState): void;
    onBack(): void;
    onOpenConfiguration(): void;
    onLogout(): Promise<void> | void;
}

export function liveSyncFooterPresentation(gameplay: KomoControlSafeMatchGameplay, authState: KomoControlAuthState): { label: string; className: string; canReconnect: boolean; detail: string } {
    const detailParts = [`REV ${gameplay.eventHistoryRevision}`, `ACK ${gameplay.sync.acknowledgedRevision}`];
    if (gameplay.sync.lastAttemptAtUtc) detailParts.push(`Προσπάθεια ${new Date(gameplay.sync.lastAttemptAtUtc).toLocaleString("el-GR")}`);
    if (gameplay.sync.lastSuccessAtUtc) detailParts.push(`Επιτυχία ${new Date(gameplay.sync.lastSuccessAtUtc).toLocaleString("el-GR")}`);
    const safeReasons: Record<string, string> = { SYNC_UNAVAILABLE: "Ο server ή το δίκτυο δεν είναι διαθέσιμο.", SYNC_AUTH: "Απαιτείται νέα σύνδεση scorer.", SYNC_STALE: "Η απομακρυσμένη έκδοση είναι νεότερη.", SYNC_INTEGRITY_CONFLICT: "Υπάρχει σύγκρουση ακεραιότητας.", SYNC_RUN_CONFLICT: "Υπάρχει σύγκρουση Run." };
    if (gameplay.sync.lastErrorCode && safeReasons[gameplay.sync.lastErrorCode]) detailParts.push(safeReasons[gameplay.sync.lastErrorCode]);
    const detail = detailParts.join(" · ");
    if (gameplay.sync.status === "conflict") return { label: "LOCAL SAVED · SYNC CONFLICT", className: "conflict", canReconnect: false, detail };
    if (authState.kind === "live-continuity") return { label: "LOCAL SAVED · SESSION EXPIRED", className: "retry-needed", canReconnect: true, detail };
    if (authState.kind === "authenticated" && authState.connection === "offline") return { label: "LOCAL SAVED · RETRY NEEDED", className: "retry-needed", canReconnect: true, detail };
    if (gameplay.sync.status === "synced") return { label: "LOCAL SAVED · SYNCED", className: "synced", canReconnect: false, detail };
    if (gameplay.sync.status === "retry-needed") return { label: "LOCAL SAVED · RETRY NEEDED", className: "retry-needed", canReconnect: false, detail };
    return { label: "LOCAL SAVED · SYNC PENDING", className: "pending", canReconnect: false, detail };
}

export type FinalSubmissionPhase = "sending" | "success" | "failure" | "auth-required" | "conflict";

export function finalSubmissionPhase(
    gameplay: KomoControlSafeMatchGameplay,
    authState: KomoControlAuthState,
    retryInFlight = false,
): FinalSubmissionPhase | null {
    if (gameplay.lifecycle !== "finalized") return null;
    if (gameplay.sync.status === "conflict") return "conflict";
    if (gameplay.sync.status === "synced") return "success";
    if (authState.kind === "live-continuity" || (authState.kind === "authenticated" && authState.connection === "offline")) return "auth-required";
    if (retryInFlight || gameplay.sync.status === "pending") return "sending";
    return "failure";
}

function ChoiceGrid({ children, compact = false, stacked = false }: { children: ReactNode; compact?: boolean; stacked?: boolean }) { return <div className={`live-choice-grid${compact ? " is-compact" : ""}${stacked ? " is-stacked" : ""}`}>{children}</div>; }
function Choice({ children, onClick, active = false, disabled = false }: { children: ReactNode; onClick(): void; active?: boolean; disabled?: boolean }) { return <button type="button" className={`live-choice${active ? " is-active" : ""}`} disabled={disabled} onClick={onClick}>{children}</button>; }

interface HistoricalEditSession {
    mode: "HISTORY" | "CURRENT";
    resumeFlow: Flow | null;
    scorerEventGroupId: string;
    expectedHistoryRevision: number;
    originalGroup: KomoControlScorerEventGroup;
    normalizedGroup: KomoControlScorerEventGroup;
    context: KomoControlScorerEventEditContext;
    draftEvents: KomoControlScorerEventMutationPreview["draftEvents"];
    preview: HistoricalScorerEventPreview;
    activeTargetId: string | null;
    dirty: boolean;
    error: string | null;
}

interface LocalCurrentCorrection {
    resumeFlow: Flow;
    targetKind: KomoControlHistoricalEditTargetKind;
    currentPlayerId: string;
}

export function historicalCorrectionIsNoop(
    target: KomoControlHistoricalEditTarget | undefined,
    action: KomoControlScorerEventDraftAction,
): boolean {
    if (
        action.kind !== "CORRECT_PLAYER"
        && action.kind !== "CORRECT_SHOT_RESULT"
        && action.kind !== "CORRECT_FREE_THROW_RESULT"
    ) return false;
    if (!target || action.targetId !== target.targetId) return false;
    if (action.kind === "CORRECT_PLAYER") return target.currentPlayerId === action.playerId;
    if (action.kind === "CORRECT_SHOT_RESULT" || action.kind === "CORRECT_FREE_THROW_RESULT") {
        return target.currentValue === (action.made ? "MADE" : "MISS");
    }
    return false;
}

export function LiveControl({ gameplay, authState, footer, onGameplayChange, onAuthStateChange, onBack, onOpenConfiguration, onLogout }: LiveControlProps) {
    const bridge = window.komoControl;
    const [flow, setFlow] = useState<Flow | null>(null);
    const [subsModal, setSubsModal] = useState<SubsModalState | null>(null);
    const [resumableFlow, setResumableFlow] = useState<KomoControlResumableLiveFlow | null>(null);
    const [endingPenaltyId, setEndingPenaltyId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reconnectOpen, setReconnectOpen] = useState(false);
    const [reconnectUsername, setReconnectUsername] = useState("");
    const [reconnectPassword, setReconnectPassword] = useState("");
    const [reconnectBusy, setReconnectBusy] = useState(false);
    const [reconnectError, setReconnectError] = useState<string | null>(null);
    const [finalSubmissionBusy, setFinalSubmissionBusy] = useState(false);
    const [finalSubmissionError, setFinalSubmissionError] = useState<string | null>(null);
    const [history, setHistory] = useState<KomoControlGameplayHistoryItem[]>([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [historyCursor, setHistoryCursor] = useState<number | null>(null);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [periodFilter, setPeriodFilter] = useState<KomoControlSafeMatchGameplay["period"] | null>(null);
    const [selectedLogEvent, setSelectedLogEvent] = useState<KomoControlGameplayHistoryItem | null>(null);
    const [correctionTarget, setCorrectionTarget] = useState<KomoControlGameplayHistoryItem | null>(null);
    const [historyPreview, setHistoryPreview] = useState<HistoricalScorerEventPreview | null>(null);
    const [historyPreviewContext, setHistoryPreviewContext] = useState<KomoControlScorerEventEditContext | null>(null);
    const [historyEdit, setHistoryEdit] = useState<HistoricalEditSession | null>(null);
    const [localCurrentCorrection, setLocalCurrentCorrection] = useState<LocalCurrentCorrection | null>(null);
    const [historyDeleteConfirm, setHistoryDeleteConfirm] = useState(false);
    const [historyPreviewLoading, setHistoryPreviewLoading] = useState(false);
    const [statusTeam, setStatusTeam] = useState<Side | null>(null);
    const [clockEditing, setClockEditing] = useState(false);
    const [clockInput, setClockInput] = useState(formatLiveClock(gameplay.clockSeconds));
    const [clockEditError, setClockEditError] = useState<string | null>(null);
    const [clockEditSubmitting, setClockEditSubmitting] = useState(false);
    const clockEditSubmittingRef = useRef(false);
    const [finalizationEntry, setFinalizationEntry] = useState<"CHOICE" | "REPORT" | null>(null);
    const [incidentReportDraft, setIncidentReportDraft] = useState("");
    const [finalizationEntryError, setFinalizationEntryError] = useState<string | null>(null);
    const finalizationSubmittingRef = useRef(false);
    const [nowMs, setNowMs] = useState(Date.now());
    const [activeTimeoutCountdown, setActiveTimeoutCountdown] = useState<{ scorerEventGroupId: string; scorerEventId: string; team: Side; startedAtMs: number } | null>(null);
    const autoStopRef = useRef(false);
    const timeoutRecoveryRunRef = useRef<string | null>(null);

    const [leftTeam, rightTeam] = presentationTeams(gameplay);
    const displayedClock = liveClockSeconds(gameplay, nowMs);
    const maximumClockSeconds = liveClockCorrectionMaximumSeconds(gameplay);
    const syncFooter = liveSyncFooterPresentation(gameplay, authState);
    const finalSubmission = finalSubmissionPhase(gameplay, authState, finalSubmissionBusy);
    const team = useCallback((side: Side) => gameplay.teams.find((candidate) => candidate.side === side)!, [gameplay]);
    const mandatoryReplacementIds: Record<Side, string[]> = {
        HOME: team("HOME").players.filter((player) => player.onCourt && player.fouls.status !== "ELIGIBLE").map((player) => player.playerId),
        AWAY: team("AWAY").players.filter((player) => player.onCourt && player.fouls.status !== "ELIGIBLE").map((player) => player.playerId),
    };
    const mandatoryReplacementKey = `${mandatoryReplacementIds.HOME.join(",")}|${mandatoryReplacementIds.AWAY.join(",")}`;

    const loadHistory = useCallback(async (append = false, beforeSequence: number | null = null) => {
        if (!bridge) return;
        const result = await bridge.getGameplayHistory(gameplay.runId, { limit: 28, beforeSequence, period: periodFilter });
        onAuthStateChange(result.state);
        if (!result.ok) { setError(`Το Game Log δεν είναι διαθέσιμο (${result.errorCode}).`); return; }
        setHistory((current) => append ? [...current, ...result.history.items] : result.history.items);
        if (!append) setHistoryLoaded(true);
        setHistoryCursor(result.history.nextBeforeSequence);
        setHistoryTotal(result.history.total);
    }, [bridge, gameplay.runId, onAuthStateChange, periodFilter]);

    const openHistoryPreview = useCallback(async (item: KomoControlGameplayHistoryItem) => {
        if (flow || subsModal || busy || correctionTarget || selectedLogEvent || historyPreview || historyEdit || historyPreviewLoading || resumableFlow) {
            setError("Ολοκληρώστε πρώτα την τρέχουσα ενέργεια.");
            return;
        }
        if (!item.scorerEventGroupSafeForReconstruction) {
            setError("Η καταχώριση δεν μπορεί να ανακατασκευαστεί με ασφάλεια.");
            return;
        }
        if (!bridge) return;
        setHistoryPreviewLoading(true);
        try {
            const result = await bridge.getScorerEventGroup(gameplay.runId, item.scorerEventGroupId);
            onAuthStateChange(result.state);
            if (!result.ok) { setError(`Η προβολή συμβάντος δεν είναι διαθέσιμη (${result.errorCode}).`); return; }
            if (!result.group?.safeForReconstruction) { setError("Η καταχώριση δεν μπορεί να ανακατασκευαστεί με ασφάλεια."); return; }
            const preview = reconstructScorerEventGroup(result.group, gameplay);
            if (!preview) { setError("Η καταχώριση δεν μπορεί να ανακατασκευαστεί με ασφάλεια."); return; }
            const contextResult = await bridge.getScorerEventEditContext(gameplay.runId, item.scorerEventGroupId);
            onAuthStateChange(contextResult.state);
            if (!contextResult.ok) { setError(`Η επεξεργασία συμβάντος δεν είναι διαθέσιμη (${contextResult.errorCode}).`); return; }
            const context = contextResult.context;
            if (context?.editCapabilities.safeForEdit) {
                const editPreview = reconstructHistoricalScorerEventEdit(context, gameplay);
                const draftEvents = result.group.items.map((groupItem) => ({ draftId: groupItem.eventId, eventId: groupItem.eventId, intent: groupItem.intent })).filter((draft): draft is { draftId: string; eventId: string; intent: KomoControlGameplayIntent } => draft.intent !== null);
                if (!editPreview || draftEvents.length !== result.group.items.length) { setError("Η καταχώριση δεν μπορεί να επεξεργαστεί με ασφάλεια."); return; }
                setHistoryEdit({ mode: "HISTORY", resumeFlow: null, scorerEventGroupId: item.scorerEventGroupId, expectedHistoryRevision: context.expectedHistoryRevision, originalGroup: result.group, normalizedGroup: result.group, context, draftEvents, preview: editPreview, activeTargetId: null, dirty: false, error: null });
            } else {
                setHistoryPreview(preview);
                setHistoryPreviewContext(context);
            }
            setHistoryDeleteConfirm(false);
            setError(null);
        } catch { setError("Η ιστορική προβολή δεν ολοκληρώθηκε."); }
        finally { setHistoryPreviewLoading(false); }
    }, [bridge, busy, correctionTarget, flow, gameplay, historyEdit, historyPreview, historyPreviewLoading, onAuthStateChange, resumableFlow, selectedLogEvent, subsModal]);

    useEffect(() => { void loadHistory(false); }, [loadHistory, gameplay.eventHistoryRevision]);
    useEffect(() => {
        setActiveTimeoutCountdown(null);
        setHistoryLoaded(false);
        timeoutRecoveryRunRef.current = null;
    }, [gameplay.runId]);
    useEffect(() => {
        if (!historyLoaded || activeTimeoutCountdown || timeoutRecoveryRunRef.current === gameplay.runId) return;
        timeoutRecoveryRunRef.current = gameplay.runId;
        const recovered = latestOpenTimeout(history);
        if (!recovered?.team || !recovered.scorerEventId) return;
        const startedAtMs = Date.now();
        setNowMs(startedAtMs);
        setActiveTimeoutCountdown({ scorerEventGroupId: recovered.scorerEventGroupId, scorerEventId: recovered.scorerEventId, team: recovered.team, startedAtMs });
    }, [activeTimeoutCountdown, gameplay.runId, history, historyLoaded]);
    useEffect(() => {
        if (!bridge) return;
        return bridge.onGameplaySyncStateChanged((runId) => {
            if (runId !== gameplay.runId) return;
            void bridge.recoverMatchGameplay(runId).then((result) => {
                onAuthStateChange(result.state);
                if (result.ok) onGameplayChange(result.gameplay, result.state);
            }).catch(() => undefined);
        });
    }, [bridge, gameplay.runId, onAuthStateChange, onGameplayChange]);
    useEffect(() => {
        if (!bridge) return;
        void bridge.getResumableLiveFlow(gameplay.runId).then((result) => {
            onAuthStateChange(result.state);
            if (result.ok) setResumableFlow(result.flow);
        });
    }, [bridge, gameplay.eventHistoryRevision, gameplay.runId, onAuthStateChange]);
    useEffect(() => {
        if (!gameplay.clockRunning && !activeTimeoutCountdown) return;
        const timer = window.setInterval(() => setNowMs(Date.now()), 250);
        return () => window.clearInterval(timer);
    }, [activeTimeoutCountdown, gameplay.clockRunning]);

    const applyResult = useCallback((result: KomoControlMatchGameplayResult): KomoControlSafeMatchGameplay | null => {
        onAuthStateChange(result.state);
        if (!result.ok) {
            const messages: Record<string, string> = { GAMEPLAY_EVENT_REJECTED: "Η καταχώριση δεν είναι συμβατή με την τρέχουσα αγωνιστική κατάσταση.", GAMEPLAY_CONFLICT: "Η αγωνιστική κατάσταση άλλαξε. Ανακτήστε ξανά το Run.", GAMEPLAY_CORRUPTED: "Εντοπίστηκε πραγματικό πρόβλημα ακεραιότητας στην τοπική αγωνιστική κατάσταση.", SESSION_INVALID: "Η εξουσιοδότηση αυτού του Run δεν είναι διαθέσιμη." };
            setError(messages[result.errorCode] ?? `Η ενέργεια απορρίφθηκε με ασφάλεια (${result.errorCode}).`);
            return null;
        }
        setError(null);
        onGameplayChange(result.gameplay, result.state);
        return result.gameplay;
    }, [onAuthStateChange, onGameplayChange]);

    const openReconnect = useCallback(() => {
        setReconnectUsername(authState.kind === "authenticated" ? authState.context.username : "");
        setReconnectPassword(""); setReconnectError(null); setReconnectOpen(true);
    }, [authState]);

    const reconnect = useCallback(async () => {
        if (!bridge || reconnectBusy || !reconnectUsername.trim() || !reconnectPassword) return;
        setReconnectBusy(true); setReconnectError(null);
        const password = reconnectPassword; setReconnectPassword("");
        try {
            const result = await bridge.reconnectGameplaySync(gameplay.runId, { username: reconnectUsername.trim(), password });
            onAuthStateChange(result.state);
            if (!result.ok) {
                const messages: Record<string, string> = { AUTH_INVALID: "Λανθασμένο όνομα χρήστη ή κωδικός.", SCORER_DISABLED: "Ο λογαριασμός scorer δεν είναι ενεργός.", SESSION_INVALID: "Ο λογαριασμός δεν αντιστοιχεί σε αυτό το ενεργό Run.", NETWORK_UNAVAILABLE: "Ο server ή το δίκτυο δεν είναι διαθέσιμο.", MALFORMED_RESPONSE: "Ο server επέστρεψε μη έγκυρη απάντηση.", LOCAL_SESSION_ERROR: "Η ασφαλής τοπική σύνδεση δεν ενημερώθηκε." };
                setReconnectError(messages[result.errorCode] ?? "Η επανασύνδεση δεν ολοκληρώθηκε.");
                return;
            }
            onGameplayChange(result.gameplay, result.state); setReconnectOpen(false); setReconnectError(null);
        } catch { setReconnectError("Ο server ή το δίκτυο δεν είναι διαθέσιμο."); }
        finally { setReconnectBusy(false); }
    }, [bridge, gameplay.runId, onAuthStateChange, onGameplayChange, reconnectBusy, reconnectPassword, reconnectUsername]);

    const retryFinalizedSync = useCallback(async () => {
        if (!bridge || finalSubmissionBusy || gameplay.lifecycle !== "finalized" || gameplay.sync.status === "conflict") return;
        setFinalSubmissionBusy(true); setFinalSubmissionError(null);
        try {
            const result = await bridge.retryGameplaySync(gameplay.runId);
            onAuthStateChange(result.state);
            if (!result.ok) {
                const messages: Record<string, string> = { SESSION_INVALID: "Η συνεδρία scorer έχει λήξει. Επανασυνδεθείτε για να συνεχιστεί η αποστολή.", SYNC_INTEGRITY_CONFLICT: "Εντοπίστηκε σύγκρουση ακεραιότητας. Δεν έγινε νέα αποστολή.", SYNC_RUN_CONFLICT: "Το απομακρυσμένο Run βρίσκεται σε σύγκρουση. Δεν έγινε νέα αποστολή.", SYNC_UNAVAILABLE: "Ο server ή το δίκτυο δεν είναι διαθέσιμο." };
                setFinalSubmissionError(messages[result.errorCode] ?? `Η νέα προσπάθεια δεν ολοκληρώθηκε (${result.errorCode}).`);
                return;
            }
            onGameplayChange(result.gameplay, result.state);
        } catch { setFinalSubmissionError("Ο server ή το δίκτυο δεν είναι διαθέσιμο."); }
        finally { setFinalSubmissionBusy(false); }
    }, [bridge, finalSubmissionBusy, gameplay.lifecycle, gameplay.runId, gameplay.sync.status, onAuthStateChange, onGameplayChange]);

    const closeHistoricalWorkspace = useCallback(() => {
        setHistoryPreview(null); setHistoryPreviewContext(null); setHistoryEdit(null); setHistoryDeleteConfirm(false);
    }, []);

    const openCurrentCorrection = useCallback(async (eventId: string, kind: KomoControlHistoricalEditTargetKind) => {
        if (!bridge || !flow?.scorerEventId || busy || historyEdit) return;
        const scorerEventGroupId = `explicit:${flow.scorerEventId}`; setBusy(true);
        try {
            const result = await bridge.getScorerEventEditContext(gameplay.runId, scorerEventGroupId, { mode: "CURRENT_OPEN", scorerEventId: flow.scorerEventId }); onAuthStateChange(result.state);
            const context = result.ok ? result.context : null; const target = context?.editCapabilities.targets.find((candidate) => candidate.eventId === eventId && candidate.kind === kind && candidate.editable);
            if (!context || !target) { setError("Η factual διόρθωση δεν είναι διαθέσιμη σε αυτό το στάδιο."); return; }
            const preview = reconstructHistoricalScorerEventEdit(context, gameplay); const draftEvents = context.group.items.map((item) => ({ draftId: item.eventId, eventId: item.eventId, intent: item.intent })).filter((draft): draft is { draftId: string; eventId: string; intent: KomoControlGameplayIntent } => draft.intent !== null);
            if (!preview || draftEvents.length !== context.group.items.length) { setError("Το τρέχον συμβάν δεν ανακατασκευάζεται με ασφάλεια."); return; }
            setHistoryEdit({ mode: "CURRENT", resumeFlow: flow, scorerEventGroupId, expectedHistoryRevision: context.expectedHistoryRevision, originalGroup: context.group, normalizedGroup: context.group, context, draftEvents, preview, activeTargetId: target.targetId, dirty: false, error: null }); setError(null);
        } finally { setBusy(false); }
    }, [bridge, busy, flow, gameplay, historyEdit, onAuthStateChange]);

    const previewHistoricalAction = useCallback(async (action: KomoControlScorerEventDraftAction) => {
        if (!bridge || !historyEdit || busy) return;
        const activeTarget = historyEdit.context.editCapabilities.targets.find((target) => target.targetId === historyEdit.activeTargetId);
        if (historicalCorrectionIsNoop(activeTarget, action)) {
            if (historyEdit.mode === "CURRENT") { setFlow(historyEdit.resumeFlow); closeHistoricalWorkspace(); }
            else setHistoryEdit((current) => current ? { ...current, activeTargetId: null, error: null } : current);
            return;
        }
        const events = historyEdit.draftEvents.filter((event): event is typeof event & { intent: KomoControlGameplayIntent } => event.intent !== null);
        if (events.length !== historyEdit.draftEvents.length) { setHistoryEdit((current) => current ? { ...current, error: "Το ιστορικό draft δεν είναι πλήρες." } : current); return; }
        const currentMode: KomoControlScorerEventEditMode | undefined = historyEdit.mode === "CURRENT" && historyEdit.resumeFlow?.scorerEventId && !historyEdit.context.group.scorerEventTerminal ? { mode: "CURRENT_OPEN", scorerEventId: historyEdit.resumeFlow.scorerEventId } : undefined;
        setBusy(true);
        try {
            const result = await bridge.previewScorerEventMutation(gameplay.runId, { scorerEventGroupId: historyEdit.scorerEventGroupId, expectedHistoryRevision: historyEdit.expectedHistoryRevision, ...(currentMode ? { mode: currentMode } : {}), events, action });
            onAuthStateChange(result.state);
            if (!result.ok) { setHistoryEdit((current) => current ? { ...current, error: `Η προεπισκόπηση απορρίφθηκε (${result.errorCode}).` } : current); return; }
            const reconstructed = reconstructHistoricalScorerEventEdit(result.preview.editContext, gameplay);
            if (!reconstructed) { setHistoryEdit((current) => current ? { ...current, error: "Η νέα ιστορική κατάσταση δεν ανακατασκευάζεται με ασφάλεια." } : current); return; }
            if (historyEdit.mode === "CURRENT") {
                const mutation = await bridge.mutateScorerEventGroup(gameplay.runId, { kind: "REPLACE_GROUP", scorerEventGroupId: historyEdit.scorerEventGroupId, expectedHistoryRevision: historyEdit.expectedHistoryRevision, ...(currentMode ? { mode: currentMode } : {}), events: result.preview.draftEvents.flatMap((event) => event.intent ? [{ ...(event.eventId ? { eventId: event.eventId } : {}), intent: event.intent }] : []) });
                const next = applyResult(mutation); if (!next) { setHistoryEdit((current) => current ? { ...current, error: "Η atomic factual διόρθωση δεν ολοκληρώθηκε." } : current); return; }
                const refreshMode = result.preview.normalizedGroup.scorerEventTerminal ? undefined : currentMode;
                const refreshed = await bridge.getScorerEventEditContext(gameplay.runId, historyEdit.scorerEventGroupId, refreshMode); onAuthStateChange(refreshed.state); const context = refreshed.ok ? refreshed.context : null;
                if (!context) { closeHistoricalWorkspace(); setFlow(null); await loadHistory(false); return; }
                const currentPreview = reconstructHistoricalScorerEventEdit(context, next); const currentDraft = context.group.items.map((item) => ({ draftId: item.eventId, eventId: item.eventId, intent: item.intent })).filter((draft): draft is { draftId: string; eventId: string; intent: KomoControlGameplayIntent } => draft.intent !== null);
                if (!currentPreview || currentDraft.length !== context.group.items.length) { closeHistoricalWorkspace(); setFlow(null); await loadHistory(false); return; }
                if (!context.continuationPlan) { closeHistoricalWorkspace(); setFlow(null); await loadHistory(false); return; }
                setHistoryEdit((current) => current ? { ...current, expectedHistoryRevision: context.expectedHistoryRevision, normalizedGroup: context.group, context, draftEvents: currentDraft, preview: currentPreview, activeTargetId: null, dirty: false, error: null } : current); await loadHistory(false); return;
            }
            setHistoryEdit((current) => current ? { ...current, normalizedGroup: result.preview.normalizedGroup, context: result.preview.editContext, draftEvents: result.preview.draftEvents, preview: reconstructed, activeTargetId: null, dirty: true, error: null } : current);
        } catch { setHistoryEdit((current) => current ? { ...current, error: "Η ιστορική προεπισκόπηση δεν ολοκληρώθηκε." } : current); }
        finally { setBusy(false); }
    }, [applyResult, bridge, busy, closeHistoricalWorkspace, gameplay, historyEdit, loadHistory, onAuthStateChange]);

    const saveHistoricalEdit = useCallback(async () => {
        if (!bridge || !historyEdit || busy || historyEdit.activeTargetId || historyEdit.mode === "CURRENT") return;
        if (!historyEdit.dirty) { closeHistoricalWorkspace(); return; }
        const events = historyEdit.draftEvents.filter((event): event is typeof event & { intent: KomoControlGameplayIntent } => event.intent !== null);
        if (events.length !== historyEdit.draftEvents.length) { setHistoryEdit((current) => current ? { ...current, error: "Το ιστορικό draft δεν είναι πλήρες." } : current); return; }
        setBusy(true);
        try {
            const result = await bridge.mutateScorerEventGroup(gameplay.runId, { kind: "REPLACE_GROUP", scorerEventGroupId: historyEdit.scorerEventGroupId, expectedHistoryRevision: historyEdit.expectedHistoryRevision, events: events.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), intent: event.intent })) });
            const next = applyResult(result);
            if (!next) { setHistoryEdit((current) => current ? { ...current, error: result.ok ? "Η αποθήκευση δεν ολοκληρώθηκε." : `Η αποθήκευση απορρίφθηκε (${result.errorCode}).` } : current); return; }
            closeHistoricalWorkspace(); await loadHistory(false);
        } catch { setHistoryEdit((current) => current ? { ...current, error: "Η ιστορική αποθήκευση δεν ολοκληρώθηκε." } : current); }
        finally { setBusy(false); }
    }, [applyResult, bridge, busy, closeHistoricalWorkspace, gameplay.runId, historyEdit, loadHistory]);

    const deleteHistoricalGroup = useCallback(async () => {
        if (!bridge || busy) return;
        const context = historyEdit?.context ?? historyPreviewContext;
        const scorerEventGroupId = historyEdit?.scorerEventGroupId ?? historyPreview?.scorerEventGroupId;
        if (!context?.editCapabilities.canDeleteGroup || !scorerEventGroupId) return;
        setBusy(true);
        try {
            const result = await bridge.mutateScorerEventGroup(gameplay.runId, { kind: "DELETE_GROUP", scorerEventGroupId, expectedHistoryRevision: context.expectedHistoryRevision });
            const next = applyResult(result);
            if (!next) { if (historyEdit) setHistoryEdit((current) => current ? { ...current, error: result.ok ? "Η διαγραφή δεν ολοκληρώθηκε." : `Η διαγραφή απορρίφθηκε (${result.errorCode}).` } : current); return; }
            if (activeTimeoutCountdown?.scorerEventGroupId === scorerEventGroupId) {
                timeoutRecoveryRunRef.current = gameplay.runId;
                setActiveTimeoutCountdown(null);
            }
            closeHistoricalWorkspace(); await loadHistory(false);
        } catch { if (historyEdit) setHistoryEdit((current) => current ? { ...current, error: "Η ιστορική διαγραφή δεν ολοκληρώθηκε." } : current); else setError("Η ιστορική διαγραφή δεν ολοκληρώθηκε."); }
        finally { setBusy(false); }
    }, [activeTimeoutCountdown, applyResult, bridge, busy, closeHistoricalWorkspace, gameplay.runId, historyEdit, historyPreview, historyPreviewContext, loadHistory]);

    const withScorerEvent = useCallback((intent: KomoControlGameplayIntent): KomoControlGameplayIntent => flow?.scorerEventId && !intent.scorerEventId ? { ...intent, scorerEventId: flow.scorerEventId } : intent, [flow]);
    const appendIntent = useCallback(async (intent: KomoControlGameplayIntent): Promise<KomoControlSafeMatchGameplay | null> => {
        if (!bridge || busy) return null;
        const scoredIntent = withScorerEvent(intent);
        setBusy(true);
        try {
            if (correctionTarget) {
                let result = await bridge.correctGameplayEvent(gameplay.runId, correctionTarget.eventId, scoredIntent, false);
                if (!result.ok && result.dependentEventIds?.length && window.confirm(`Η διόρθωση επηρεάζει ${result.dependentEventIds.length} εξαρτώμενα συμβάντα. Να αφαιρεθούν αιτιακά;`)) result = await bridge.correctGameplayEvent(gameplay.runId, correctionTarget.eventId, scoredIntent, true);
                const next = applyResult(result); if (next) setCorrectionTarget(null); return next;
            }
            return applyResult(await bridge.appendGameplayIntent(gameplay.runId, scoredIntent));
        } catch { setError("Η τοπική καταχώριση δεν ολοκληρώθηκε."); return null; }
        finally { setBusy(false); }
    }, [applyResult, bridge, busy, correctionTarget, gameplay.runId, withScorerEvent]);

    const appendAndResolveResumableFlow = useCallback(async (intent: KomoControlGameplayIntent): Promise<KomoControlSafeMatchGameplay | null> => {
        if (!bridge || busy) return null;
        setBusy(true);
        try {
            const next = applyResult(await bridge.appendAndResolveResumableGameplayFlow(gameplay.runId, withScorerEvent(intent)));
            if (next) setResumableFlow(null);
            return next;
        } catch { setError("Η τοπική καταχώριση δεν ολοκληρώθηκε."); return null; }
        finally { setBusy(false); }
    }, [applyResult, bridge, busy, gameplay.runId, withScorerEvent]);

    const appendIntents = useCallback(async (intents: KomoControlGameplayIntent[]): Promise<KomoControlSafeMatchGameplay | null> => {
        if (!bridge || busy || intents.length === 0) return null;
        setBusy(true);
        try { return applyResult(await bridge.appendGameplayIntents(gameplay.runId, intents.map(withScorerEvent))); }
        catch { setError("Η σύνθετη τοπική καταχώριση δεν ολοκληρώθηκε."); return null; }
        finally { setBusy(false); }
    }, [applyResult, bridge, busy, gameplay.runId, withScorerEvent]);

    const appendTimeout = useCallback(async (side: Side, scorerEventId: string): Promise<KomoControlSafeMatchGameplay | null> => {
        if (!bridge || busy) return null;
        setBusy(true);
        try {
            const next = applyResult(await bridge.appendGameplayIntents(gameplay.runId, timeoutGameplayIntents(side, scorerEventId, gameplay.clockRunning)));
            if (next) {
                const startedAtMs = Date.now();
                timeoutRecoveryRunRef.current = gameplay.runId;
                setNowMs(startedAtMs);
                setActiveTimeoutCountdown({ scorerEventGroupId: `explicit:${scorerEventId}`, scorerEventId, team: side, startedAtMs });
            }
            return next;
        } catch { setError("Η σύνθετη τοπική καταχώριση δεν ολοκληρώθηκε."); return null; }
        finally { setBusy(false); }
    }, [applyResult, bridge, busy, gameplay.clockRunning, gameplay.runId]);

    const correctSpecific = useCallback(async (eventId: string, intent: KomoControlGameplayIntent): Promise<KomoControlSafeMatchGameplay | null> => {
        if (!bridge || busy) return null;
        setBusy(true);
        try {
            const scoredIntent = withScorerEvent(intent);
            let result = await bridge.correctGameplayEvent(gameplay.runId, eventId, scoredIntent, false);
            if (!result.ok && result.dependentEventIds?.length && window.confirm(`Η διόρθωση επηρεάζει ${result.dependentEventIds.length} εξαρτώμενα συμβάντα. Συνέχεια;`)) result = await bridge.correctGameplayEvent(gameplay.runId, eventId, scoredIntent, true);
            return applyResult(result);
        } finally { setBusy(false); }
    }, [applyResult, bridge, busy, gameplay.runId, withScorerEvent]);

    const hasPendingPenalty = (gameplay.penalty?.activePenaltyIds.length ?? 0) > 0;
    const closeFlow = useCallback(() => { setFlow(null); setCorrectionTarget(null); }, []);
    const cancelFlow = useCallback(() => {
        const openMadeShootingFoul = flow?.context === "SHOOTING" && flow.made === true && flow.committedEventId && !flow.sourceFoulEventId && (flow.action === "FOUL" || (flow.action === "TECH_FOUL" && (isSevereContactFoul(flow.foulType) || (flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "PLAYER"))));
        if ((flow?.action === "PENALTY" || openMadeShootingFoul) && flow?.committedEventId && bridge) {
            void bridge.removeGameplayEvent(gameplay.runId, flow.committedEventId, true).then((result) => {
                if (applyResult(result)) { setResumableFlow(null); closeFlow(); }
            });
            return;
        }
        closeFlow();
    }, [applyResult, bridge, closeFlow, flow, gameplay.runId]);
    const maybePenalty = useCallback((next: KomoControlSafeMatchGameplay | null, trail: FlowTrailEntry[] = [], source?: Partial<Flow>) => {
        if (!next) return;
        const pending = (next?.penalty?.activePenaltyIds.length ?? 0) > 0;
        if (pending) {
            const isShootingFoul = Boolean(source?.sourceFoulEventId && source?.fouledPlayerId);
            setFlow({ ...source, action: "PENALTY", step: isShootingFoul ? "free-throw" : "shooter", playerId: source?.playerId ?? (isShootingFoul ? source?.fouledPlayerId : undefined), trail });
        }
        else closeFlow();
    }, [closeFlow]);

    const startAction = useCallback((action: ActionId) => {
        if (gameplay.lifecycle !== "live" || busy || historyPreview || historyEdit || localCurrentCorrection || !livePrimaryActionAvailable(action, flow?.action ?? null)) return;
        if (action === "SUBS") {
            setSubsModal({ drafts: { HOME: createSubsTeamDraft(team("HOME")), AWAY: createSubsTeamDraft(team("AWAY")) }, scorerEventId: crypto.randomUUID(), error: null, mode: "ORDINARY", mandatoryOutIds: { HOME: [], AWAY: [] } });
            setError(null);
            return;
        }
        if (hasPendingPenalty) {
            setFlow({ action: "PENALTY", step: "shooter" });
            setError("Ολοκληρώστε ή χειριστείτε την εκκρεμή ποινή πριν από νέο συμβάν.");
            return;
        }
        const next: Flow = { action, step: firstLiveFlowStep(action), scorerEventId: crypto.randomUUID(), stoppageId: crypto.randomUUID() };
        if (action === "SHOOT") {
            setFlow({ ...next, points: 2 });
        } else if (action === "FOUL") {
            setFlow({ ...next, foulType: "PERSONAL_FOUL", context: "NON_SHOOTING" });
        } else if (action === "OFFENSIVE_FOUL") {
            setFlow({ ...next, foulType: "PERSONAL_FOUL", context: "NON_SHOOTING" });
        } else {
            setFlow(next);
        }
        setError(null);
    }, [busy, flow, gameplay.lifecycle, hasPendingPenalty, historyEdit, historyPreview, localCurrentCorrection, team]);

    useEffect(() => {
        if (mandatoryReplacementIds.HOME.length === 0 && mandatoryReplacementIds.AWAY.length === 0) return;
        setSubsModal((current) => {
            const sameMandatoryPlayers = current?.mode === "MANDATORY"
                && (['HOME', 'AWAY'] as const).every((side) => current.mandatoryOutIds[side].join(",") === mandatoryReplacementIds[side].join(","));
            if (sameMandatoryPlayers) return current;
            const drafts = { HOME: createSubsTeamDraft(team("HOME")), AWAY: createSubsTeamDraft(team("AWAY")) };
            drafts.HOME.selectedOutIds = [...mandatoryReplacementIds.HOME];
            drafts.AWAY.selectedOutIds = [...mandatoryReplacementIds.AWAY];
            const blockedSide = (['HOME', 'AWAY'] as const).find((side) => mandatoryReplacementIds[side].length > eligibleBench(team(side)).length);
            return {
                drafts,
                scorerEventId: crypto.randomUUID(),
                error: blockedSide ? `${blockedSide}: δεν υπάρχει επαρκής επιλέξιμος πάγκος για την υποχρεωτική αλλαγή.` : null,
                mode: "MANDATORY",
                mandatoryOutIds: { HOME: [...mandatoryReplacementIds.HOME], AWAY: [...mandatoryReplacementIds.AWAY] },
            };
        });
    }, [mandatoryReplacementKey, team]);

    useEffect(() => {
        const activePendingPenaltyId = gameplay.penalty?.activePenaltyIds[0] ?? null;
        if (!hasPendingPenalty) {
            if (endingPenaltyId !== null) setEndingPenaltyId(null);
            return;
        }
        if (endingPenaltyId === activePendingPenaltyId) return;
        if (endingPenaltyId !== null) setEndingPenaltyId(null);
        if (!flow) setFlow({ action: "PENALTY", step: "shooter" });
    }, [endingPenaltyId, flow, gameplay.penalty?.activePenaltyIds, hasPendingPenalty]);

    const finishShot = useCallback(async (made: boolean) => {
        if (!flow?.side || !flow.playerId || !flow.points) return;
        const intent: KomoControlGameplayIntent = { kind: "shot", team: flow.side, playerId: flow.playerId, points: flow.points, made, ...(flow.stoppageId ? { stoppageId: flow.stoppageId } : {}) };
        const committedEventId = flow.committedEventId ?? correctionTarget?.eventId;
        if (committedEventId) {
            const next = await correctSpecific(committedEventId, intent);
            if (!next) return;
            setCorrectionTarget(null);
            setFlow({ ...flow, made, baseIntent: intent, committedEventId, step: made ? "assist" : "rebound-player", ...(made ? {} : { shotSide: flow.side }) });
            return;
        }
        if (!made) {
            setFlow({ ...flow, made, step: "rebound-player", baseIntent: intent, shotSide: flow.side });
            return;
        }
        const next = await appendIntent(intent);
        const eventId = next?.latestEvent?.eventId;
        if (!next || !eventId) return;
        setFlow({ ...flow, made, baseIntent: intent, committedEventId: eventId, step: "assist" });
    }, [appendIntent, correctSpecific, correctionTarget, flow]);

    const finishAssist = useCallback(async (assistPlayerId?: string) => {
        if (!flow?.baseIntent) return;
        if (flow.context === "SHOOTING" && flow.made && flow.committedEventId && !flow.sourceFoulEventId && flow.side && flow.offender && flow.foulType && flow.stoppageId && flow.fouledPlayerId) {
            const { assistPlayerId: _previousAssist, ...shotIntent } = flow.baseIntent;
            const completedShot = assistPlayerId ? { ...shotIntent, assistPlayerId } : shotIntent;
            const shotState = assistPlayerId ? await correctSpecific(flow.committedEventId, completedShot) : gameplay;
            if (!shotState) return;
            const foul: KomoControlGameplayIntent = { kind: "foul", foulType: flow.foulType, team: flow.side, stoppageId: flow.stoppageId, offender: flow.offender, context: { kind: "SHOOTING" }, fouledPlayerId: flow.fouledPlayerId, relatedShotEventId: flow.committedEventId, ...(flow.category ? { category: flow.category } : {}) };
            const foulState = await appendIntent(foul);
            const sourceFoulEventId = foulState?.latestEvent?.eventId;
            if (!foulState || !sourceFoulEventId) return;
            const completedFlow = { ...flow, ...(assistPlayerId ? { assistPlayerId } : {}), ...(assistPlayerId ? {} : { noAssist: true }), baseIntent: completedShot, sourceFoulEventId };
            maybePenalty(foulState, foulTrail(completedFlow), completedFlow);
            return;
        }
        if (flow.committedEventId) {
            const { assistPlayerId: _previousAssist, ...shotIntent } = flow.baseIntent;
            const next = await correctSpecific(flow.committedEventId, { ...(assistPlayerId ? { ...shotIntent, assistPlayerId } : shotIntent), ...(flow.foulType ? {} : { scorerEventTerminal: { reason: "NATURAL", ...(assistPlayerId ? {} : { decisions: { assist: "NONE" } }) } }) });
            setCorrectionTarget(null);
            if (flow.foulType) maybePenalty(next, foulTrail({ ...flow, ...(assistPlayerId ? { assistPlayerId } : {}) }), { ...flow, ...(assistPlayerId ? { assistPlayerId } : {}) }); else setFlow(null);
            return;
        }
        const next = await appendIntent({ ...(assistPlayerId ? { ...flow.baseIntent, assistPlayerId } : flow.baseIntent), ...(flow.foulType ? {} : { scorerEventTerminal: { reason: "NATURAL", ...(assistPlayerId ? {} : { decisions: { assist: "NONE" } }) } }) });
        if (next) setFlow(null);
    }, [appendIntent, correctSpecific, flow, gameplay, maybePenalty]);

    const finishMissRebound = useCallback(async (reboundSide: Side, playerId?: string) => {
        if (!flow?.shotSide) return;
        const rebound = playerId
            ? { kind: "rebound" as const, team: reboundSide, playerId, offensive: reboundSide === flow.shotSide }
            : teamReboundIntent(reboundSide, reboundSide === flow.shotSide);
        const terminalRebound = { ...rebound, scorerEventTerminal: { reason: "NATURAL" as const } };
        if (flow.baseIntent) {
            const intents: KomoControlGameplayIntent[] = flow.committedEventId ? [] : [flow.baseIntent];
            if (flow.blockerId) intents.push({ kind: "block", team: opposite(flow.shotSide), playerId: flow.blockerId });
            intents.push(terminalRebound);
            const next = await appendIntents(intents);
            if (next) closeFlow();
            return;
        }
        const next = flow.sourceFoulEventId ? await appendAndResolveResumableFlow(terminalRebound) : await appendIntent(terminalRebound);
        if (next) closeFlow();
    }, [appendAndResolveResumableFlow, appendIntent, appendIntents, closeFlow, flow]);

    const submitFoul = useCallback(async (override?: Partial<Flow>) => {
        const value = { ...flow, ...override } as Flow;
        if (!value.side || !value.foulType || !value.offender || !value.context || !value.stoppageId) return;
        const intent: KomoControlGameplayIntent = { kind: "foul", foulType: value.foulType, team: value.side, stoppageId: value.stoppageId, offender: value.offender, context: value.context === "SHOOTING" ? { kind: "SHOOTING" } : value.context === "NON_CONTACT" ? { kind: "NON_CONTACT" } : { kind: "NON_SHOOTING", teamControlFoul: value.action === "OFFENSIVE_FOUL" }, ...(value.fouledPlayerId ? { fouledPlayerId: value.fouledPlayerId } : {}), ...(value.category ? { category: value.category } : {}), ...(value.technicalStaffSource ? { scorerEventContext: { technicalStaffSource: value.technicalStaffSource } } : {}), ...(value.baseIntent && "relatedShotEventId" in value.baseIntent ? { relatedShotEventId: value.baseIntent.relatedShotEventId } : {}) };
        let next = await appendIntent(intent);
        if (next && (next.penalty?.activePenaltyIds.length ?? 0) === 0 && next.latestEvent?.eventId) next = await correctSpecific(next.latestEvent.eventId, { ...intent, scorerEventTerminal: { reason: "NATURAL" } });
        const keepsCommittedFoul = (value.action === "FOUL" && value.foulType === "PERSONAL_FOUL" && value.context === "NON_SHOOTING") || (value.action === "TECH_FOUL" && (value.foulType === "TECHNICAL_FOUL" || value.foulType === "DISQUALIFYING_FOUL" || (isSevereContactFoul(value.foulType) && value.context === "NON_SHOOTING")));
        const source = keepsCommittedFoul && next?.latestEvent?.eventId
            ? { ...value, committedEventId: next.latestEvent.eventId }
            : undefined;
        maybePenalty(next, foulTrail(value), source);
    }, [appendIntent, flow, maybePenalty]);

    const recordShootingFoul = useCallback(async (made: boolean) => {
        if (!flow?.side || !flow.fouledPlayerId || !flow.points || !flow.offender || !flow.foulType || !flow.stoppageId) return;
        if (correctionTarget) { setError("Η διόρθωση shooting foul γίνεται από τα επιμέρους Shot/Foul συμβάντα του Game Log."); return; }
        const shootingSide = opposite(flow.side);
        const shot: KomoControlGameplayIntent = { kind: "shot", team: shootingSide, playerId: flow.fouledPlayerId, points: flow.points, made, stoppageId: flow.stoppageId };
        const shotState = flow.committedEventId ? await correctSpecific(flow.committedEventId, shot) : await appendIntent(shot); const shotId = flow.committedEventId ?? shotState?.latestEvent?.eventId;
        if (!shotId) return;
        const nextFlow = { ...flow, made, ...(made ? {} : { assistPlayerId: undefined }), baseIntent: shot, committedEventId: shotId };
        if (made) { setFlow({ ...nextFlow, step: "assist-choice" }); return; }
        const foul: KomoControlGameplayIntent = { kind: "foul", foulType: flow.foulType, team: flow.side, stoppageId: flow.stoppageId, offender: flow.offender, context: { kind: "SHOOTING" }, fouledPlayerId: flow.fouledPlayerId, relatedShotEventId: shotId, ...(flow.category ? { category: flow.category } : {}) };
        const foulState = flow.sourceFoulEventId ? await correctSpecific(flow.sourceFoulEventId, foul) : await appendIntent(foul);
        if (!foulState) return;
        const sourceFoulEventId = flow.sourceFoulEventId ?? foulState.latestEvent?.eventId;
        if (!sourceFoulEventId) return;
        const completedFlow = { ...nextFlow, sourceFoulEventId };
        maybePenalty(foulState, foulTrail(completedFlow), completedFlow);
    }, [appendIntent, correctionTarget, flow, maybePenalty]);

    const finishTurnoverWithoutSteal = useCallback(async () => {
        if (flow?.action !== "TURN_OVER" || flow.step !== "steal" || !flow.baseIntent) return;
        const next = await appendIntent({ ...flow.baseIntent, scorerEventTerminal: { reason: "NATURAL", decisions: { steal: "NONE" } } });
        if (next) closeFlow();
    }, [appendIntent, closeFlow, flow]);

    const finishTurnoverEarly = useCallback(async () => {
        if (flow?.action !== "TURN_OVER" || flow.step !== "steal" || !flow.baseIntent) { closeFlow(); return; }
        const next = await appendIntent({ ...flow.baseIntent, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "STEALER" } });
        if (next) closeFlow();
    }, [appendIntent, closeFlow, flow]);

    const finishMissWithoutRebound = useCallback(async () => {
        if (flow?.action !== "SHOOT" || flow.made !== false || !flow.baseIntent) { closeFlow(); return; }
        const terminal = { reason: "ENTER_EARLY" as const, unresolvedStep: "REBOUNDER" as const };
        if (flow.blockerId) {
            const intents: KomoControlGameplayIntent[] = flow.committedEventId ? [] : [flow.baseIntent];
            intents.push({ kind: "block", team: opposite(flow.shotSide!), playerId: flow.blockerId, scorerEventTerminal: terminal });
            const next = await appendIntents(intents);
            if (next) closeFlow();
            return;
        }
        const intent = { ...flow.baseIntent, scorerEventTerminal: terminal };
        const next = flow.committedEventId ? await correctSpecific(flow.committedEventId, intent) : await appendIntent(intent);
        if (next) closeFlow();
    }, [appendIntent, appendIntents, closeFlow, correctSpecific, flow]);

    const finishAssistEarly = useCallback(async () => {
        if (!flow?.baseIntent || !flow.committedEventId) { closeFlow(); return; }
        const terminal = { reason: "ENTER_EARLY" as const, unresolvedStep: "ASSIST" as const };
        const { assistPlayerId: _previousAssist, ...shotIntent } = flow.baseIntent;
        const madeShootingFoul = flow.context === "SHOOTING" && flow.made && !flow.sourceFoulEventId && flow.side && flow.offender && flow.foulType && flow.stoppageId && flow.fouledPlayerId;
        if (!madeShootingFoul) {
            const next = await correctSpecific(flow.committedEventId, { ...shotIntent, scorerEventTerminal: terminal });
            if (next) closeFlow();
            return;
        }
        const foul: KomoControlGameplayIntent = { kind: "foul", foulType: flow.foulType!, team: flow.side!, stoppageId: flow.stoppageId!, offender: flow.offender!, context: { kind: "SHOOTING" }, fouledPlayerId: flow.fouledPlayerId!, relatedShotEventId: flow.committedEventId, ...(flow.category ? { category: flow.category } : {}) };
        const foulState = await appendIntent(foul);
        const sourceFoulEventId = foulState?.latestEvent?.eventId;
        if (!foulState || !sourceFoulEventId) return;
        const penaltyId = foulState.penalty?.activePenaltyIds[0];
        if (!penaltyId) {
            const next = await correctSpecific(sourceFoulEventId, { ...foul, scorerEventTerminal: terminal });
            if (next) closeFlow();
            return;
        }
        const completedFlow = { ...flow, baseIntent: shotIntent, sourceFoulEventId };
        setEndingPenaltyId(penaltyId);
        const next = await appendIntent({ kind: "penalty-administration-ended", penaltyId, scorerEventTerminal: terminal });
        if (next) { closeFlow(); return; }
        setEndingPenaltyId(null);
        maybePenalty(foulState, foulTrail(completedFlow), completedFlow);
    }, [appendIntent, closeFlow, correctSpecific, flow, maybePenalty]);

    const finishReboundEarly = useCallback(async () => {
        if (flow?.action !== "REBOUND" || !flow.lastFactEventId || !flow.lastFactIntent) { closeFlow(); return; }
        const next = await correctSpecific(flow.lastFactEventId, { ...flow.lastFactIntent, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" } });
        if (next) closeFlow();
    }, [closeFlow, correctSpecific, flow]);

    const toggleClock = useCallback(async () => {
        if (clockEditing || busy || gameplay.lifecycle !== "live") return;
        if (!gameplay.clockRunning) {
            const next = await appendIntent({ kind: "clock-start" });
            if (next) {
                timeoutRecoveryRunRef.current = gameplay.runId;
                setActiveTimeoutCountdown(null);
            }
            return;
        }
        const current = liveClockSeconds(gameplay, Date.now());
        await appendIntents(current === gameplay.clockSeconds ? [{ kind: "clock-stop" }] : [{ kind: "clock-set", remainingSeconds: current }, { kind: "clock-stop" }]);
    }, [appendIntent, appendIntents, busy, clockEditing, gameplay]);

    const openClockCorrection = useCallback(() => {
        if (historyPreview || busy) return;
        if (gameplay.clockRunning) {
            setError("Σταματήστε πρώτα το ρολόι.");
            return;
        }
        setError(null);
        setClockEditError(null);
        setClockInput(formatLiveClock(displayedClock));
        setClockEditing(true);
    }, [busy, displayedClock, gameplay.clockRunning, historyPreview]);

    useEffect(() => {
        if (!gameplay.clockRunning || displayedClock > 0 || autoStopRef.current) return;
        autoStopRef.current = true;
        void appendIntents([{ kind: "clock-set", remainingSeconds: 0 }]).finally(() => { autoStopRef.current = false; });
    }, [appendIntents, displayedClock, gameplay.clockRunning]);

    const enterAction = useCallback(() => {
        if (flow?.action === "TECH_FOUL" && !flow.committedEventId) { closeFlow(); return; }
        if (flow?.action === "PENALTY" && (flow.foulType === "PERSONAL_FOUL" || flow.foulType === "TECHNICAL_FOUL" || isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL") && flow.committedEventId) {
            const penaltyId = gameplay.penalty?.activePenaltyIds[0];
            if (!penaltyId) { closeFlow(); return; }
            setEndingPenaltyId(penaltyId);
            const completePenalty = flow.sourceFoulEventId ? appendAndResolveResumableFlow : appendIntent;
            const attemptIndex = (gameplay.penalty?.entitlements.find((item) => item.penaltyId === penaltyId)?.completedAttempts ?? 0) + 1;
            const unresolvedStep: NonNullable<KomoControlScorerEventTerminal["unresolvedStep"]> = flow.step === "shooter" && (!flow.playerId || flow.replacementShooterRequired)
                ? "CHOOSE_SHOOTER"
                : flow.step === "assist" || flow.step === "assist-choice"
                    ? "ASSIST"
                    : flow.step === "offender"
                        ? "FOULER"
                        : flow.step === "victim" || flow.step === "shot-victim"
                            ? "DRAWN_BY"
                            : `FT${attemptIndex}` as "FT1" | "FT2" | "FT3";
            const freeThrowResume = unresolvedStep === "FT1" || unresolvedStep === "FT2" || unresolvedStep === "FT3";
            void completePenalty({ kind: "penalty-administration-ended", penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep, ...(flow.noAssist ? { decisions: { assist: "NONE" } } : {}), ...(freeThrowResume && flow.playerId ? { resumeContext: { penaltyShooterPlayerId: flow.playerId } } : {}) } }).then((next) => {
                if (next) { closeFlow(); return; }
                setEndingPenaltyId(null);
            });
            return;
        }
        if (flow?.action === "TURN_OVER" && flow.step === "steal") { void finishTurnoverEarly(); return; }
        if (flow?.step === "assist" || flow?.step === "assist-choice") { void finishAssistEarly(); return; }
        if (flow?.action === "SHOOT" && flow.made === false && (flow.step === "rebound-player" || flow.step === "blocker")) { void finishMissWithoutRebound(); return; }
        if (flow?.action === "REBOUND" && (flow.step === "rebound-team" || flow.step === "rebound-player")) { void finishReboundEarly(); return; }
        if (flow) closeFlow();
    }, [appendAndResolveResumableFlow, appendIntent, closeFlow, finishAssistEarly, finishMissWithoutRebound, finishReboundEarly, finishTurnoverEarly, flow, gameplay.penalty?.activePenaltyIds, gameplay.penalty?.entitlements]);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (clockEditing) {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setClockEditError(null);
                    setClockEditing(false);
                }
                return;
            }
            if (finalizationEntry) {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setFinalizationEntryError(null);
                    setFinalizationEntry(finalizationEntry === "REPORT" ? "CHOICE" : null);
                }
                return;
            }
            const element = event.target as HTMLElement | null;
            const formTarget = Boolean(element?.closest("input,select,textarea,[contenteditable='true']"));
            if (historyEdit) {
                const editCommand = liveKeyboardCommand(event.key, formTarget, clockEditing);
                if (event.key === "Escape" || event.key === "Enter" || editCommand) {
                    event.preventDefault(); event.stopPropagation();
                    if (event.key === "Escape") {
                        if (historyDeleteConfirm) setHistoryDeleteConfirm(false);
                        else if (historyEdit.activeTargetId && historyEdit.mode === "CURRENT") { setFlow(historyEdit.resumeFlow); closeHistoricalWorkspace(); }
                        else if (historyEdit.activeTargetId) setHistoryEdit((current) => current ? { ...current, activeTargetId: null, error: null } : current);
                        else if (historyEdit.mode === "CURRENT") { closeHistoricalWorkspace(); cancelFlow(); }
                        else closeHistoricalWorkspace();
                    } else if (event.key === "Enter") {
                        if (historyEdit.mode === "CURRENT") { if (!historyEdit.activeTargetId) { closeHistoricalWorkspace(); setFlow(null); } }
                        else if (!historyEdit.activeTargetId && !historyDeleteConfirm) void saveHistoricalEdit();
                    }
                    else if (editCommand === "clock") void toggleClock();
                }
                return;
            }
            if (localCurrentCorrection) {
                const correctionCommand = liveKeyboardCommand(event.key, formTarget, clockEditing);
                if (event.key === "Escape" || event.key === "Enter" || correctionCommand) {
                    event.preventDefault(); event.stopPropagation();
                    if (event.key === "Escape") { setFlow(localCurrentCorrection.resumeFlow); setLocalCurrentCorrection(null); }
                }
                return;
            }
            if (historyPreview) {
                const previewCommand = liveKeyboardCommand(event.key, formTarget, clockEditing);
                if (event.key === "Escape" || event.key === "Enter" || previewCommand) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") closeHistoricalWorkspace();
                }
                return;
            }
            if (subsModal) {
                const modalCommand = liveKeyboardCommand(event.key, formTarget, clockEditing);
                if (event.key === "Escape" || event.key === "Enter" || modalCommand) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape" && subsModal.mode === "ORDINARY") setSubsModal(null);
                }
                return;
            }
            const command = liveKeyboardCommand(event.key, formTarget, false);
            if (!command) return;
            event.preventDefault();
            if (command === "cancel") { setSelectedLogEvent(null); setStatusTeam(null); setClockEditing(false); cancelFlow(); }
            else if (command === "clock") void toggleClock();
            else enterAction();
        };
        window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
    }, [cancelFlow, clockEditing, closeHistoricalWorkspace, enterAction, finalizationEntry, historyDeleteConfirm, historyEdit, historyPreview, localCurrentCorrection, saveHistoricalEdit, subsModal, toggleClock]);

    const finalizeCurrentMatch = useCallback(async (reportDraft: string | null) => {
        if (!bridge || finalizationSubmittingRef.current) return;
        const validation = validateIncidentReport(reportDraft ?? "");
        if (validation.error) { setFinalizationEntryError(validation.error); return; }
        finalizationSubmittingRef.current = true;
        setFinalizationEntryError(null);
        try {
            const periodAlreadyEnded = gameplay.latestEvent?.type === "PERIOD_END";
            if (!periodAlreadyEnded) {
                const ended = await appendIntent({ kind: "period-end", period: gameplay.period });
                if (!ended) { setFinalizationEntryError("Η λήξη της περιόδου δεν αποθηκεύτηκε."); return; }
            }
            setBusy(true);
            try {
                const result = await bridge.finalizeMatch(gameplay.runId, { incidentReport: validation.incidentReport });
                const applied = applyResult(result);
                if (result.ok) {
                    if (applied) setFinalizationEntry(null);
                } else {
                    setFinalizationEntryError(`Η ολοκλήρωση απορρίφθηκε (${result.errorCode}).`);
                }
            } finally { setBusy(false); }
        } catch {
            setFinalizationEntryError("Η τοπική ολοκλήρωση απέτυχε. Ο αγώνας παραμένει ασφαλής.");
        } finally { finalizationSubmittingRef.current = false; }
    }, [appendIntent, applyResult, bridge, gameplay.latestEvent?.type, gameplay.period, gameplay.runId]);

    const advancePeriod = useCallback(async () => {
        if (displayedClock !== 0 || gameplay.clockRunning) { setError("Η περίοδος αλλάζει μόνο με σταματημένο ρολόι στο 00:00."); return; }
        const next = nextLivePeriod(gameplay);
        if (!next) { setFinalizationEntryError(null); setFinalizationEntry("CHOICE"); return; }
        if (!window.confirm(`Μετάβαση σε ${periodText(next)};`)) return;
        const ended = await appendIntent({ kind: "period-end", period: gameplay.period });
        if (!ended || !bridge) return;
        await appendIntent({ kind: "period-start", period: next });
    }, [appendIntent, applyResult, bridge, displayedClock, gameplay]);

    const useArrow = useCallback(async () => { await appendIntent({ kind: "alternating-possession", scorerEventId: crypto.randomUUID(), scorerEventTerminal: { reason: "NATURAL" } }); }, [appendIntent]);

    const removeEvent = useCallback(async (item: KomoControlGameplayHistoryItem) => {
        if (!bridge || item.type === "MATCH_START" || !window.confirm("Αφαίρεση του επιλεγμένου συμβάντος;")) return;
        setBusy(true);
        try {
            let result = await bridge.removeGameplayEvent(gameplay.runId, item.eventId, false);
            if (!result.ok && result.dependentEventIds?.length && window.confirm(`Υπάρχουν ${result.dependentEventIds.length} αιτιακά εξαρτώμενα συμβάντα. Αφαίρεση όλης της αλυσίδας;`)) result = await bridge.removeGameplayEvent(gameplay.runId, item.eventId, true);
            if (applyResult(result)) { setSelectedLogEvent(null); await loadHistory(false); }
        } finally { setBusy(false); }
    }, [applyResult, bridge, gameplay.runId, loadHistory]);

    const quickCorrect = useCallback(async (item: KomoControlGameplayHistoryItem) => {
        if (!item.intent) return;
        const intent = item.intent;
        if (intent.kind === "shot" || intent.kind === "free-throw") {
            await correctSpecific(item.eventId, { ...intent, made: !Boolean(intent.made) }); setSelectedLogEvent(null); return;
        }
        setCorrectionTarget(item); setSelectedLogEvent(null); setFlow(null);
    }, [correctSpecific]);

    const reopenFlowStep = (step: string) => setFlow((current) => {
        if (!current) return null;
        if (current.action === "SHOOT" && step === "points") {
            const baseIntent = !current.committedEventId && current.baseIntent?.kind === "shot"
                ? { ...current.baseIntent, points: 2 }
                : current.baseIntent;
            return { ...current, points: 2, baseIntent, step: "shooter" };
        }
        return { ...current, step };
    });
    const openLocalCurrentPlayerCorrection = (item: FlowTrailEntry, kind: KomoControlHistoricalEditTargetKind) => {
        if (!flow || !item.playerId) return;
        setLocalCurrentCorrection({ resumeFlow: flow, targetKind: kind, currentPlayerId: item.playerId });
        const step = kind === "DRAWN_BY" ? (flow.context === "SHOOTING" ? "shot-victim" : "victim")
            : kind === "TURNOVER_BY" || kind === "FOULER" || kind === "TECHNICAL_PLAYER" ? "offender"
                : kind === "STEALER" ? "steal"
                    : kind === "REBOUNDER" ? "rebound-player"
                        : kind === "FREE_THROW_SHOOTER" ? "shooter"
                            : kind.toLowerCase();
        setFlow({ ...flow, step });
    };
    const applyLocalCurrentPlayerCorrection = (side: Side, playerId: string) => {
        if (!localCurrentCorrection) return false;
        const { resumeFlow, targetKind, currentPlayerId } = localCurrentCorrection;
        if (playerId === currentPlayerId) setFlow(resumeFlow);
        else if (targetKind === "SHOOTER" || targetKind === "FREE_THROW_SHOOTER") setFlow({ ...resumeFlow, side: targetKind === "SHOOTER" ? side : resumeFlow.side, playerId });
        else if (targetKind === "FOULER" || targetKind === "TECHNICAL_PLAYER") setFlow({ ...resumeFlow, offender: { kind: "PLAYER", playerId } });
        else if (targetKind === "DRAWN_BY") setFlow({ ...resumeFlow, fouledPlayerId: playerId, ...(resumeFlow.context === "SHOOTING" ? { playerId } : {}) });
        else if (targetKind === "ASSIST") setFlow({ ...resumeFlow, assistPlayerId: playerId, noAssist: false });
        else if (targetKind === "BLOCKER") setFlow({ ...resumeFlow, blockerId: playerId });
        else if (targetKind === "TURNOVER_BY") setFlow({ ...resumeFlow, playerId, baseIntent: resumeFlow.baseIntent?.kind === "turnover" ? { ...resumeFlow.baseIntent, playerId } : resumeFlow.baseIntent });
        else if (targetKind === "STEALER") setFlow({ ...resumeFlow, stealerId: playerId });
        else setFlow(resumeFlow);
        setLocalCurrentCorrection(null);
        return true;
    };
    const selectShotPoints = (points: 2 | 3) => setFlow((current) => {
        if (!current || current.action !== "SHOOT" || current.committedEventId) return current;
        const baseIntent = current.baseIntent?.kind === "shot"
            ? { ...current.baseIntent, points }
            : current.baseIntent;
        return { ...current, points, baseIntent, step: "shooter" };
    });
    const flowPlayerLabel = (playerId: string | undefined) => {
        const player = playerById(gameplay, playerId);
        return player?.shirtNumber ? `#${player.shirtNumber}` : "—";
    };
    const foulTrail = (value: Flow): FlowTrailEntry[] => {
        const steps = [...(value.trail ?? [])];
        const severeContactFoul = value.action === "TECH_FOUL" && isSevereContactFoul(value.foulType);
        const playerContactDisqualification = value.action === "TECH_FOUL" && value.foulType === "DISQUALIFYING_FOUL" && value.offender?.kind === "PLAYER";
        const playerContactFoul = severeContactFoul || playerContactDisqualification;
        const staffDisqualification = value.action === "TECH_FOUL" && value.foulType === "DISQUALIFYING_FOUL" && value.offender?.kind === "BENCH";
        if (value.action !== "FOUL" && !playerContactFoul && !staffDisqualification) return steps;
        if (playerContactFoul) steps.push({ step: "context", label: "FOUL", value: value.context === "SHOOTING" ? (value.foulType === "FLAGRANT_FOUL" ? "SHOOTING FL" : "SHOOTING DI") : value.foulType === "DISQUALIFYING_FOUL" ? "DISQUALIFYING" : severeFoulLabel(value.foulType), frozen: true });
        else if (value.context) steps.push({ step: "context", label: "FOUL", value: value.context === "SHOOTING" ? "SHOOTING FOUL" : "FOUL", frozen: true });
        if (value.points) steps.push({ step: "shot-points", label: "SHOT TYPE", value: `${value.points}PT`, frozen: true });
        if (value.offender?.kind === "PLAYER") steps.push({ step: "offender", label: "FOULER", value: flowPlayerLabel(value.offender.playerId), frozen: true, playerId: value.offender.playerId, sourceEventId: value.sourceFoulEventId, correctionKind: "FOULER" });
        if (staffDisqualification && value.offender?.kind === "BENCH") steps.push({ step: "offender", label: "FOULER", value: value.offender.role === "HEAD_COACH" ? "COACH" : "BENCH", frozen: true, teamSide: value.side });
        if (value.fouledPlayerId) steps.push({ step: value.context === "SHOOTING" ? "shot-victim" : "victim", label: "DRAWN BY", value: flowPlayerLabel(value.fouledPlayerId), frozen: true, playerId: value.fouledPlayerId, sourceEventId: value.sourceFoulEventId, correctionKind: "DRAWN_BY" });
        if (value.made !== undefined) steps.push({ step: "shooting-result", label: "RESULT", value: value.made ? "MADE" : "MISS", frozen: true, sourceEventId: value.committedEventId });
        if (value.assistPlayerId) steps.push({ step: "assist", label: "ASSIST", value: flowPlayerLabel(value.assistPlayerId), frozen: true, playerId: value.assistPlayerId, sourceEventId: value.committedEventId, correctionKind: "ASSIST" });
        return steps;
    };
    const renderFlowTrail = () => {
        if (!flow) return null;
        const steps: FlowTrailEntry[] = [...(flow.trail ?? [])];
        if (flow.action === "SHOOT") {
            if (flow.points) steps.push({ step: "points", label: "SHOT TYPE", value: `${flow.points}PT` });
            if (flow.playerId) steps.push({ step: "shooter", label: "SHOOTER", value: flowPlayerLabel(flow.playerId), playerId: flow.playerId, sourceEventId: flow.committedEventId, correctionKind: "SHOOTER" });
            if (flow.made !== undefined) steps.push({ step: "shot-result", label: "RESULT", value: flow.made ? "MADE" : "MISS", sourceEventId: flow.committedEventId });
            if (flow.made === true && flow.step === "assist") steps.push({ step: "assist", label: "ASSIST", value: "", teamSide: flow.side });
            if (flow.step === "blocker") steps.push({ step: "blocker", label: "BLOCKER", value: "", teamSide: opposite(flow.shotSide!) });
            if (flow.blockerId) steps.push({ step: "blocker", label: "BLOCKER", value: flowPlayerLabel(flow.blockerId), playerId: flow.blockerId, correctionKind: "BLOCKER" });
            if (flow.made === false && flow.step === "rebound-player") steps.push({ step: "rebound-player", label: "REBOUNDER", value: "" });
        }
        if (flow.action === "REBOUND" && flow.step === "rebound-player") steps.push({ step: "rebound-player", label: "REBOUNDER", value: "" });
        const playerContactDisqualification = flow.action === "TECH_FOUL" && flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "PLAYER";
        const playerContactTechFoul = flow.action === "TECH_FOUL" && (isSevereContactFoul(flow.foulType) || playerContactDisqualification);
        const awaitingSevereOrDisqualifyingOffender = flow.action === "TECH_FOUL" && (isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL") && flow.step === "offender" && !flow.offender;
        if ((flow.action === "FOUL" || (flow.action === "TECH_FOUL" && (isSevereContactFoul(flow.foulType) || playerContactDisqualification))) && !flow.trail?.length) {
            if (flow.context) steps.push({ step: "context", label: "FOUL", value: isSevereContactFoul(flow.foulType) ? (flow.context === "SHOOTING" ? (flow.foulType === "FLAGRANT_FOUL" ? "SHOOTING FL" : "SHOOTING DI") : severeFoulLabel(flow.foulType)) : flow.foulType === "DISQUALIFYING_FOUL" ? (flow.context === "SHOOTING" ? "SHOOTING DI" : "DISQUALIFYING") : flow.context === "SHOOTING" ? "SHOOTING FOUL" : "FOUL" });
            if (flow.points) steps.push({ step: "shot-points", label: "SHOT TYPE", value: `${flow.points}PT` });
            if (flow.action === "FOUL" && flow.step === "offender") steps.push({ step: "offender", label: "FOULER", value: "" });
            if (flow.made !== undefined) steps.push({ step: "shooting-result", label: "RESULT", value: flow.made ? "MADE" : "MISS", sourceEventId: flow.committedEventId });
            if (flow.assistPlayerId) steps.push({ step: "assist", label: "ASSIST", value: flowPlayerLabel(flow.assistPlayerId) });
        }
        if (awaitingSevereOrDisqualifyingOffender) steps.push({ step: "offender", label: "FOULER", value: "" });
        const technicalFoul = flow.action === "TECH_FOUL" && flow.foulType === "TECHNICAL_FOUL";
        if (technicalFoul && flow.step === "offender" && !flow.offender) steps.push({ step: "offender", label: "FOUL", value: "" });
        if (flow.action === "TURN_OVER") {
            if (flow.playerId) steps.push({ step: "offender", label: "TURNOVER BY", value: flowPlayerLabel(flow.playerId), playerId: flow.playerId, correctionKind: "TURNOVER_BY" });
            else if (flow.step === "offender") steps.push({ step: "offender", label: "TURNOVER BY", value: "" });
            if (flow.step === "steal") steps.push({ step: "steal", label: "STEALER", value: flow.stealerId ? flowPlayerLabel(flow.stealerId) : "", playerId: flow.stealerId, teamSide: flow.stealerId ? undefined : flow.side, correctionKind: "STEALER" });
        }
        if ((flow.action === "FOUL" || flow.action === "OFFENSIVE_FOUL" || flow.action === "TECH_FOUL") && flow.offender) {
            const offender = flow.offender.kind === "PLAYER" ? flowPlayerLabel(flow.offender.playerId) : flow.offender.role;
            steps.push({ step: "offender", label: flow.action === "FOUL" || isSevereContactFoul(flow.foulType) || flow.foulType === "DISQUALIFYING_FOUL" ? "FOULER" : "FOUL", value: offender, playerId: flow.offender.kind === "PLAYER" ? flow.offender.playerId : undefined, teamSide: flow.offender.kind === "BENCH" ? flow.side : undefined, correctionKind: flow.foulType === "TECHNICAL_FOUL" ? "TECHNICAL_PLAYER" : "FOULER" });
            if (flow.fouledPlayerId) steps.push({ step: flow.context === "SHOOTING" ? "shot-victim" : "victim", label: "DRAWN BY", value: flowPlayerLabel(flow.fouledPlayerId), playerId: flow.fouledPlayerId, correctionKind: "DRAWN_BY" });
            else if (flow.action === "FOUL" && (flow.step === "victim" || flow.step === "shot-victim")) steps.push({ step: flow.step, label: "DRAWN BY", value: "", teamSide: opposite(flow.side!) });
        }
        if (playerContactTechFoul && (flow.step === "victim" || flow.step === "shot-victim") && !flow.fouledPlayerId) steps.push({ step: flow.step, label: "DRAWN BY", value: "", teamSide: opposite(flow.side!) });
        if (flow.action === "FOUL" && flow.context === "SHOOTING" && flow.step === "assist" && !flow.assistPlayerId) steps.push({ step: "assist", label: "ASSIST", value: "", teamSide: opposite(flow.side!) });
        if (playerContactTechFoul && flow.context === "SHOOTING" && flow.step === "assist" && !flow.assistPlayerId) steps.push({ step: "assist", label: "ASSIST", value: "", teamSide: opposite(flow.side!) });
        if ((flow.action === "TIME_OUT" || flow.action === "JUMP_BALL") && flow.side) steps.push({ step: "team-target", label: flow.action === "TIME_OUT" ? "TIMEOUT" : "JUMP BALL", value: `${flow.side} · ${team(flow.side).teamName}`, teamSide: flow.side });
        const technicalPenalty = flow.action === "PENALTY" && flow.foulType === "TECHNICAL_FOUL";
        if (technicalPenalty && flow.offender) {
            const offender = flow.offender.kind === "PLAYER" ? flowPlayerLabel(flow.offender.playerId) : flow.offender.role;
            steps.push({ step: "offender", label: "FOUL", value: offender, frozen: true, playerId: flow.offender.kind === "PLAYER" ? flow.offender.playerId : undefined, teamSide: flow.offender.kind === "BENCH" ? flow.side : undefined, sourceEventId: flow.sourceFoulEventId, correctionKind: "TECHNICAL_PLAYER" });
        }
        const penaltyBeneficiaryTeam = gameplay.penalty?.entitlements.find((item) => gameplay.penalty?.activePenaltyIds.includes(item.penaltyId))?.beneficiaryTeam;
        const manualPenaltyShooter = technicalPenalty || (flow.action === "PENALTY" && flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "BENCH");
        if (manualPenaltyShooter && flow.step === "shooter" && !flow.playerId) steps.push({ step: "shooter", label: "CHOOSE SHOOTER", value: "", teamSide: penaltyBeneficiaryTeam });
        else if (manualPenaltyShooter && flow.playerId) steps.push({ step: "shooter", label: "CHOOSE SHOOTER", value: flowPlayerLabel(flow.playerId), playerId: flow.playerId, correctionKind: "FREE_THROW_SHOOTER" });
        if (flow.action === "PENALTY" && flow.sourceFoulEventId && flow.playerId) steps.push({ step: "shooter", label: "FREE THROW", value: flowPlayerLabel(flow.playerId), playerId: flow.playerId, correctionKind: "FREE_THROW_SHOOTER" });
        const editableShootingFoulTrail = flow.action === "PENALTY" && Boolean(flow.sourceFoulEventId);
        const preservedReboundTrail = flow.action === "REBOUND" && (flow.trail?.length ?? 0) > 0;
        const preservedPenaltyTrail = flow.action === "PENALTY" && ((flow.trail?.length ?? 0) > 0 || technicalPenalty);
        const trailTeam = (item: FlowTrailEntry) => item.playerId
            ? gameplay.teams.find((candidate) => candidate.players.some((player) => player.playerId === item.playerId))
            : item.teamSide ? team(item.teamSide) : undefined;
        return steps.length ? <div className="live-flow-trail">{steps.map((item, index) => {
            const isThreePointShotType = flow.action === "SHOOT" && item.step === "points" && flow.points === 3;
            const itemTeam = trailTeam(item);
            const itemClassName = [isThreePointShotType ? "is-three-point" : "", itemTeam ? "is-team-owned" : ""].filter(Boolean).join(" ") || undefined;
            const correctionKind = item.correctionKind ?? (item.label === "RESULT" ? "SHOT_RESULT" : item.label.startsWith("FT") ? "FREE_THROW_RESULT" : undefined);
            const durableCorrection = Boolean(item.sourceEventId && correctionKind);
            const localCorrection = Boolean(!item.sourceEventId && correctionKind && item.playerId);
            const activeLocalCorrection = Boolean(localCurrentCorrection && correctionKind === localCurrentCorrection.targetKind && item.playerId === localCurrentCorrection.currentPlayerId);
            const correctItem = () => {
                if (durableCorrection) void openCurrentCorrection(item.sourceEventId!, correctionKind!);
                else if (localCorrection) openLocalCurrentPlayerCorrection(item, correctionKind!);
                else reopenFlowStep(item.step);
            };
            return item.frozen && !durableCorrection && !localCorrection && (!editableShootingFoulTrail || item.step === "context")
                ? <span className={[preservedReboundTrail || preservedPenaltyTrail ? "is-preserved-trail-card" : "", itemClassName].filter(Boolean).join(" ") || undefined} style={itemTeam ? teamColorStyle(itemTeam) : undefined} key={`${item.step}-${index}`}><small>{item.label}</small><strong>{item.value}</strong></span>
                : <button type="button" className={itemClassName} style={itemTeam ? teamColorStyle(itemTeam) : undefined} key={`${item.step}-${index}`} onClick={correctItem}><small>{item.label}</small><strong>{activeLocalCorrection ? "" : item.value}</strong></button>;
        })}</div> : null;
    };

    const renderHistoryPreview = () => {
        if (!historyPreview) return null;
        return <><div className="live-history-preview-meta"><strong>{historyPreview.title}</strong><span>{periodText(historyPreview.period)} · {formatLiveClock(historyPreview.clockSeconds)}</span></div><div className="live-flow-trail is-history-preview">{historyPreview.trail.map((item, index) => {
            const itemTeam = item.teamSide ? team(item.teamSide) : item.playerId ? gameplay.teams.find((candidate) => candidate.players.some((player) => player.playerId === item.playerId)) : undefined;
            return <span className={`is-preserved-trail-card${itemTeam ? " is-team-owned" : ""}`} style={itemTeam ? teamColorStyle(itemTeam) : undefined} key={`${item.step}-${index}`}><small>{item.label}</small><strong>{item.value}</strong></span>;
        })}</div><div className="live-history-preview-footer"><p className="live-history-preview-note">Ιστορική προβολή μόνο για ανάγνωση · ESC για κλείσιμο</p>{historyDeleteConfirm ? <div className="live-history-delete-confirm"><span>Θέλεις να διαγράψεις ολόκληρο το συμβάν;</span><button type="button" onClick={() => setHistoryDeleteConfirm(false)}>ΑΚΥΡΩΣΗ</button><button type="button" className="live-history-delete" disabled={busy} onClick={() => void deleteHistoricalGroup()}>ΔΙΑΓΡΑΦΗ</button></div> : <button type="button" className="live-history-delete" disabled={busy || !historyPreviewContext?.editCapabilities.canDeleteGroup} onClick={() => setHistoryDeleteConfirm(true)}>ΔΙΑΓΡΑΦΗ ΣΥΜΒΑΝΤΟΣ</button>}</div></>;
    };

    const renderHistoryEdit = () => {
        if (!historyEdit) return null;
        const plan = historyEdit.context.continuationPlan;
        const activeTarget = historyEdit.context.editCapabilities.targets.find((target) => target.targetId === historyEdit.activeTargetId);
        const activeTrailEntry = historyEdit.preview.trail.find((item) => item.editTargetId === historyEdit.activeTargetId);
        return <>{historyEdit.mode === "HISTORY" ? <div className="live-history-preview-meta"><strong>{historyEdit.preview.title}</strong><span>{periodText(historyEdit.preview.period)} · {formatLiveClock(historyEdit.preview.clockSeconds)}</span></div> : null}<div className="live-flow-trail is-history-preview is-history-edit">{historyEdit.preview.trail.map((item, index) => {
            const itemTeam = item.teamSide ? team(item.teamSide) : undefined;
            const active = Boolean(item.editTargetId && item.editTargetId === historyEdit.activeTargetId);
            const className = `${itemTeam ? "is-team-owned " : ""}${active ? "is-history-target-active" : ""}`.trim();
            return item.editTargetId && item.editable
                ? <button type="button" className={className} style={itemTeam ? teamColorStyle(itemTeam) : undefined} key={`${item.step}-${index}`} onClick={() => setHistoryEdit((current) => current ? { ...current, activeTargetId: item.editTargetId ?? null, error: null } : current)}><small>{item.label}</small><strong>{active ? "" : item.value}</strong></button>
                : <span className={`is-preserved-trail-card${className ? ` ${className}` : ""}`} style={itemTeam ? teamColorStyle(itemTeam) : undefined} key={`${item.step}-${index}`}><small>{item.label}</small><strong>{item.value}</strong></span>;
        })}</div><div className="live-history-edit-controls">{activeTarget?.kind === "SHOT_RESULT" ? <ChoiceGrid><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "CORRECT_SHOT_RESULT", targetId: activeTarget.targetId, made: true })}>MADE</Choice><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "CORRECT_SHOT_RESULT", targetId: activeTarget.targetId, made: false })}>MISS</Choice></ChoiceGrid> : activeTarget?.kind === "FREE_THROW_RESULT" ? <ChoiceGrid><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "CORRECT_FREE_THROW_RESULT", targetId: activeTarget.targetId, made: true })}>{activeTrailEntry?.label ?? "FT"} MADE</Choice><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "CORRECT_FREE_THROW_RESULT", targetId: activeTarget.targetId, made: false })}>{activeTrailEntry?.label ?? "FT"} MISS</Choice></ChoiceGrid> : historyEdit.activeTargetId ? <p className="live-player-prompt">Επιλέξτε επιτρεπτό παίκτη από τα rails · ESC ακυρώνει μόνο τη διόρθωση</p> : plan?.kind === "FREE_THROW_RESULT" ? <><h3>FT{plan.attemptNumber} · αποτέλεσμα</h3><ChoiceGrid><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "FREE_THROW_RESULT", made: true })}>FT{plan.attemptNumber} MADE</Choice><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "FREE_THROW_RESULT", made: false })}>FT{plan.attemptNumber} MISS</Choice></ChoiceGrid></> : plan?.kind === "ASSIST" ? <><p className="live-player-prompt">Επιλέξτε ASSIST από τα rails.</p>{plan.noAssistAllowed ? <ChoiceGrid stacked><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "ASSIST", playerId: null })}>NO ASSIST</Choice></ChoiceGrid> : null}</> : plan?.kind === "STEALER" ? <><p className="live-player-prompt">Επιλέξτε STEALER από τα rails.</p>{plan.noStealAllowed ? <ChoiceGrid stacked><Choice disabled={busy} onClick={() => void previewHistoricalAction({ kind: "STEALER", playerId: null })}>ΧΩΡΙΣ STEAL</Choice></ChoiceGrid> : null}</> : plan?.kind === "CHOOSE_SHOOTER" ? <p className="live-player-prompt">Επιλέξτε CHOOSE SHOOTER από τα rails.</p> : plan?.kind === "REBOUNDER" ? <p className="live-player-prompt">Επιλέξτε REBOUNDER ή TEAM από τα rails.</p> : <p className="live-history-preview-note">Το scorer event είναι έτοιμο</p>}{historyEdit.error ? <p className="live-history-edit-error">{historyEdit.error}</p> : null}</div>{historyEdit.mode === "HISTORY" ? <div className="live-history-preview-footer"><p className="live-history-preview-note">ENTER · αποθήκευση &nbsp; ESC · ακύρωση</p>{historyDeleteConfirm ? <div className="live-history-delete-confirm"><span>Θέλεις να διαγράψεις ολόκληρο το συμβάν;</span><button type="button" onClick={() => setHistoryDeleteConfirm(false)}>ΑΚΥΡΩΣΗ</button><button type="button" className="live-history-delete" disabled={busy} onClick={() => void deleteHistoricalGroup()}>ΔΙΑΓΡΑΦΗ</button></div> : <button type="button" className="live-history-delete" disabled={busy || !historyEdit.context.editCapabilities.canDeleteGroup} onClick={() => setHistoryDeleteConfirm(true)}>ΔΙΑΓΡΑΦΗ ΣΥΜΒΑΝΤΟΣ</button>}</div> : null}</>;
    };

    const railPlayers = (current: KomoControlSafeGameplayTeam) => {
        return onCourt(current);
    };

    const railPlayerAllowed = (side: Side, player: KomoControlSafeGameplayPlayer): boolean => {
        if (player.fouls.status !== "ELIGIBLE") return false;
        if (!flow) return true;
        if (flow.action === "PENALTY") {
            const beneficiaryTeam = gameplay.penalty?.entitlements.find((item) => gameplay.penalty?.activePenaltyIds.includes(item.penaltyId))?.beneficiaryTeam;
            if (flow.step === "shooter" || flow.step === "free-throw") return side === beneficiaryTeam;
            if (flow.sourceFoulEventId) {
                if (flow.step === "offender") return side === flow.side;
                if (flow.step === "shot-victim") return side === opposite(flow.side ?? "HOME");
                if (flow.step === "assist") return side === opposite(flow.side ?? "HOME") && player.playerId !== flow.fouledPlayerId;
            }
            return false;
        }
        if (flow.action === "SHOOT") {
            if (flow.step === "shooter" || flow.step === "rebound-player") return true;
            if (flow.step === "assist") return side === flow.side && player.playerId !== flow.playerId;
            if (flow.step === "blocker") return side === opposite(flow.shotSide!);
            return false;
        }
        if (flow.action === "REBOUND") return flow.step === "rebound-team" || flow.step === "rebound-player";
        if (flow.action === "TURN_OVER") return flow.step === "offender" || (flow.step === "steal" && side === flow.side);
        if (flow.action === "FOUL" || flow.action === "OFFENSIVE_FOUL" || flow.action === "TECH_FOUL") {
            if (flow.step === "offender") return true;
            if (flow.step === "victim" || flow.step === "shot-victim") return side === opposite(flow.side!);
            if (flow.context === "SHOOTING" && flow.step === "assist") return side === opposite(flow.side!) && player.playerId !== flow.fouledPlayerId;
            return false;
        }
        return false;
    };

    const selectRailPlayer = async (side: Side, player: KomoControlSafeGameplayPlayer) => {
        if (!flow || busy) return;
        if (!railPlayerAllowed(side, player)) return;
        if (applyLocalCurrentPlayerCorrection(side, player.playerId)) return;
        if (flow.action === "PENALTY" && flow.sourceFoulEventId) {
            if (flow.step === "offender") { setFlow({ ...flow, side, offender: { kind: "PLAYER", playerId: player.playerId }, step: "shot-victim" }); return; }
            if (flow.step === "shot-victim") { setFlow({ ...flow, fouledPlayerId: player.playerId, playerId: player.playerId, step: "shooting-result" }); return; }
            if (flow.step === "assist") { await finishAssist(player.playerId); return; }
            if (flow.step === "shooter") { setFlow({ ...flow, playerId: player.playerId, replacementShooterRequired: false, step: "free-throw" }); return; }
        }
        if (flow.action === "SHOOT") {
            if (flow.step === "shooter") { setFlow({ ...flow, side, playerId: player.playerId, step: "shot-result" }); return; }
            if (flow.step === "assist") { await finishAssist(player.playerId); return; }
            if (flow.step === "blocker") { setFlow({ ...flow, blockerId: player.playerId, receiverId: flow.playerId, step: "rebound-player" }); return; }
            if (flow.step === "rebound-player") { await finishMissRebound(side, player.playerId); return; }
        }
        if (flow.action === "REBOUND" && (flow.step === "rebound-team" || flow.step === "rebound-player")) { await finishMissRebound(side, player.playerId); return; }
        if (flow.action === "TURN_OVER") {
            if (flow.step === "offender") {
                const intent: KomoControlGameplayIntent = { kind: "turnover", team: side, playerId: player.playerId };
                if (correctionTarget) {
                    const next = await appendIntent(intent);
                    if (next) setFlow({ ...flow, playerId: player.playerId, side: opposite(side), step: "steal" });
                } else setFlow({ ...flow, playerId: player.playerId, side: opposite(side), step: "steal", baseIntent: intent });
                return;
            }
            if (flow.step === "steal" && flow.side) {
                const steal: KomoControlGameplayIntent = { kind: "steal", team: flow.side, playerId: player.playerId };
                setFlow({ ...flow, stealerId: player.playerId });
                const next = flow.baseIntent ? await appendIntents([flow.baseIntent, steal]) : await appendIntent(steal);
                if (next) closeFlow();
                return;
            }
        }
        if (flow.action === "FOUL" || flow.action === "OFFENSIVE_FOUL" || flow.action === "TECH_FOUL") {
            if (flow.step === "offender") {
                if (flow.action === "TECH_FOUL" && flow.foulType === "TECHNICAL_FOUL") {
                    await submitFoul({ side, offender: { kind: "PLAYER", playerId: player.playerId } });
                    return;
                }
                const nextStep = flow.context === "NON_CONTACT" ? "commit-foul" : flow.context === "SHOOTING" ? "shot-victim" : "victim";
                setFlow({ ...flow, side, offender: { kind: "PLAYER", playerId: player.playerId }, step: nextStep });
                return;
            }
            if (flow.step === "victim") { await submitFoul({ fouledPlayerId: player.playerId }); return; }
            if (flow.step === "shot-victim") { setFlow({ ...flow, fouledPlayerId: player.playerId, step: "shooting-result" }); return; }
            if (flow.context === "SHOOTING" && flow.step === "assist") { await finishAssist(player.playerId); return; }
        }
        if (flow.action === "PENALTY" && flow.step === "shooter") setFlow({ ...flow, playerId: player.playerId, replacementShooterRequired: false, step: "free-throw" });
    };

    const selectTechnicalStaffOffender = useCallback((side: Side, source: "COACH" | "BENCH") => {
        if (flow?.action !== "TECH_FOUL" || flow.step !== "offender") return;
        if (flow.foulType === "TECHNICAL_FOUL" && flow.category === "CATEGORY_1") {
            void submitFoul({ side, technicalStaffSource: source, offender: { kind: "BENCH", personId: `coach:${side}`, role: "HEAD_COACH" } });
            return;
        }
        if (flow.foulType !== "DISQUALIFYING_FOUL" || flow.context !== "NON_SHOOTING") return;
        if (source === "COACH") {
            void submitFoul({ side, context: "NON_CONTACT", offender: { kind: "BENCH", personId: `coach:${side}`, role: "HEAD_COACH" } });
            return;
        }
        const benchPerson = team(side).bench.find((person) => person.personId !== `coach:${side}` && person.personId !== `team:${side}`);
        if (!benchPerson) {
            setError("Δεν υπάρχει διαθέσιμο πρόσωπο πάγκου για αποβολή.");
            return;
        }
        void submitFoul({ side, context: "NON_CONTACT", offender: { kind: "BENCH", personId: benchPerson.personId, role: benchPerson.role } });
    }, [flow, submitFoul, team]);

    const renderFlow = () => {
        if (!flow) return <div className="live-workspace-idle"><strong>Επιλέξτε ενέργεια</strong><span>SPACE · ρολόι &nbsp; ENTER · ολοκλήρωση &nbsp; ESC · ακύρωση</span></div>;
        if ((flow.action === "TIME_OUT" || flow.action === "JUMP_BALL") && flow.step === "team-target") return <><h3>{flow.action === "TIME_OUT" ? "TIMEOUT" : "JUMP BALL"}</h3><ChoiceGrid><Choice onClick={() => setFlow({ ...flow, side: "HOME", step: "commit-team" })}>HOME · {team("HOME").teamName}</Choice><Choice onClick={() => setFlow({ ...flow, side: "AWAY", step: "commit-team" })}>AWAY · {team("AWAY").teamName}</Choice></ChoiceGrid></>;
        if (flow.step === "commit-team" && flow.side) return <><h3>{flow.action === "TIME_OUT" ? "TIMEOUT" : "JUMP BALL"}</h3><ChoiceGrid><Choice onClick={async () => { const next = flow.action === "TIME_OUT" ? await appendTimeout(flow.side!, flow.scorerEventId!) : await appendIntent({ kind: "jump-ball", possession: flow.side! }); if (next) closeFlow(); }}>ΚΑΤΑΧΩΡΙΣΗ</Choice></ChoiceGrid></>;
        if (flow.action === "SHOOT") {
            if (flow.step === "shooter") return <><h3>SHOOTER</h3><p className="live-player-prompt">Επιλέξτε αριθμό από τα rails</p><button type="button" className="live-context-exception" onClick={() => selectShotPoints(3)}>3PT</button></>;
            if (flow.step === "shot-result") return <><h3>MADE / MISS</h3><ChoiceGrid stacked><Choice active={flow.made === true} onClick={() => void finishShot(true)}>MADE</Choice><Choice active={flow.made === false} onClick={() => void finishShot(false)}>MISS</Choice></ChoiceGrid></>;
            if (flow.step === "assist" && flow.side) return <><h3>ASSIST</h3><p className="live-player-prompt">Επιλέξτε αριθμό από τα rails</p><button type="button" className="live-context-exception" onClick={() => void finishAssist()}>NO ASSIST</button></>;
            if (flow.step === "rebound-player") return <><h3>MISS</h3><p className="live-player-prompt">Επιλέξτε αριθμό ή TEAM από τα rails</p>{!flow.blockerId ? <button type="button" className="live-context-exception" onClick={() => setFlow({ ...flow, step: "blocker" })}>BLOCK</button> : null}</>;
            if (flow.step === "blocker" && flow.shotSide) return <><h3>BLOCKER</h3><p className="live-player-prompt">Επιλέξτε αντίπαλο αριθμό</p></>;
        }
        if (flow.action === "REBOUND") {
            if (flow.step === "rebound-team" || flow.step === "rebound-player") return <><h3>REBOUNDER</h3><p className="live-player-prompt">Επιλέξτε αριθμό ή TEAM από τα rails</p></>;
        }
        if (flow.action === "TURN_OVER") {
            if (flow.step === "offender") return <><h3>TURNOVER BY</h3><p className="live-player-prompt">Επιλέξτε αριθμό από τα rails</p></>;
            if (flow.step === "steal" && flow.side) return <><h3>STEALER</h3><p className="live-player-prompt">Επιλέξτε αντίπαλο αριθμό</p><button className="live-skip" type="button" onClick={() => void finishTurnoverWithoutSteal()}>ΧΩΡΙΣ STEAL</button></>;
        }
        if (flow.action === "FOUL" || flow.action === "OFFENSIVE_FOUL" || flow.action === "TECH_FOUL") {
            if (flow.step === "foul-type") return <><h3>TECH. FOUL</h3><ChoiceGrid><Choice onClick={() => setFlow({ ...flow, foulType: "TECHNICAL_FOUL", category: "CATEGORY_2", context: "NON_CONTACT", step: "offender" })}>ΤΕΧΝ. ΠΟΙΝΗ</Choice><Choice onClick={() => setFlow({ ...flow, foulType: "TECHNICAL_FOUL", category: "CATEGORY_1", context: "NON_CONTACT", step: "offender" })}>ΤΕΧΝ. ΠΟΙΝΗ GD</Choice><Choice onClick={() => setFlow({ ...flow, foulType: "FLAGRANT_FOUL", context: "NON_SHOOTING", step: "offender" })}>FLAGRANT GD</Choice><Choice onClick={() => setFlow({ ...flow, foulType: "DISRUPTIVE_FOUL", context: "NON_SHOOTING", step: "offender" })}>DISRUPTIVE</Choice><Choice onClick={() => setFlow({ ...flow, foulType: "DISQUALIFYING_FOUL", context: "NON_SHOOTING", step: "offender" })}>DISQUALIFYING</Choice></ChoiceGrid></>;
            if (flow.step === "offender") {
                const technicalCategory1 = flow.action === "TECH_FOUL" && flow.foulType === "TECHNICAL_FOUL" && flow.category === "CATEGORY_1";
                const defaultDisqualifying = flow.action === "TECH_FOUL" && flow.foulType === "DISQUALIFYING_FOUL" && flow.context === "NON_SHOOTING" && !flow.offender;
                const playerContactFoul = isSevereContactFoul(flow.foulType) || defaultDisqualifying;
                return <><h3>{flow.action === "FOUL" || playerContactFoul || flow.foulType === "DISQUALIFYING_FOUL" ? "FOULER" : "FOUL"}</h3><p className="live-player-prompt">{technicalCategory1 || defaultDisqualifying ? "Επιλέξτε αριθμό, COACH ή BENCH από τα rails" : "Επιλέξτε αριθμό από τα rails"}</p>{flow.action === "FOUL" && flow.context === "NON_SHOOTING" && !flow.offender ? <button type="button" className="live-context-exception" onClick={() => setFlow({ ...flow, context: "SHOOTING", step: "shot-points" })}>SHOOTING FOUL</button> : null}{!flow.offender && (isSevereContactFoul(flow.foulType) || defaultDisqualifying) && flow.context === "NON_SHOOTING" ? <button type="button" className="live-skip" onClick={() => setFlow({ ...flow, context: "SHOOTING", step: "shot-points" })}>{flow.foulType === "FLAGRANT_FOUL" ? "SHOOTING FL" : "SHOOTING DI"}</button> : null}</>;
            }
            if (flow.step === "victim" && flow.side) return <><h3>DRAWN BY</h3><p className="live-player-prompt">Επιλέξτε αντίπαλο αριθμό</p></>;
            if (flow.step === "shot-points") return <><h3>SHOT TYPE</h3><ChoiceGrid><Choice onClick={() => setFlow({ ...flow, points: 2, step: "offender" })}>2PT</Choice><Choice onClick={() => setFlow({ ...flow, points: 3, step: "offender" })}>3PT</Choice></ChoiceGrid></>;
            if (flow.step === "shot-victim" && flow.side) return <><h3>DRAWN BY</h3><p className="live-player-prompt">Επιλέξτε αντίπαλο αριθμό</p></>;
            if (flow.step === "shooting-result") return <><h3>MADE / MISS</h3><ChoiceGrid stacked><Choice onClick={() => void recordShootingFoul(true)}>MADE</Choice><Choice onClick={() => void recordShootingFoul(false)}>MISS</Choice></ChoiceGrid></>;
            if (flow.context === "SHOOTING" && flow.step === "assist-choice") return <><h3>ASSIST</h3><ChoiceGrid stacked><Choice onClick={() => setFlow({ ...flow, step: "assist" })}>ASSIST</Choice><Choice onClick={() => void finishAssist()}>NO ASSIST</Choice></ChoiceGrid></>;
            if (flow.context === "SHOOTING" && flow.step === "assist") return <><h3>ASSIST</h3><p className="live-player-prompt">Επιλέξτε αριθμό από τα rails</p></>;
            if (flow.step === "commit-foul") return <ChoiceGrid><Choice onClick={() => void submitFoul({ foulType: flow.foulType ?? "PERSONAL_FOUL", context: flow.context ?? "NON_SHOOTING" })}>Καταχώριση ποινής</Choice></ChoiceGrid>;
        }
        if (flow.action === "PENALTY") {
            const penalty = gameplay.penalty; const pending = penalty?.entitlements.find((item) => penalty.activePenaltyIds.includes(item.penaltyId));
            if (!penalty || !pending) return <div className="live-workspace-idle">Δεν υπάρχει εκκρεμής ποινή.</div>;
            if (flow.sourceFoulEventId) {
                if (flow.step === "shot-points") return <><h3>SHOT TYPE</h3><ChoiceGrid><Choice active={flow.points === 2} onClick={() => setFlow({ ...flow, points: 2, step: "offender" })}>2PT</Choice><Choice active={flow.points === 3} onClick={() => setFlow({ ...flow, points: 3, step: "offender" })}>3PT</Choice></ChoiceGrid></>;
                if (flow.step === "offender") return <><h3>FOULER</h3><p className="live-player-prompt">Επιλέξτε αριθμό από τα rails</p></>;
                if (flow.step === "shot-victim") return <><h3>DRAWN BY</h3><p className="live-player-prompt">Επιλέξτε αντίπαλο αριθμό</p></>;
                if (flow.step === "shooting-result") return <><h3>MADE / MISS</h3><ChoiceGrid stacked><Choice active={flow.made === true} onClick={() => void recordShootingFoul(true)}>MADE</Choice><Choice active={flow.made === false} onClick={() => void recordShootingFoul(false)}>MISS</Choice></ChoiceGrid></>;
                if (flow.step === "assist-choice") return <><h3>ASSIST</h3><ChoiceGrid stacked><Choice onClick={() => setFlow({ ...flow, step: "assist" })}>ASSIST</Choice><Choice onClick={() => void finishAssist()}>NO ASSIST</Choice></ChoiceGrid></>;
                if (flow.step === "assist") return <><h3>ASSIST</h3><p className="live-player-prompt">Επιλέξτε αριθμό από τα rails</p></>;
                if (flow.step === "shooter") return <><h3>FREE THROW</h3><p className="live-player-prompt">Επιλέξτε αριθμό από το δικαιούχο rail</p></>;
            }
            const isNonShootingPlayerContactFoul = flow.context === "NON_SHOOTING" && (isSevereContactFoul(flow.foulType) || (flow.foulType === "DISQUALIFYING_FOUL" && flow.offender?.kind === "PLAYER"));
            const shooterId = flow.playerId ?? (isNonShootingPlayerContactFoul ? flow.fouledPlayerId ?? pending.designatedPlayerId ?? undefined : pending.designatedPlayerId ?? undefined);
            if (flow.replacementShooterRequired || !shooterId) return <><h3>CHOOSE SHOOTER</h3><p className="live-player-prompt">Επιλέξτε αριθμό από το δικαιούχο rail</p>{!penalty.administrationStarted && flow.foulType !== "TECHNICAL_FOUL" ? <button className="live-link" type="button" onClick={() => setFlow({ action: "TECH_FOUL", step: "foul-type", stoppageId: penalty.stoppageId })}>CANCEL μέσω αντίθετης ποινής</button> : null}</>;
            const recordFreeThrow = async (made: boolean) => {
                const attemptIndex = (pending.completedAttempts ?? 0) + 1;
                const finalAttempt = attemptIndex === pending.attempts;
                const terminal = finalAttempt && (made || pending.restartKind !== "LIVE_BALL")
                    ? { scorerEventTerminal: { reason: "NATURAL" as const, ...(flow.noAssist ? { decisions: { assist: "NONE" as const } } : {}) } }
                    : {};
                const intent = { kind: "free-throw" as const, team: pending.beneficiaryTeam, playerId: shooterId, penaltyId: pending.penaltyId, attemptIndex, made, ...terminal };
                const next = finalAttempt && (made || pending.restartKind !== "LIVE_BALL")
                    ? await appendAndResolveResumableFlow(intent)
                    : await appendIntent(intent);
                if (!next) return;
                const trail: FlowTrailEntry[] = [...(flow.trail ?? []), { step: `free-throw-${attemptIndex}`, label: `FT ${attemptIndex}`, value: made ? "MADE" : "MISS", frozen: true, sourceEventId: next.latestEvent?.eventId }];
                const stillPending = (next.penalty?.activePenaltyIds.length ?? 0) > 0;
                if (stillPending) maybePenalty(next, trail, flow);
                else if (!made && pending.restartKind === "LIVE_BALL") setFlow({ ...flow, action: "REBOUND", step: "rebound-player", shotSide: pending.beneficiaryTeam, trail, lastFactEventId: next.latestEvent?.eventId, lastFactIntent: intent });
                else closeFlow();
            };
            return <><h3>{isNonShootingPlayerContactFoul ? `${flow.foulType === "DISQUALIFYING_FOUL" ? "DISQUALIFYING" : severeFoulLabel(flow.foulType)} · Βολή ${(pending.completedAttempts ?? 0) + 1}/${pending.attempts} · ${flowPlayerLabel(shooterId)}` : flow.sourceFoulEventId ? `FREE THROW ${flowPlayerLabel(shooterId)}` : `Βολή ${(pending.completedAttempts ?? 0) + 1}/${pending.attempts} · ${flowPlayerLabel(shooterId)}`}</h3><ChoiceGrid><Choice onClick={() => void recordFreeThrow(true)}>FT{(pending.completedAttempts ?? 0) + 1} MADE</Choice><Choice onClick={() => void recordFreeThrow(false)}>FT{(pending.completedAttempts ?? 0) + 1} MISS</Choice></ChoiceGrid></>;
        }
        return <div className="live-workspace-idle">Επιλέξτε το επόμενο στοιχείο.</div>;
    };

    const periods = useMemo(() => {
        const values = Array.from({ length: gameplay.rules.regulationPeriods }, (_, index) => ({ kind: "REGULATION" as const, index: index + 1 }));
        const overtimeIndexes = new Set(history.filter((item) => item.period.kind === "OVERTIME").map((item) => item.period.index));
        return [...values, ...[...overtimeIndexes].sort((a, b) => a - b).map((index) => ({ kind: "OVERTIME" as const, index }))];
    }, [gameplay.rules.regulationPeriods, history]);

    const renderRail = (current: KomoControlSafeGameplayTeam) => {
        if (historyEdit) {
            const historicalTeam = historyEdit.context.historicalState.teams.find((candidate) => candidate.side === current.side);
            const historicalPlayers = historicalTeam?.players.filter((player) => player.onCourt) ?? [];
            const activeTarget = historyEdit.context.editCapabilities.targets.find((target) => target.targetId === historyEdit.activeTargetId);
            const plan = historyEdit.context.continuationPlan;
            const candidatePlayerIds = new Set(activeTarget?.candidatePlayerIds ?? (plan && plan.kind !== "FREE_THROW_RESULT" ? plan.candidatePlayerIds : []));
            const chooseHistoricalPlayer = (playerId: string) => {
                if (activeTarget) void previewHistoricalAction({ kind: "CORRECT_PLAYER", targetId: activeTarget.targetId, playerId });
                else if (plan?.kind === "ASSIST") void previewHistoricalAction({ kind: "ASSIST", playerId });
                else if (plan?.kind === "STEALER") void previewHistoricalAction({ kind: "STEALER", playerId });
                else if (plan?.kind === "CHOOSE_SHOOTER") void previewHistoricalAction({ kind: "CHOOSE_SHOOTER", playerId });
                else if (plan?.kind === "REBOUNDER") void previewHistoricalAction({ kind: "REBOUNDER", team: current.side, playerId, teamRebound: false });
            };
            return <aside className="live-team-rail is-history-edit" style={teamColorStyle(current)}><div className="live-rail-five">{historicalPlayers.map((player) => <button type="button" key={player.playerId} disabled={busy || !candidatePlayerIds.has(player.playerId)} onClick={() => chooseHistoricalPlayer(player.playerId)} className={!player.eligible ? "is-disciplined" : ""}><strong>{player.shirtNumber}</strong><span>{player.displayName}</span></button>)}</div><div className="live-rail-controls"><button type="button" disabled={busy || plan?.kind !== "REBOUNDER" || !plan.teamReboundAllowed} onClick={() => void previewHistoricalAction({ kind: "REBOUNDER", team: current.side, teamRebound: true })}>TEAM</button><button type="button" disabled>COACH</button><button type="button" disabled>BENCH</button><button type="button" className="live-status-button" disabled>STATUS</button></div></aside>;
        }
        const candidates = railPlayers(current);
        const staffSelectionActive = flow?.action === "TECH_FOUL" && flow.step === "offender" && ((flow.foulType === "TECHNICAL_FOUL" && flow.category === "CATEGORY_1") || (flow.foulType === "DISQUALIFYING_FOUL" && flow.context === "NON_SHOOTING" && !flow.offender));
        return <aside className="live-team-rail" style={teamColorStyle(current)}><div className={`live-rail-five${candidates.length > gameplay.rules.startingPlayers ? " is-selection" : ""}`}>{candidates.map((player) => {
            const gdCount = gdAccumulationCount(player.fouls);
            const foulCount = Math.max(0, Math.min(5, player.fouls.total));
            return <button type="button" key={player.playerId} disabled={Boolean(historyPreview) || !railPlayerAllowed(current.side, player)} onClick={() => void selectRailPlayer(current.side, player)} className={player.fouls.status !== "ELIGIBLE" ? "is-disciplined" : ""}><span className="live-rail-player-number"><strong>#{player.shirtNumber}</strong>{current.captainPlayerId === player.playerId ? <small>C</small> : null}</span><span className="live-rail-gd" aria-label={`${gdCount} από 2 ποινές GD`}><small className={gdCount >= 1 ? "is-active" : undefined}>GD</small><small className={gdCount >= 2 ? "is-active" : undefined}>GD</small></span><span className="live-rail-fouls" aria-label={`${foulCount} από 5 φάουλ`}>{Array.from({ length: 5 }, (_, index) => <i key={index} className={index < foulCount ? "is-active" : undefined} aria-hidden="true" />)}</span></button>;
        })}</div><div className="live-rail-controls"><button type="button" disabled={Boolean(historyPreview)} onClick={() => { if ((flow?.action === "SHOOT" && flow.step === "rebound-player") || (flow?.action === "REBOUND" && (flow.step === "rebound-team" || flow.step === "rebound-player"))) void finishMissRebound(current.side); }}>TEAM</button><button type="button" disabled={Boolean(historyPreview) || (Boolean(flow) && !staffSelectionActive)} onClick={() => selectTechnicalStaffOffender(current.side, "COACH")}>COACH</button><button type="button" disabled={Boolean(historyPreview) || (Boolean(flow) && !staffSelectionActive)} onClick={() => selectTechnicalStaffOffender(current.side, "BENCH")}>BENCH</button><button type="button" className="live-status-button" disabled={Boolean(historyPreview)} onClick={() => setStatusTeam(current.side)}>STATUS</button></div></aside>;
    };

    const toggleSubsPlayer = (side: Side, playerId: string, source: "OUT" | "IN" | "REBUILD") => setSubsModal((current) => {
        if (!current) return null;
        if (current.mode === "MANDATORY" && source !== "IN") return current;
        const draft = current.drafts[side];
        const toggle = (ids: string[]) => ids.includes(playerId) ? ids.filter((id) => id !== playerId) : [...ids, playerId];
        const nextDraft = source === "REBUILD"
            ? { ...draft, rebuiltFiveIds: toggle(draft.rebuiltFiveIds) }
            : source === "OUT"
                ? { ...draft, selectedOutIds: toggle(draft.selectedOutIds) }
                : { ...draft, selectedInIds: toggle(draft.selectedInIds) };
        return { ...current, error: null, drafts: { ...current.drafts, [side]: nextDraft } };
    });
    const clearSubsDraft = (side: Side) => setSubsModal((current) => current?.mode === "MANDATORY" ? current : current ? { ...current, error: null, drafts: { ...current.drafts, [side]: { ...current.drafts[side], selectedOutIds: [], selectedInIds: [], rebuildMode: true, rebuiltFiveIds: [] } } } : null);
    const subsDraftError = (side: Side, draft: SubsTeamDraft): string | null => {
        if (subsModal?.mode === "MANDATORY" && draft.selectedOutIds.join(",") !== subsModal.mandatoryOutIds[side].join(",")) return `${side}: η υποχρεωτική έξοδος δεν μπορεί να αλλάξει.`;
        if (draft.rebuildMode) return draft.rebuiltFiveIds.length === gameplay.rules.startingPlayers ? null : `${side}: επιλέξτε ${gameplay.rules.startingPlayers} παίκτες.`;
        return draft.selectedOutIds.length === draft.selectedInIds.length ? null : `${side}: οι OUT και IN πρέπει να είναι ίσοι.`;
    };
    const substitutionIntentsFor = (side: Side): KomoControlGameplayIntent[] => {
        if (!subsModal) return [];
        const draft = subsModal.drafts[side]; const current = team(side); const initial = new Set(draft.initialOnCourtIds);
        const outs = draft.rebuildMode ? draft.initialOnCourtIds.filter((id) => !draft.rebuiltFiveIds.includes(id)) : draft.selectedOutIds;
        const incoming = draft.rebuildMode ? draft.rebuiltFiveIds.filter((id) => !initial.has(id)) : draft.selectedInIds;
        const order = new Map(current.players.map((player, index) => [player.playerId, index]));
        const stable = (ids: string[]) => [...ids].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
        return stable(outs).map((playerOutId, index) => ({ kind: "substitution", team: side, playerOutId, playerInId: stable(incoming)[index], scorerEventId: subsModal.scorerEventId }));
    };
    const activePenaltyShooterId = (candidate: Flow | null, state: KomoControlSafeMatchGameplay): string | undefined => {
        if (candidate?.action !== "PENALTY") return undefined;
        const pending = state.penalty?.entitlements.find((item) => state.penalty?.activePenaltyIds.includes(item.penaltyId));
        if (!pending) return undefined;
        const playerContact = candidate.context === "NON_SHOOTING" && (isSevereContactFoul(candidate.foulType) || (candidate.foulType === "DISQUALIFYING_FOUL" && candidate.offender?.kind === "PLAYER"));
        return candidate.playerId ?? (playerContact ? candidate.fouledPlayerId : pending.designatedPlayerId ?? undefined);
    };
    const commitSubs = async () => {
        if (!subsModal) return;
        const issue = subsDraftError("HOME", subsModal.drafts.HOME) ?? subsDraftError("AWAY", subsModal.drafts.AWAY);
        if (issue) { setSubsModal({ ...subsModal, error: issue }); return; }
        const shooterId = activePenaltyShooterId(flow, gameplay);
        const intents = [...substitutionIntentsFor("HOME"), ...substitutionIntentsFor("AWAY")];
        if (intents.length === 0) {
            if (subsModal.mode === "MANDATORY") setSubsModal({ ...subsModal, error: "Επιλέξτε τον απαιτούμενο αντικαταστάτη." });
            else setSubsModal(null);
            return;
        }
        const next = await appendIntents(intents.map((intent, index) => index === intents.length - 1 ? { ...intent, scorerEventTerminal: { reason: "NATURAL" } } : intent));
        if (!next) return;
        const stillPending = (next.penalty?.activePenaltyIds.length ?? 0) > 0;
        const shooterRemoved = Boolean(shooterId && intents.some((intent) => intent.playerOutId === shooterId) && !playerById(next, shooterId)?.onCourt);
        if (flow?.action === "PENALTY" && stillPending && shooterRemoved) setFlow({ ...flow, playerId: undefined, replacementShooterRequired: true, step: "shooter" });
        setSubsModal(null);
    };
    const renderSubsTeam = (side: Side) => {
        if (!subsModal) return null;
        const current = team(side); const draft = subsModal.drafts[side]; const active = onCourt(current); const bench = eligibleBench(current); const eligible = current.players.filter((player) => player.fouls.status === "ELIGIBLE");
        const playerButton = (player: KomoControlSafeGameplayPlayer, source: "OUT" | "IN" | "REBUILD", selected: boolean) => {
            const mandatoryOut = source === "OUT" && subsModal.mode === "MANDATORY" && subsModal.mandatoryOutIds[side].includes(player.playerId);
            const locked = subsModal.mode === "MANDATORY" && source !== "IN";
            return <button key={player.playerId} type="button" disabled={locked} className={`live-subs-player is-${source.toLowerCase()}${selected ? " is-selected" : ""}`} onClick={() => toggleSubsPlayer(side, player.playerId, source)}><strong>{player.shirtNumber}</strong><span>{mandatoryOut ? `${foulIndicator(player.fouls)} · REQUIRED OUT` : source === "OUT" ? "OUT" : source === "IN" ? "IN" : "FIVE"}</span></button>;
        };
        return <section className="live-subs-team" style={teamColorStyle(current)}><header><small>{side}</small><strong>{current.teamName}</strong></header>{draft.rebuildMode ? <><b>NEW FIVE</b><div className="live-subs-pool">{eligible.map((player) => playerButton(player, "REBUILD", draft.rebuiltFiveIds.includes(player.playerId)))}</div></> : <><b>ON COURT</b><div className="live-subs-pool">{active.map((player) => playerButton(player, "OUT", draft.selectedOutIds.includes(player.playerId)))}</div><b>BENCH</b><div className="live-subs-pool">{bench.map((player) => playerButton(player, "IN", draft.selectedInIds.includes(player.playerId)))}</div></>}<button type="button" className="live-subs-clear" disabled={subsModal.mode === "MANDATORY"} onClick={() => clearSubsDraft(side)}>CLEAR</button></section>;
    };

    const renderScoreTeam = (current: KomoControlSafeGameplayTeam, right = false) => <div className={`live-score-team${right ? " is-right" : ""}`} style={teamColorStyle(current)}>
        <small>{current.side}</small>
        <strong>{current.teamName}</strong>
        <b>{current.score}</b>
        <div className="live-score-team-status">
            <div className="live-score-timeouts" aria-label={`Τάιμ άουτ ${current.timeouts}/${current.timeoutAllowance}`}><span>T.O.</span><strong>{current.timeouts}/{current.timeoutAllowance}</strong></div>
            <div className="live-score-fouls" aria-label={`${current.teamFouls} ομαδικά φάουλ`}><strong>F:</strong><span className="live-score-foul-indicators">{Array.from({ length: 5 }, (_, index) => <i key={index} className={current.teamFouls > index ? "is-active" : undefined}>{index + 1}</i>)}</span>{current.inBonus ? <b>BONUS</b> : null}</div>
        </div>
    </div>;

    return <main className="live-control-shell">
        <section className="live-game-log"><header><div><span>GAME LOG</span><b>{historyTotal}</b></div><select aria-label="Φίλτρο περιόδου" value={periodFilter ? `${periodFilter.kind}:${periodFilter.index}` : "ALL"} onChange={(event) => { const [kind, index] = event.target.value.split(":"); setPeriodFilter(event.target.value === "ALL" ? null : { kind: kind as "REGULATION" | "OVERTIME", index: Number(index) }); }}><option value="ALL">Όλες</option>{periods.map((item) => <option key={`${item.kind}-${item.index}`} value={`${item.kind}:${item.index}`}>{periodText(item)}</option>)}</select></header><div className="live-log-list">{history.filter(isScorerFacingGameplayEvent).map((item) => {
            const teamPresentation = gameplayEventTeamPresentation(item, gameplay);
            return <button type="button" key={item.eventId} className={gameLogGroupClass(item.scorerEventGroupOrdinal)} onDoubleClick={() => void openHistoryPreview(item)} title="Διπλό κλικ για προβολή ή επεξεργασία συμβάντος"><time>{formatLiveClock(item.clockSeconds)}</time><strong>{gameplayEventLabel(item, gameplay)}{teamPresentation ? <> · <span className="live-log-team-name" style={teamPresentation.gameColor ? { color: teamPresentation.gameColor } : undefined}>{teamPresentation.teamName}</span></> : null}{resumableFlow && item.eventId === resumableFlow.sourceFoulEventId ? " · Σε εξέλιξη" : ""}</strong><span>{periodText(item.period)}</span></button>;
        })}</div>{historyCursor ? <button className="live-load-older" type="button" onClick={() => void loadHistory(true, historyCursor)}>Παλαιότερα</button> : null}</section>
        <section className="live-control-pane">
            <header className="live-scoreboard">{renderScoreTeam(leftTeam)}<div className="live-clock-stack"><div className="live-clock-toolbar"><button type="button" disabled={Boolean(historyPreview)} className={`live-period${gameplay.clockRunning ? " is-running" : ""}`} onClick={() => void advancePeriod()}>{periodText(gameplay.period)}</button><button type="button" className="live-clock-correction" disabled={Boolean(historyPreview) || busy} onClick={openClockCorrection}>ΔΙΟΡΘΩΣΗ</button></div><button type="button" disabled={Boolean(historyPreview)} className={`live-clock ${gameplay.clockRunning ? "is-running" : "is-stopped"}`} onClick={() => void toggleClock()} onContextMenu={(event) => { event.preventDefault(); openClockCorrection(); }}><span className="live-clock-time">{formatLiveClock(displayedClock)}</span></button><div className="live-possession"><button type="button" disabled={Boolean(historyPreview)} className={gameplay.alternatingPossession === "HOME" ? "is-home" : "is-away"} onClick={() => void useArrow()}>ΚΑΤΟΧΗ · {team(gameplay.alternatingPossession).teamName}</button></div></div>{renderScoreTeam(rightTeam, true)}</header>
            <div className="live-side-strip"><button type="button" disabled={Boolean(historyPreview)} style={teamColorStyle(leftTeam)}><small>{leftTeam.presentationSide}</small><strong>{leftTeam.side}</strong></button><div className="live-period-score-strip" aria-label="Σκορ ανά περίοδο">{gameplay.periodScores.map((score) => <span key={`${score.period.kind}-${score.period.index}`} className={score.period.kind === gameplay.period.kind && score.period.index === gameplay.period.index ? "is-current" : undefined}><b>{periodScoreLabel(score.period)}:</b><strong>{periodScoreValue(score)}</strong></span>)}</div><button type="button" disabled={Boolean(historyPreview)} style={teamColorStyle(rightTeam)}><small>{rightTeam.presentationSide}</small><strong>{rightTeam.side}</strong></button></div>
            <div className="live-control-body">
                {renderRail(leftTeam)}
                <section className="live-control-main">
                    <div className="live-primary-grid">{livePrimaryActions.map((action) => <button key={action.id} type="button" disabled={busy || Boolean(historyPreview) || Boolean(historyEdit) || Boolean(localCurrentCorrection) || Boolean(subsModal) || (hasPendingPenalty && action.id !== "SUBS") || gameplay.lifecycle !== "live" || !livePrimaryActionAvailable(action.id, flow?.action ?? null)} onClick={() => startAction(action.id)}><span>{action.glyph}</span><strong>{action.label}</strong></button>)}</div>
                    <section className={`live-event-workspace${historyPreview || historyEdit ? " is-history-preview" : ""}${historyEdit ? " is-history-edit" : ""}`}><div className="live-workspace-heading"><div><small>{historyEdit ? historyEdit.mode === "CURRENT" ? historyEdit.preview.title : "ΕΠΕΞΕΡΓΑΣΙΑ ΣΥΜΒΑΝΤΟΣ" : historyPreview ? "ΠΡΟΒΟΛΗ ΣΥΜΒΑΝΤΟΣ" : correctionTarget ? `ΔΙΟΡΘΩΣΗ #${correctionTarget.sequence}` : flow ? flow.foulType === "DISQUALIFYING_FOUL" ? "DISQUALIFYING" : flow.action === "PENALTY" && flow.sourceFoulEventId ? "SHOOTING FOUL" : flow.action.replaceAll("_", " ") : "ΝΕΟ ΣΥΜΒΑΝ"}</small></div>{historyEdit ? <span className="live-key-hint">{historyEdit.mode === "CURRENT" ? "ENTER · ολοκλήρωση   ESC · ακύρωση" : "ENTER · αποθήκευση   ESC · ακύρωση"}</span> : historyPreview ? <span className="live-key-hint">ESC · κλείσιμο</span> : flow ? <span className="live-key-hint">ENTER · προαιρετικό &nbsp; ESC · ακύρωση</span> : null}</div>{historyEdit ? renderHistoryEdit() : historyPreview ? renderHistoryPreview() : <>{activeTimeoutCountdown ? <div className="live-timeout-countdown" role="timer" aria-label={`TIME OUT ${team(activeTimeoutCountdown.team).teamName}`}><small>TIME OUT — {team(activeTimeoutCountdown.team).teamName}</small><strong>{formatLiveClock(timeoutCountdownSeconds(activeTimeoutCountdown.startedAtMs, nowMs))}</strong></div> : null}{renderFlowTrail()}{renderFlow()}</>}</section>
                    {error ? <div className="live-error" role="alert">{error}</div> : null}
                </section>
                {renderRail(rightTeam)}
            </div>
            <div className="live-control-status"><span className={`live-sync is-${syncFooter.className}`} title={syncFooter.detail}>{syncFooter.label}</span>{gameplay.sync.status !== "synced" ? <span className="live-sync-revision" title={syncFooter.detail}>REV {gameplay.eventHistoryRevision} · ACK {gameplay.sync.acknowledgedRevision}</span> : null}{syncFooter.canReconnect ? <button type="button" className="live-reconnect-button" onClick={openReconnect}>ΕΠΑΝΑΣΥΝΔΕΣΗ</button> : null}<span>Run · {gameplay.runId.slice(-8)}</span><button type="button" onClick={onOpenConfiguration} disabled={busy || gameplay.lifecycle !== "live"}>Προετοιμασία</button><button type="button" onClick={onBack}>Οι αγώνες μου</button><button type="button" onClick={() => void onLogout()}>Αποσύνδεση</button>{footer}</div>
        </section>
        {reconnectOpen ? <form className="live-reconnect-panel" onSubmit={(event) => { event.preventDefault(); void reconnect(); }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); setReconnectOpen(false); setReconnectError(null); } }}><header><div><small>ONLINE SYNC</small><strong>Επανασύνδεση scorer</strong></div><button type="button" onClick={() => { setReconnectOpen(false); setReconnectError(null); }}>×</button></header><label>Όνομα χρήστη<input autoFocus autoComplete="username" value={reconnectUsername} onChange={(event) => setReconnectUsername(event.target.value)} /></label><label>Κωδικός<input type="password" autoComplete="current-password" value={reconnectPassword} onChange={(event) => setReconnectPassword(event.target.value)} /></label><p>{gameplay.lifecycle === "finalized" ? "Ο αγώνας έχει αποθηκευτεί με ασφάλεια τοπικά." : "Ο αγώνας παραμένει ενεργός και αποθηκεύεται τοπικά."}</p>{reconnectError ? <div className="live-reconnect-error" role="alert">{reconnectError}</div> : null}<div><button type="button" onClick={() => { setReconnectOpen(false); setReconnectError(null); }}>Ακύρωση</button><button type="submit" disabled={reconnectBusy || !reconnectUsername.trim() || !reconnectPassword}>{reconnectBusy ? "Σύνδεση…" : "ΕΠΑΝΑΣΥΝΔΕΣΗ"}</button></div></form> : null}
        {finalSubmission ? <div className="live-modal-backdrop live-final-submission-backdrop"><section className={`live-final-submission is-${finalSubmission}`} role="dialog" aria-modal="true" aria-live="polite"><small>ΟΡΙΣΤΙΚΗ ΤΟΠΙΚΗ ΟΛΟΚΛΗΡΩΣΗ</small>{finalSubmission === "sending" ? <><span className="live-final-submission-mark" aria-hidden="true">↥</span><h2>ΑΠΟΣΤΟΛΗ ΑΓΩΝΑ...</h2><p>Ο αγώνας έχει αποθηκευτεί με ασφάλεια τοπικά.</p></> : finalSubmission === "success" ? <><span className="live-final-submission-mark" aria-hidden="true">✓</span><h2>Η ΑΠΟΣΤΟΛΗ ΟΛΟΚΛΗΡΩΘΗΚΕ</h2><p>Ο αγώνας συγχρονίστηκε επιτυχώς με τον server.</p></> : finalSubmission === "conflict" ? <><span className="live-final-submission-mark" aria-hidden="true">!</span><h2>ΣΥΓΚΡΟΥΣΗ ΣΥΓΧΡΟΝΙΣΜΟΥ</h2><p>Ο αγώνας παραμένει αποθηκευμένος τοπικά. Δεν θα γίνει αυτόματη αντικατάσταση των απομακρυσμένων δεδομένων.</p></> : <><span className="live-final-submission-mark" aria-hidden="true">!</span><h2>Η ΑΠΟΣΤΟΛΗ ΔΕΝ ΟΛΟΚΛΗΡΩΘΗΚΕ</h2><p>Ο αγώνας έχει αποθηκευτεί με ασφάλεια τοπικά.</p>{finalSubmission === "auth-required" ? <p>Απαιτείται επανασύνδεση scorer πριν από τη νέα προσπάθεια.</p> : null}</>}{finalSubmissionError ? <div className="live-final-submission-error" role="alert">{finalSubmissionError}</div> : null}<div className="live-final-submission-actions">{finalSubmission === "failure" ? <button type="button" className="is-primary" disabled={finalSubmissionBusy} onClick={() => void retryFinalizedSync()}>{finalSubmissionBusy ? "ΑΠΟΣΤΟΛΗ..." : "ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ"}</button> : null}{finalSubmission === "auth-required" ? <button type="button" className="is-primary" onClick={openReconnect}>ΕΠΑΝΑΣΥΝΔΕΣΗ</button> : null}<button type="button" onClick={onBack}>ΟΙ ΑΓΩΝΕΣ ΜΟΥ</button></div><span className="live-final-submission-revision">REV {gameplay.eventHistoryRevision} · ACK {gameplay.sync.acknowledgedRevision}</span></section></div> : null}
        {subsModal ? <div className="live-modal-backdrop" role="presentation"><section className="live-subs-modal" role="dialog" aria-modal="true" aria-label="SUBS" onKeyDown={(event) => { if (event.key === "Escape" || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (event.key === "Escape" && subsModal.mode === "ORDINARY") setSubsModal(null); } }}><header><div><small>SUBS</small><h2>{subsModal.mode === "MANDATORY" ? "ΥΠΟΧΡΕΩΤΙΚΗ ΑΛΛΑΓΗ" : "ΑΛΛΑΓΕΣ"}</h2></div><span>{subsModal.mode === "MANDATORY" ? "Επιλέξτε αντικαταστάτη" : "ESC · ακύρωση"}</span></header><div className="live-subs-modal-grid">{renderSubsTeam("HOME")}<div className="live-subs-modal-actions"><button type="button" className="live-apply" disabled={busy} onClick={() => void commitSubs()}>OK</button>{subsModal.mode === "ORDINARY" ? <button type="button" className="live-subs-cancel" disabled={busy} onClick={() => setSubsModal(null)}>CANCEL</button> : null}{subsModal.error ? <p className="live-subs-error">{subsModal.error}</p> : null}</div>{renderSubsTeam("AWAY")}</div></section></div> : null}
        {finalizationEntry ? <div className="live-modal-backdrop live-finalization-entry-backdrop" role="presentation"><section className={`live-finalization-entry${finalizationEntry === "REPORT" ? " is-report" : ""}`} role="dialog" aria-modal="true" aria-label={finalizationEntry === "REPORT" ? "ΑΝΑΦΟΡΑ ΣΥΜΒΑΝΤΩΝ" : "ΟΛΟΚΛΗΡΩΣΗ ΑΓΩΝΑ"} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setFinalizationEntryError(null); setFinalizationEntry(finalizationEntry === "REPORT" ? "CHOICE" : null); } }}><small>ΤΕΛΟΣ ΑΓΩΝΑ</small>{finalizationEntry === "CHOICE" ? <><h2>ΟΛΟΚΛΗΡΩΣΗ ΑΓΩΝΑ</h2><p>Επιλέξτε αν ο αγώνας θα ολοκληρωθεί χωρίς ή με αναφορά συμβάντων.</p><div className="live-finalization-entry-actions"><button type="button" className="is-primary" disabled={busy} onClick={() => void finalizeCurrentMatch(null)}>ΟΡΙΣΤΙΚΗ ΤΟΠΙΚΗ ΟΛΟΚΛΗΡΩΣΗ</button><button type="button" disabled={busy} onClick={() => { setFinalizationEntryError(null); setFinalizationEntry("REPORT"); }}>ΑΝΑΦΟΡΑ ΣΥΜΒΑΝΤΩΝ</button></div></> : <><h2>ΑΝΑΦΟΡΑ ΣΥΜΒΑΝΤΩΝ</h2><p>Η αναφορά θα συνοδεύει τον οριστικά ολοκληρωμένο αγώνα.</p><textarea autoFocus maxLength={INCIDENT_REPORT_MAX_LENGTH} value={incidentReportDraft} onChange={(event) => { setIncidentReportDraft(event.target.value); setFinalizationEntryError(null); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setFinalizationEntryError(null); setFinalizationEntry("CHOICE"); } else { event.stopPropagation(); } }} aria-label="Κείμενο αναφοράς συμβάντων" /><span className="live-incident-report-count">{incidentReportDraft.length.toLocaleString("el-GR")} / {INCIDENT_REPORT_MAX_LENGTH.toLocaleString("el-GR")}</span><div className="live-finalization-entry-actions"><button type="button" disabled={busy} onClick={() => { setFinalizationEntryError(null); setFinalizationEntry("CHOICE"); }}>ΠΙΣΩ</button><button type="button" className="is-primary" disabled={busy} onClick={() => void finalizeCurrentMatch(incidentReportDraft)}>ΟΡΙΣΤΙΚΗ ΟΛΟΚΛΗΡΩΣΗ</button></div></>}{finalizationEntryError ? <div className="live-finalization-entry-error" role="alert">{finalizationEntryError}</div> : null}</section></div> : null}
        {clockEditing ? <div className="live-modal-backdrop"><form className="live-modal live-clock-editor" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setClockEditError(null); setClockEditing(false); } }} onSubmit={async (event) => { event.preventDefault(); if (clockEditSubmittingRef.current || busy) return; const validation = validateLiveClockCorrection(clockInput, maximumClockSeconds); if (validation.error) { setClockEditError(validation.error); return; } clockEditSubmittingRef.current = true; setClockEditSubmitting(true); setClockEditError(null); try { const next = await appendIntent({ kind: "clock-set", remainingSeconds: validation.remainingSeconds }); if (next) setClockEditing(false); else setClockEditError("Η διόρθωση ρολογιού απορρίφθηκε."); } finally { clockEditSubmittingRef.current = false; setClockEditSubmitting(false); } }}><h2>Διόρθωση ρολογιού</h2><input autoFocus value={clockInput} onChange={(event) => { setClockInput(event.target.value); setClockEditError(null); }} aria-label="Χρόνος ΛΛ:ΔΔ" />{clockEditError ? <p className="live-clock-edit-error" role="alert">{clockEditError}</p> : null}<div><button type="button" disabled={clockEditSubmitting} onClick={() => { setClockEditError(null); setClockEditing(false); }}>Ακύρωση</button><button type="submit" disabled={clockEditSubmitting}>{clockEditSubmitting ? "ΕΦΑΡΜΟΓΗ..." : "ΕΦΑΡΜΟΓΗ"}</button></div></form></div> : null}
        {statusTeam ? <div className="live-modal-backdrop"><section className="live-status-overlay" style={teamColorStyle(team(statusTeam))}><header><div><small>{statusTeam}</small><h2>{team(statusTeam).teamName}</h2><p>COACH · {team(statusTeam).discipline.headCoachCategory1TechnicalCount}T{team(statusTeam).discipline.headCoachDisqualified ? " · DQ" : ""} &nbsp; BENCH · {team(statusTeam).discipline.benchCategory1TechnicalCount}T{team(statusTeam).discipline.disqualifiedBenchCount ? ` · ${team(statusTeam).discipline.disqualifiedBenchCount} DQ` : ""}</p></div><button type="button" onClick={() => setStatusTeam(null)}>Κλείσιμο</button></header><div className="live-status-table"><div className="is-head"><span>#</span><span>Παίκτης</span><span>Κατάσταση</span><span>PTS</span><span>2PTS</span><span>3PTS</span><span>1PTS</span><span>REB</span><span>AST</span><span>STL</span><span>BLK</span><span>TO</span><span>F</span><span>EFF</span></div>{team(statusTeam).players.map((player) => {
            const statistics = liveStatusPlayerStatistics(player.statistics);
            return <div key={player.playerId}><b>{player.shirtNumber}</b><strong>{player.displayName}</strong><span>{player.onCourt ? "Στο παρκέ" : player.fouls.status === "ELIGIBLE" ? "Πάγκος" : player.fouls.status}</span><span>{statistics.points}</span><span>{statistics.twoPoints}</span><span>{statistics.threePoints}</span><span>{statistics.freeThrows}</span><span>{statistics.rebounds}</span><span>{statistics.assists}</span><span>{statistics.steals}</span><span>{statistics.blocks}</span><span>{statistics.turnovers}</span><span>{player.fouls.total}</span><span>{statistics.efficiency}</span></div>;
        })}</div></section></div> : null}
        {selectedLogEvent ? <div className="live-modal-backdrop"><section className="live-event-editor"><small>{periodText(selectedLogEvent.period)} · {formatLiveClock(selectedLogEvent.clockSeconds)} · #{selectedLogEvent.sequence}</small><h2>{gameplayEventLabel(selectedLogEvent, gameplay)}</h2><p>Η διόρθωση επαναλαμβάνει deterministically όλο το αποθηκευμένο ιστορικό. Εξαρτώμενα συμβάντα απαιτούν ρητή επιβεβαίωση.</p><div><button type="button" onClick={() => setSelectedLogEvent(null)}>Κλείσιμο</button>{selectedLogEvent.intent ? <button type="button" onClick={() => void quickCorrect(selectedLogEvent)}>{selectedLogEvent.intent.kind === "shot" || selectedLogEvent.intent.kind === "free-throw" ? "Αλλαγή εύστοχο/άστοχο" : "Νέα ροή διόρθωσης"}</button> : null}{selectedLogEvent.type !== "MATCH_START" ? <button type="button" className="is-danger" onClick={() => void removeEvent(selectedLogEvent)}>Αφαίρεση</button> : null}</div></section></div> : null}
    </main>;
}
