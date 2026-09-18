const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_ITERATIONS = 100_000;
const LEGACY_PASSWORD_ITERATIONS = 600_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BITS = 256;

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const ownedSalt = Uint8Array.from(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: ownedSalt, iterations },
    key,
    PASSWORD_HASH_BITS,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function normalizeScorerUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

export async function createScorerPasswordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
}

export async function verifyScorerPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText, ...extra] = storedHash.split("$");
  const iterations = Number(iterationsText);
  if (
    extra.length !== 0
    || algorithm !== PASSWORD_ALGORITHM
    || (iterations !== PASSWORD_ITERATIONS && iterations !== LEGACY_PASSWORD_ITERATIONS)
  ) {
    return false;
  }
  const salt = base64ToBytes(saltText);
  const expected = base64ToBytes(hashText);
  if (salt?.length !== PASSWORD_SALT_BYTES || expected?.length !== PASSWORD_HASH_BITS / 8) return false;
  const actual = await derivePassword(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}
