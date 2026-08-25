import { createHash } from "node:crypto";
import { AuthFlowError, type AuthErrorCode, type DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { LocalGamePackageStatus, LocalGamePackageStoreResult, VerifiedGamePackageInput } from "../persistence/local-database.cjs";

export const GAME_PACKAGE_ERROR_CODES = ["PACKAGE_UNAVAILABLE", "PACKAGE_INVALID", "PACKAGE_HASH_MISMATCH", "PACKAGE_CONFLICT", "PACKAGE_UNSUPPORTED"] as const;
export type GamePackageErrorCode = (typeof GAME_PACKAGE_ERROR_CODES)[number];
export type GamePackageOperationErrorCode = AuthErrorCode | GamePackageErrorCode;
export interface GamePackageEnvelope { packageId: string; gameId: string; packageVersion: number; packageSchemaVersion: 1; publishedAt: string; payloadJson: string; payloadHash: string; }
export interface GamePackageV1Player { id: string; displayName: string; shirtNumber: number | null; photoUrl: string | null; }
export interface GamePackageV1StaffMember { id: string; displayName: string; role: string; roleLabel: string | null; }
export interface GamePackageV1Team { side: "HOME" | "AWAY"; id: string; name: string; logoUrl: string | null; players: GamePackageV1Player[]; staff: GamePackageV1StaffMember[]; }
export interface GamePackageV1 {
    schemaVersion: 1;
    game: { id: string; organizationId: string; competitionId: string; competitionName: string; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; scheduledAt: string | null; venue: string | null; };
    settings: { game_mode: "SIMPLE" | "FULL"; min_players: number; max_players: number; starting_players: number; regulation_periods: number; regulation_period_seconds: number; overtime_seconds: number; tie_allowed: boolean; winner_required: boolean; };
    teams: GamePackageV1Team[];
}
export type GamePackageDownloadResult = { ok: true; status: LocalGamePackageStatus; outcome: "stored" | "unchanged"; state: DesktopAuthState } | { ok: false; errorCode: GamePackageOperationErrorCode; state: DesktopAuthState };

interface PackageClient { downloadGamePackage(token: string, gameId: string): Promise<GamePackageEnvelope>; }
interface PackageStore { storeVerifiedGamePackage(value: VerifiedGamePackageInput): LocalGamePackageStoreResult; getCurrentGamePackageStatus(gameId: string): LocalGamePackageStatus; }

export class GamePackageFlowError extends Error {
    readonly code: GamePackageErrorCode;
    constructor(code: GamePackageErrorCode) { super(code); this.name = "GamePackageFlowError"; this.code = code; }
}

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim().length > 0 ? value : null; }
function nullableString(value: unknown): boolean { return value === null || typeof value === "string"; }
function nonNegativeInteger(value: unknown): boolean { return Number.isInteger(value) && Number(value) >= 0; }
function positiveInteger(value: unknown): boolean { return Number.isInteger(value) && Number(value) > 0; }

export function parseGamePackageEnvelope(value: unknown): GamePackageEnvelope {
    const item = record(value); const packageId = text(item?.packageId); const gameId = text(item?.gameId); const publishedAt = text(item?.publishedAt);
    if (!packageId || !gameId || !positiveInteger(item?.packageVersion) || item?.packageSchemaVersion !== 1 || !publishedAt || typeof item?.payloadJson !== "string" || !item.payloadJson.trim() || typeof item?.payloadHash !== "string" || !/^[0-9a-f]{64}$/.test(item.payloadHash)) throw new GamePackageFlowError("PACKAGE_INVALID");
    return { packageId, gameId, packageVersion: Number(item.packageVersion), packageSchemaVersion: 1, publishedAt, payloadJson: item.payloadJson, payloadHash: item.payloadHash };
}

