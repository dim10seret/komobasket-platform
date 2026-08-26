import type { SessionCipher } from "./secure-session-store.cjs";
import {
    LocalDatabase,
    type StoredLocalLiveRunAuthorization,
} from "../persistence/local-database.cjs";
import { deterministicJson, parseDeterministicJson } from "../runs/match-engine-bootstrap.cjs";

export interface LiveRunAuthorizationV1 {
    schemaVersion: 1;
    runId: string;
    gameId: string;
    packageId: string;
    packageVersion: number;
    packageHash: string;
    configurationRevision: number;
    configurationHash: string;
    initialStateHash: string;
    scorerId: string;
    organizationId: string;
    deviceId: string;
    startedAtUtc: string;
}

export interface LiveRunAuthorizationSealInput extends Omit<LiveRunAuthorizationV1, "schemaVersion"> {}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function requiredText(value: unknown, maximum = 300): string {
    if (typeof value !== "string" || !value.trim() || value.length > maximum) {
        throw new Error("Live Run authorization is invalid.");
    }
    return value;
}

function hash(value: unknown): string {
    const result = requiredText(value, 64);
    if (!/^[0-9a-f]{64}$/.test(result)) throw new Error("Live Run authorization hash is invalid.");
    return result;
}

function authorization(value: unknown): LiveRunAuthorizationV1 {
    const item = record(value);
    if (!item || item.schemaVersion !== 1) throw new Error("Live Run authorization schema is invalid.");
    const packageVersion = Number(item.packageVersion);
    const configurationRevision = Number(item.configurationRevision);
    const startedAtUtc = requiredText(item.startedAtUtc);
    if (!Number.isInteger(packageVersion) || packageVersion < 1 || !Number.isInteger(configurationRevision)
        || configurationRevision < 1 || !Number.isFinite(Date.parse(startedAtUtc))) {
        throw new Error("Live Run authorization version is invalid.");
    }
    return {
        schemaVersion: 1,
        runId: requiredText(item.runId),
        gameId: requiredText(item.gameId),
        packageId: requiredText(item.packageId),
        packageVersion,
        packageHash: hash(item.packageHash),
        configurationRevision,
        configurationHash: hash(item.configurationHash),
        initialStateHash: hash(item.initialStateHash),
        scorerId: requiredText(item.scorerId),
        organizationId: requiredText(item.organizationId),
        deviceId: requiredText(item.deviceId),
        startedAtUtc,
    };
}

export class LiveRunAuthorizationManager {
    constructor(
        private readonly database: LocalDatabase,
        private readonly cipher: SessionCipher,
        private readonly deviceId: string,
        private readonly now: () => Date = () => new Date(),
    ) {}

    isAvailable(): boolean {
        return this.cipher.isEncryptionAvailable();
    }

    seal(input: LiveRunAuthorizationSealInput): string {
        if (!this.isAvailable()) throw new Error("Secure Live Run authorization is unavailable.");
        const payload = authorization({ schemaVersion: 1, ...input });
        return this.cipher.encryptString(deterministicJson(payload)).toString("base64");
    }

    resolve(runId: string, includeSuspended = false): LiveRunAuthorizationV1 | null {
        const stored = this.database.readLocalLiveRunAuthorization(runId);
        if (!stored || (!includeSuspended && stored.suspended)) return null;
        return this.verifyStored(stored);
    }

    resolveForGame(gameId: string): LiveRunAuthorizationV1 | null {
        for (const stored of this.database.listLocalLiveRunAuthorizations(false)) {
            const resolved = this.verifyStored(stored);
            if (resolved.gameId === gameId) return resolved;
        }
        return null;
    }

    listAvailable(): LiveRunAuthorizationV1[] {
        return this.database.listLocalLiveRunAuthorizations(false).map((stored) => this.verifyStored(stored));
    }

    suspendOwner(organizationId: string, scorerId: string): number {
        return this.database.setLocalLiveRunAuthorizationsSuspended(
            organizationId,
            scorerId,
            this.deviceId,
            true,
            this.now().toISOString(),
        );
    }

    reactivateOwner(organizationId: string, scorerId: string): number {
        return this.database.setLocalLiveRunAuthorizationsSuspended(
            organizationId,
            scorerId,
            this.deviceId,
            false,
            this.now().toISOString(),
        );
    }

    private verifyStored(stored: StoredLocalLiveRunAuthorization): LiveRunAuthorizationV1 {
        if (!this.isAvailable()) throw new Error("Secure Live Run authorization is unavailable.");
        let payload: LiveRunAuthorizationV1;
        try {
            const plaintext = this.cipher.decryptString(Buffer.from(stored.encryptedAuthorization, "base64"));
            payload = authorization(parseDeterministicJson(plaintext));
        } catch {
            throw new Error("Secure Live Run authorization is corrupted.");
        }
        const run = this.database.readLocalGameRun(stored.runId);
        const snapshot = this.database.readLocalMatchEngineSnapshot(stored.runId);
        const configuration = this.database.readLocalGameRunConfiguration(stored.runId);
        if (!run || !snapshot || !configuration
            || payload.runId !== stored.runId
            || payload.runId !== run.runId
            || payload.gameId !== run.gameId
            || payload.packageId !== run.packageId
            || payload.packageVersion !== run.packageVersion
            || payload.packageHash !== run.packageHash
            || payload.configurationRevision !== snapshot.configurationRevision
            || configuration.revision < snapshot.configurationRevision
            || payload.configurationHash !== snapshot.configurationHash
            || payload.initialStateHash !== snapshot.initialStateHash
            || payload.scorerId !== run.scorerId
            || payload.organizationId !== run.organizationId
            || payload.deviceId !== run.deviceId
            || payload.deviceId !== this.deviceId
            || payload.startedAtUtc !== run.startedAtUtc) {
            throw new Error("Secure Live Run authorization binding is invalid.");
        }
        return payload;
    }
}
