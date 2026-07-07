// Fuzzy answer matching for hard (text-entry) mode.
// Accent-insensitive, punctuation-insensitive, with a small typo tolerance.
//
// Note: a typed guess is only ever checked against the CORRECT answer's set of
// accepted strings, so being generous here can only forgive a sloppy-but-close
// correct answer — it can never mark a wrong country right.

export function normalize(s) {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// accepted: array of acceptable answer strings (canonical + any aliases).
export function fuzzyMatch(guess, accepted) {
  const g = normalize(guess);
  if (g.length < 2) return false;
  for (const raw of accepted) {
    const t = normalize(raw);
    if (!t) continue;
    if (g === t) return true;
    // whole-word prefix either direction (lets "Bosnia" match "Bosnia and…")
    if (g.length >= 4 && (t.startsWith(g) || g.startsWith(t))) return true;
    // small typo tolerance that scales with word length
    const threshold = Math.max(1, Math.floor(t.length / 5));
    if (levenshtein(g, t) <= threshold) return true;
  }
  return false;
}
