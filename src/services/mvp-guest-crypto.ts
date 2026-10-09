import "server-only";

export const MVP_GUEST_PROTOCOL_VERSION = 1;
export const MVP_CHALLENGE_TTL_SECONDS = 120;

export type MvpGuestAction = "register" | "vote";
export type MvpChallengeBinding = {
  action: MvpGuestAction;
  contestId: string;
  candidateId: string;
  credentialId: string;
  publicKeySha256: string;
  challenge: string;
};

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

export function decodeBase64url(value: string, maxBytes: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new Error("INVALID_ENCODING");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  if (bytes.length > maxBytes || base64url(bytes) !== value) throw new Error("INVALID_ENCODING");
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(bytes)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newChallenge(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Identical UTF-8 bytes are signed by the app key and hashed for Google requestHash. */
export function canonicalMvpChallenge(binding: MvpChallengeBinding): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([
    "komobasket-mvp-guest", MVP_GUEST_PROTOCOL_VERSION, binding.action, binding.contestId,
    binding.candidateId, binding.credentialId, binding.publicKeySha256, binding.challenge,
  ]));
}

export async function mvpRequestHash(binding: MvpChallengeBinding): Promise<string> {
  return sha256Hex(canonicalMvpChallenge(binding));
}

export async function parseP256PublicKey(publicKeySpki: string): Promise<{
  key: CryptoKey; sha256: string;
}> {
  const bytes = decodeBase64url(publicKeySpki, 256);
  if (bytes.length < 64) throw new Error("INVALID_PUBLIC_KEY");
  const key = await crypto.subtle.importKey("spki", arrayBuffer(bytes), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return { key, sha256: await sha256Hex(bytes) };
}

export async function verifyMvpSignature(publicKeySpki: string, signature: string,
  binding: MvpChallengeBinding): Promise<boolean> {
  try {
    const { key, sha256 } = await parseP256PublicKey(publicKeySpki);
    if (sha256 !== binding.publicKeySha256) return false;
    const bytes = decodeBase64url(signature, 64);
    if (bytes.length !== 64) return false; // P-1363 (r || s), not ASN.1 DER.
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      arrayBuffer(bytes), arrayBuffer(canonicalMvpChallenge(binding)));
  } catch { return false; }
}
