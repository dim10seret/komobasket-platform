import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AuthFlowError } from "./auth-contracts.cjs";
export interface SessionCipher { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; }
export interface AuthorizationEnvelopeV1 {
    schemaVersion: 1;
    opaqueToken: string;
    sessionId: string;
    scorerId: string;
    username: string;
    organizationId: string;
    organizationName: string;
    deviceId: string;
    validatedAtUtc: string;
    expiresAtUtc: string;
}
export type StoredAuthorization = { kind: "legacy"; token: string } | { kind: "envelope"; envelope: AuthorizationEnvelopeV1 };
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
function nonEmptyText(value: unknown, maximum = 300): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function utcTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function authorizationEnvelope(value: unknown): AuthorizationEnvelopeV1 {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AuthFlowError("SESSION_INVALID");
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== 1 || !nonEmptyText(item.opaqueToken, 100) || !TOKEN_PATTERN.test(item.opaqueToken)
        || !nonEmptyText(item.sessionId) || !nonEmptyText(item.scorerId) || !nonEmptyText(item.username, 100)
        || !nonEmptyText(item.organizationId) || !nonEmptyText(item.organizationName)
        || !nonEmptyText(item.deviceId) || !utcTimestamp(item.validatedAtUtc) || !utcTimestamp(item.expiresAtUtc)
        || Date.parse(item.validatedAtUtc) >= Date.parse(item.expiresAtUtc)) throw new AuthFlowError("SESSION_INVALID");
    return {
        schemaVersion: 1, opaqueToken: item.opaqueToken, sessionId: item.sessionId, scorerId: item.scorerId,
        username: item.username, organizationId: item.organizationId, organizationName: item.organizationName,
        deviceId: item.deviceId, validatedAtUtc: item.validatedAtUtc, expiresAtUtc: item.expiresAtUtc,
    };
}
export class SecureSessionStore {
    readonly sessionPath: string; private readonly cipher: SessionCipher;
    constructor(sessionPath: string, cipher: SessionCipher) { this.sessionPath = sessionPath; this.cipher = cipher; }
    isAvailable(): boolean { return this.cipher.isEncryptionAvailable(); }
    hasSession(): boolean { return fs.existsSync(this.sessionPath); }
    saveAuthorization(envelope: AuthorizationEnvelopeV1): void { this.saveEncrypted(JSON.stringify(authorizationEnvelope(envelope))); }
    saveToken(token: string): void { if (!TOKEN_PATTERN.test(token)) throw new AuthFlowError("LOCAL_SESSION_ERROR"); this.saveEncrypted(token); }
    loadAuthorization(): StoredAuthorization | null {
        if (!this.hasSession()) return null; this.requireEncryption();
        try {
            const decrypted = this.cipher.decryptString(fs.readFileSync(this.sessionPath));
            if (TOKEN_PATTERN.test(decrypted)) return { kind: "legacy", token: decrypted };
            return { kind: "envelope", envelope: authorizationEnvelope(JSON.parse(decrypted)) };
        } catch { try { this.clearSession(); } catch { throw new AuthFlowError("LOCAL_SESSION_ERROR"); } throw new AuthFlowError("SESSION_INVALID"); }
    }
    loadToken(): string | null { const authorization = this.loadAuthorization(); return authorization?.kind === "legacy" ? authorization.token : authorization?.envelope.opaqueToken ?? null; }
    clearSession(): void { try { fs.rmSync(this.sessionPath, { force: true }); } catch { throw new AuthFlowError("LOCAL_SESSION_ERROR"); } }
    private saveEncrypted(value: string): void {
        this.requireEncryption();
        const encrypted = this.cipher.encryptString(value); const directory = path.dirname(this.sessionPath); const temporaryPath = path.join(directory, `.session-${randomUUID()}.tmp`);
        fs.mkdirSync(directory, { recursive: true }); let descriptor: number | null = null;
        try { descriptor = fs.openSync(temporaryPath, "wx", 0o600); fs.writeFileSync(descriptor, encrypted); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = null; fs.renameSync(temporaryPath, this.sessionPath); }
        catch { if (descriptor !== null) fs.closeSync(descriptor); if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true }); throw new AuthFlowError("LOCAL_SESSION_ERROR"); }
    }
    private requireEncryption(): void { if (!this.cipher.isEncryptionAvailable()) throw new AuthFlowError("SECURE_STORAGE_UNAVAILABLE"); }
}
