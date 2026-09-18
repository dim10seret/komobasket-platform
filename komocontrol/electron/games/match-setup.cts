import { createHash } from "node:crypto";
import type { DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { StoredLocalGamePackage } from "../persistence/local-database.cjs";
import { GamePackageFlowError, validateGamePackagePayload, type GamePackageErrorCode, type GamePackageV1Official, type GamePackageV1Officials, type GamePackageV1Player, type GamePackageV1StaffMember, type GamePackageV1Team } from "./game-package-download.cjs";

export interface MatchSetupPlayer { playerId: string; displayName: string; photoUrl: string | null; shirtNumber: number | null; }
export interface MatchSetupStaffMember { staffId: string; displayName: string; role: string; roleLabel: string | null; }
export interface MatchSetupTeam { side: "HOME" | "AWAY"; teamId: string; teamName: string; logoUrl: string | null; players: MatchSetupPlayer[]; staff: MatchSetupStaffMember[]; }
export interface MatchSetupOfficial { id: string; displayName: string; }
export interface MatchSetupOfficials { referees: { a: MatchSetupOfficial | null; b: MatchSetupOfficial | null; c: MatchSetupOfficial | null }; table: { timer: MatchSetupOfficial | null; shotClock: MatchSetupOfficial | null; scoresheet: MatchSetupOfficial | null; commissioner: MatchSetupOfficial | null }; }
export interface MatchSetup {
    gameId: string; packageId: string; packageVersion: number; competitionName: string; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null;
    settings: { gameMode: "SIMPLE" | "FULL"; minPlayers: number; maxPlayers: number; startingPlayers: number; regulationPeriods: number; regulationPeriodSeconds: number; overtimeSeconds: number; tieAllowed: boolean; winnerRequired: boolean; };
    officials: MatchSetupOfficials;
    home: MatchSetupTeam; away: MatchSetupTeam;
}
export type MatchSetupOperationResult = { ok: true; setup: MatchSetup; state: DesktopAuthState } | { ok: false; errorCode: GamePackageErrorCode | "SESSION_INVALID" | "RUN_UNAVAILABLE" | "RUN_INVALID" | "RUN_CONFLICT" | "RUN_OWNERSHIP_CONFLICT"; state: DesktopAuthState };
export interface MatchSetupPackageStore { readCurrentGamePackage(gameId: string): StoredLocalGamePackage | null; readGamePackage(packageId: string): StoredLocalGamePackage | null; }
export interface VerifiedMatchSetupSource { setup: MatchSetup; packageHash: string; packageSchemaVersion: 1; }

function comparePlayers(left: GamePackageV1Player, right: GamePackageV1Player): number {
    if (left.shirtNumber === null && right.shirtNumber !== null) return 1;
    if (left.shirtNumber !== null && right.shirtNumber === null) return -1;
    if (left.shirtNumber !== null && right.shirtNumber !== null && left.shirtNumber !== right.shirtNumber) return left.shirtNumber - right.shirtNumber;
    return left.displayName.localeCompare(right.displayName, "el", { sensitivity: "base" }) || left.id.localeCompare(right.id);
}
function mapPlayer(player: GamePackageV1Player): MatchSetupPlayer { return { playerId: player.id, displayName: player.displayName, photoUrl: player.photoUrl, shirtNumber: player.shirtNumber }; }
function mapStaff(member: GamePackageV1StaffMember): MatchSetupStaffMember { return { staffId: member.id, displayName: member.displayName, role: member.role, roleLabel: member.roleLabel }; }
function mapOfficial(value: GamePackageV1Official | null): MatchSetupOfficial | null { return value === null ? null : { id: value.id, displayName: value.displayName }; }
function mapOfficials(value: GamePackageV1Officials | undefined): MatchSetupOfficials { if (!value) return { referees: { a: null, b: null, c: null }, table: { timer: null, shotClock: null, scoresheet: null, commissioner: null } }; return { referees: { a: mapOfficial(value.referees.a), b: mapOfficial(value.referees.b), c: mapOfficial(value.referees.c) }, table: { timer: mapOfficial(value.table.timer), shotClock: mapOfficial(value.table.shotClock), scoresheet: mapOfficial(value.table.scoresheet), commissioner: mapOfficial(value.table.commissioner) } }; }
function mapTeam(team: GamePackageV1Team): MatchSetupTeam { return { side: team.side, teamId: team.id, teamName: team.name, logoUrl: team.logoUrl, players: [...team.players].sort(comparePlayers).map(mapPlayer), staff: team.staff.map(mapStaff) }; }

export class MatchSetupManager {
    constructor(private readonly packages: MatchSetupPackageStore) {}
    getMatchSetup(gameId: string): MatchSetup {
        const normalizedGameId = gameId.trim();
        if (!normalizedGameId) throw new GamePackageFlowError("PACKAGE_INVALID");
        const stored = this.packages.readCurrentGamePackage(normalizedGameId);
        if (!stored) throw new GamePackageFlowError("PACKAGE_UNAVAILABLE");
        return this.verifyStoredPackage(stored, normalizedGameId).setup;
    }
    getVerifiedMatchSetupSource(gameId: string): VerifiedMatchSetupSource {
        const normalizedGameId = gameId.trim();
        if (!normalizedGameId) throw new GamePackageFlowError("PACKAGE_INVALID");
        const stored = this.packages.readCurrentGamePackage(normalizedGameId);
        if (!stored) throw new GamePackageFlowError("PACKAGE_UNAVAILABLE");
        return this.verifyStoredPackage(stored, normalizedGameId);
    }
    getVerifiedPackageMatchSetup(packageId: string): VerifiedMatchSetupSource {
        const stored = this.packages.readGamePackage(packageId);
        if (!stored) throw new GamePackageFlowError("PACKAGE_UNAVAILABLE");
        return this.verifyStoredPackage(stored, stored.gameId);
    }
    private verifyStoredPackage(stored: StoredLocalGamePackage, expectedGameId: string): VerifiedMatchSetupSource {
        if (stored.packageSchemaVersion !== 1) throw new GamePackageFlowError("PACKAGE_UNSUPPORTED");
        const calculatedHash = createHash("sha256").update(Buffer.from(stored.payloadJson, "utf8")).digest("hex");
        if (calculatedHash !== stored.payloadHash.toLowerCase()) throw new GamePackageFlowError("PACKAGE_HASH_MISMATCH");
        let payload: unknown;
        try { payload = JSON.parse(stored.payloadJson); } catch { throw new GamePackageFlowError("PACKAGE_INVALID"); }
        validateGamePackagePayload(payload, expectedGameId);
        const home = payload.teams.find((team) => team.side === "HOME");
        const away = payload.teams.find((team) => team.side === "AWAY");
        if (!home || !away) throw new GamePackageFlowError("PACKAGE_INVALID");
        const setup: MatchSetup = {
            gameId: payload.game.id, packageId: stored.packageId, packageVersion: stored.packageVersion, competitionName: payload.game.competitionName, seasonName: payload.game.seasonName, phaseName: payload.game.phaseName, roundLabel: payload.game.roundLabel, scheduledDate: payload.game.scheduledDate, scheduledTime: payload.game.scheduledTime, venue: payload.game.venue,
            settings: { gameMode: payload.settings.game_mode, minPlayers: payload.settings.min_players, maxPlayers: payload.settings.max_players, startingPlayers: payload.settings.starting_players, regulationPeriods: payload.settings.regulation_periods, regulationPeriodSeconds: payload.settings.regulation_period_seconds, overtimeSeconds: payload.settings.overtime_seconds, tieAllowed: payload.settings.tie_allowed, winnerRequired: payload.settings.winner_required },
            officials: mapOfficials(payload.officials),
            home: mapTeam(home), away: mapTeam(away),
        };
        return { setup, packageHash: stored.payloadHash, packageSchemaVersion: 1 };
    }
}
export function matchSetupErrorCode(error: unknown): GamePackageErrorCode { return error instanceof GamePackageFlowError ? error.code : "PACKAGE_INVALID"; }
