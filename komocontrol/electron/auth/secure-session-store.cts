import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AuthFlowError } from "./auth-contracts.cjs";
export interface SessionCipher { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; }
export class SecureSessionStore {
    readonly sessionPath: string; private readonly cipher: SessionCipher;
    constructor(sessionPath: string, cipher: SessionCipher) { this.sessionPath = sessionPath; this.cipher = cipher; }
    isAvailable(): boolean { return this.cipher.isEncryptionAvailable(); }
    hasSession(): boolean { return fs.existsSync(this.sessionPath); }
    saveToken(token: string): void {
        this.requireEncryption(); if (!token) throw new AuthFlowError("LOCAL_SESSION_ERROR");
        const encrypted = this.cipher.encryptString(token); const directory = path.dirname(this.sessionPath); const temporaryPath = path.join(directory, `.session-${randomUUID()}.tmp`);
        fs.mkdirSync(directory, { recursive: true }); let descriptor: number | null = null;
        try { descriptor = fs.openSync(temporaryPath, "wx", 0o600); fs.writeFileSync(descriptor, encrypted); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = null; fs.renameSync(temporaryPath, this.sessionPath); }
        catch { if (descriptor !== null) fs.closeSync(descriptor); if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true }); throw new AuthFlowError("LOCAL_SESSION_ERROR"); }
    }
    loadToken(): string | null {
        if (!this.hasSession()) return null; this.requireEncryption();
        try { const token = this.cipher.decryptString(fs.readFileSync(this.sessionPath)); if (!token) throw new Error("Empty secure session."); return token; }
        catch { try { this.clearSession(); } catch { throw new AuthFlowError("LOCAL_SESSION_ERROR"); } throw new AuthFlowError("SESSION_INVALID"); }
    }
    clearSession(): void { try { fs.rmSync(this.sessionPath, { force: true }); } catch { throw new AuthFlowError("LOCAL_SESSION_ERROR"); } }
    private requireEncryption(): void { if (!this.cipher.isEncryptionAvailable()) throw new AuthFlowError("SECURE_STORAGE_UNAVAILABLE"); }
}
