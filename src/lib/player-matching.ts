const greeklishMap: Record<string, string> = {
  a: "α", b: "β", c: "κ", d: "δ", e: "ε", f: "φ", g: "γ", h: "η",
  i: "ι", j: "τζ", k: "κ", l: "λ", m: "μ", n: "ν", o: "ο", p: "π",
  q: "κ", r: "ρ", s: "σ", t: "τ", u: "υ", v: "β", w: "ω", x: "ξ",
  y: "υ", z: "ζ",
};

function transliterate(value: string) {
  return value.replace(/[a-z]/g, (letter) => greeklishMap[letter] ?? letter);
}

export function normalizePlayerName(value: string) {
  return transliterate(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("el-GR")
      .replace(/ς/g, "σ")
      .replace(/[^a-zα-ω0-9]+/g, " ")
      .trim(),
  )
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "el"))
    .join(" ");
}

function levenshtein(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

export function playerNameSimilarity(left: string, right: string) {
  const a = normalizePlayerName(left);
  const b = normalizePlayerName(right);
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - levenshtein(a, b) / longest : 0;
}

export function findAutomaticPlayerMatch<T extends { displayName: string }>(
  name: string,
  candidates: T[],
) {
  const normalized = normalizePlayerName(name);
  const exact = candidates.find(
    (candidate) => normalizePlayerName(candidate.displayName) === normalized,
  );
  if (exact) return { candidate: exact, confidence: 1, reason: "normalized_exact" };

  let best: T | undefined;
  let confidence = 0;
  for (const candidate of candidates) {
    const score = playerNameSimilarity(name, candidate.displayName);
    if (score > confidence) {
      best = candidate;
      confidence = score;
    }
  }

  return best && confidence >= 0.88
    ? { candidate: best, confidence, reason: "fuzzy_automatic" }
    : null;
}

export function createEntityId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
