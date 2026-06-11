// Quick "are these two messages substantively the same thing?" check.
//
// Used when a turn can produce multiple text segments (pre-tool narration +
// final answer) and weaker models — gemini-flash et al. — restate the same
// content in both. The exact-equality check that lives next to the send call
// doesn't catch that because the paraphrases differ by a word or two.
//
// Jaccard on significant words (≥ 4 chars, lowercased, accent-stripped,
// punctuation stripped) — plus a "shorter-is-mostly-inside-longer" guard for
// the case where one segment is essentially a more verbose version of the
// other.

function normalizeWords(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/**
 * Return true when `a` and `b` look like paraphrases of the same message:
 *   - Jaccard ≥ 0.4 on the significant-word sets, OR
 *   - ≥ 70% of the shorter message's significant words appear in the longer.
 *
 * Two very short inputs (< 3 significant words) are treated as "not enough
 * signal" and never flagged as duplicates — we don't want to merge two real
 * one-word replies like "Listo." / "Hecho.".
 */
export function isLikelyDuplicate(a, b) {
  if (!a || !b) return false;
  const wa = normalizeWords(a);
  const wb = normalizeWords(b);
  if (wa.length < 3 || wb.length < 3) return false;

  const setA = new Set(wa);
  const setB = new Set(wb);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = setA.size + setB.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  if (jaccard >= 0.4) return true;

  // Shorter-as-subset: if 70%+ of the shorter message's significant words
  // are present in the longer one, treat as the same content restated.
  const [smaller, bigger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let contained = 0;
  for (const w of smaller) if (bigger.has(w)) contained += 1;
  return contained / smaller.size >= 0.7;
}
