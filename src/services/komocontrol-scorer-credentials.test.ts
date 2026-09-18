import { beforeAll, describe, expect, it } from "vitest";

import { createScorerPasswordHash, verifyScorerPassword } from "./komocontrol-scorer-credentials";

const PASSWORD = "synthetic-scorer-password";
let currentHash: string;

beforeAll(async () => {
  currentHash = await createScorerPasswordHash(PASSWORD);
});

describe("KomoControl scorer password credentials", () => {
  it("creates the existing four-field format with 100,000 iterations and unchanged key sizes", () => {
    const fields = currentHash.split("$");
    expect(fields).toHaveLength(4);
    expect(fields.slice(0, 2)).toEqual(["pbkdf2-sha256", "100000"]);
    expect(atob(fields[2]).length).toBe(16);
    expect(atob(fields[3]).length).toBe(32);
  });

  it("verifies the correct password", async () => {
    expect(await verifyScorerPassword(PASSWORD, currentHash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    expect(await verifyScorerPassword("incorrect-password", currentHash)).toBe(false);
  });

  it("continues to generate a fresh random salt for each credential", async () => {
    const secondHash = await createScorerPasswordHash(PASSWORD);
    expect(secondHash.split("$")[2] === currentHash.split("$")[2]).toBe(false);
    expect(secondHash === currentHash).toBe(false);
  });

  it("verifies legacy 600,000-iteration credentials using the stored iteration count", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(PASSWORD), "PBKDF2", false, ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, key, 256,
    );
    const saltText = btoa(String.fromCharCode(...salt));
    const hashText = btoa(String.fromCharCode(...new Uint8Array(bits)));
    const legacyHash = `pbkdf2-sha256$600000$${saltText}$${hashText}`;

    expect(await verifyScorerPassword(PASSWORD, legacyHash)).toBe(true);
    expect(await verifyScorerPassword("incorrect-password", legacyHash)).toBe(false);
    expect(await verifyScorerPassword(PASSWORD, legacyHash.replace("$600000$", "$100000$"))).toBe(false);
  });

  it.each(["", "0", "-1", "1", "50000", "100001", "600001", "999999999999999999", "NaN", "Infinity", "100000.5"])(
    "rejects unsupported or malformed iteration count %j safely",
    async (iterations) => {
      const fields = currentHash.split("$");
      fields[1] = iterations;
      expect(await verifyScorerPassword(PASSWORD, fields.join("$"))).toBe(false);
    },
  );

  it.each([
    ["empty credential", ""],
    ["unstructured credential", "malformed"],
    ["missing salt and key", "pbkdf2-sha256$100000"],
    ["invalid Base64", "pbkdf2-sha256$100000$!$!"],
  ])("rejects %s without throwing", async (_label, malformed) => {
    expect(await verifyScorerPassword(PASSWORD, malformed)).toBe(false);
  });

  it("rejects a changed algorithm, extra fields, invalid salt length and invalid key length", async () => {
    const fields = currentHash.split("$");
    const malformed = [
      ["pbkdf2-sha512", ...fields.slice(1)].join("$"),
      `${currentHash}$extra`,
      [fields[0], fields[1], btoa("short"), fields[3]].join("$"),
      [fields[0], fields[1], fields[2], btoa("short")].join("$"),
    ];
    for (const credential of malformed) {
      expect(await verifyScorerPassword(PASSWORD, credential)).toBe(false);
    }
  });
});