function validateSettings(value: unknown): void {
    const item = record(value);
    if (!item || (item.game_mode !== "SIMPLE" && item.game_mode !== "FULL") || !nonNegativeInteger(item.min_players) || !positiveInteger(item.max_players) || !positiveInteger(item.starting_players) || !positiveInteger(item.regulation_periods) || !positiveInteger(item.regulation_period_seconds) || !positiveInteger(item.overtime_seconds) || typeof item.tie_allowed !== "boolean" || typeof item.winner_required !== "boolean") throw new GamePackageFlowError("PACKAGE_INVALID");
}
function validateTeam(value: unknown, expectedSide: "HOME" | "AWAY"): void {
    const item = record(value);
    if (!item || item.side !== expectedSide || !text(item.id) || !text(item.name) || !nullableString(item.logoUrl) || !Array.isArray(item.players) || !Array.isArray(item.staff)) throw new GamePackageFlowError("PACKAGE_INVALID");
    for (const value of item.players) { const player = record(value); if (!player || !text(player.id) || !text(player.displayName) || !(player.shirtNumber === null || nonNegativeInteger(player.shirtNumber)) || !nullableString(player.photoUrl)) throw new GamePackageFlowError("PACKAGE_INVALID"); }
    for (const value of item.staff) { const staff = record(value); if (!staff || !text(staff.id) || !text(staff.displayName) || !text(staff.role) || !nullableString(staff.roleLabel)) throw new GamePackageFlowError("PACKAGE_INVALID"); }
}
export function validateGamePackagePayload(payload: unknown, gameId: string): asserts payload is GamePackageV1 {
    const root = record(payload); const game = record(root?.game);
    if (!root || root.schemaVersion !== 1 || !game || game.id !== gameId || !text(game.organizationId) || !text(game.competitionId) || !text(game.competitionName) || !text(game.seasonName) || !nullableString(game.phaseName) || !nullableString(game.roundLabel) || !nullableString(game.scheduledDate) || !nullableString(game.scheduledTime) || !nullableString(game.scheduledAt) || !nullableString(game.venue)) throw new GamePackageFlowError("PACKAGE_INVALID");
    validateSettings(root.settings);
    if (!Array.isArray(root.teams) || root.teams.length !== 2) throw new GamePackageFlowError("PACKAGE_INVALID");
    const home = root.teams.filter((team) => record(team)?.side === "HOME"); const away = root.teams.filter((team) => record(team)?.side === "AWAY");
    if (home.length !== 1 || away.length !== 1) throw new GamePackageFlowError("PACKAGE_INVALID");
    validateTeam(home[0], "HOME"); validateTeam(away[0], "AWAY");
}

export function verifyDownloadedGamePackage(requestedGameId: string, value: unknown): VerifiedGamePackageInput {
    const envelope = parseGamePackageEnvelope(value);
    if (!requestedGameId.trim() || envelope.gameId !== requestedGameId) throw new GamePackageFlowError("PACKAGE_INVALID");
    const actualHash = createHash("sha256").update(Buffer.from(envelope.payloadJson, "utf8")).digest("hex");
    if (actualHash !== envelope.payloadHash) throw new GamePackageFlowError("PACKAGE_HASH_MISMATCH");
    let payload: unknown;
    try { payload = JSON.parse(envelope.payloadJson); } catch { throw new GamePackageFlowError("PACKAGE_INVALID"); }
    validateGamePackagePayload(payload, envelope.gameId);
    return { packageId: envelope.packageId, gameId: envelope.gameId, packageVersion: envelope.packageVersion, packageSchemaVersion: 1, payloadJson: envelope.payloadJson, payloadHash: envelope.payloadHash, publishedAtUtc: envelope.publishedAt };
}

export function gamePackageErrorCode(error: unknown): GamePackageOperationErrorCode {
    if (error instanceof GamePackageFlowError) return error.code;
    if (error instanceof AuthFlowError) return error.code;
    return "PACKAGE_CONFLICT";
}

export class GamePackageDownloadManager {
    private readonly active = new Set<string>();
    constructor(private readonly client: PackageClient, private readonly store: PackageStore) {}
    getStatus(gameId: string): LocalGamePackageStatus { return this.store.getCurrentGamePackageStatus(gameId); }
    async download(token: string, gameId: string): Promise<LocalGamePackageStoreResult> {
        if (this.active.has(gameId)) throw new GamePackageFlowError("PACKAGE_CONFLICT");
        this.active.add(gameId);
        try { const envelope = await this.client.downloadGamePackage(token, gameId); return this.store.storeVerifiedGamePackage(verifyDownloadedGamePackage(gameId, envelope)); }
        finally { this.active.delete(gameId); }
    }
}

export function packageOperationFailure(error: unknown, state: DesktopAuthState): GamePackageDownloadResult { return { ok: false, errorCode: gamePackageErrorCode(error), state }; }
