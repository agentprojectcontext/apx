// Post-session memory consolidation.
//
// THE GAP THIS CLOSES: self-memory.js has always claimed the notebook is
// "refreshed by skimming its own recent sessions". That function did not
// exist. Today a durable fact only reaches ~/.apx/memory.md if the model
// happens to call `remember` in the moment. The RAG index and the compactor
// are automatic, but those are RETRIEVAL, not learning.
//
// THE DANGER, which is bigger than the gap: memory.md is injected into every
// prompt on every channel. A notebook that grows without judgement is a
// permanent tax paid on every turn for facts nobody needed. So the whole
// design here leans one way — when in doubt, do not save.
//
// Three deliberate constraints:
//
//   1. CANDIDATES, NOT WRITES, by default. `apx memory consolidate` proposes;
//      writing is a separate, explicit step. A background job that silently
//      edits the file the agent believes about itself is not something to
//      switch on by default.
//   2. DEDUP AGAINST WHAT IS ALREADY THERE. The same fact learned three times
//      is one fact.
//   3. EVERY WRITE IS TAGGED AND REVERSIBLE. Consolidated bullets carry a
//      marker so `revert` can remove exactly what a run added and nothing the
//      user or the model wrote by hand.
import { readSelfMemory, appendSelfMemory, parseSelfMemoryEntries, SELF_MEMORY_PATH } from "#core/agent/self-memory.js";
import fs from "node:fs";

/** Marks a bullet as machine-distilled, so a revert can find its own writes. */
export const CONSOLIDATED_CHANNEL = "consolidated";

/** Conservative by design — see the header. */
export const DEFAULT_LIMITS = Object.freeze({
  /** Never propose more than this from one run. A day is not a biography. */
  max_candidates: 5,
  /** Below this, a line is chatter, not a fact. */
  min_chars: 20,
  /** Above this it is a paragraph; the notebook holds one-liners. */
  max_chars: 240,
  /**
   * Jaccard overlap at which two facts are "the same fact".
   *
   * Set low on purpose. The two errors here are not symmetric: calling a new
   * fact a duplicate costs one thing not saved, which the model can say again
   * tomorrow. Calling a duplicate new costs a permanent second copy in a file
   * that ships on every turn of every channel. So it errs toward dedup — real
   * paraphrases ("instead of npm" / "rather than npm") land around 0.55.
   */
  dedup_threshold: 0.5,
});

/**
 * Openers that mark a durable fact about how someone works or what they
 * decided, as opposed to a transient exchange. Matching on shape rather than
 * meaning keeps this deterministic and testable — the model does the
 * distilling upstream; this decides what is worth keeping.
 */
const DURABLE_MARKERS = [
  /\b(prefer|prefers|prefiere|prefiero)\b/i,
  /\b(decided|decidimos|decidí|decision)\b/i,
  /\b(always|never|siempre|nunca)\b/i,
  /\b(uses?|usa|usamos)\b.*\b(instead of|en vez de)\b/i,
  /\b(works? (?:on|at)|trabaja en)\b/i,
  /\b(deadline|vence|due)\b/i,
  /\b(rule|regla|convention|convención)\b/i,
];

/** Things that look like facts but age out within a day. */
const TRANSIENT_MARKERS = [
  /\b(today|hoy|right now|ahora mismo|esta mañana|this morning)\b/i,
  /\b(will (?:check|look)|voy a (?:ver|revisar))\b/i,
  /^\s*(ok|okay|dale|listo|thanks|gracias|perfecto)\b/i,
];

/** Words that carry meaning, lowercased, for overlap comparison. */
function tokenise(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/** Jaccard overlap. 1 = identical vocabulary, 0 = nothing in common. */
export function similarity(a, b) {
  const A = tokenise(a);
  const B = tokenise(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/** Is this line worth keeping past today? */
export function looksDurable(text, limits = DEFAULT_LIMITS) {
  const s = String(text || "").trim();
  if (s.length < limits.min_chars || s.length > limits.max_chars) return false;
  if (TRANSIENT_MARKERS.some((re) => re.test(s))) return false;
  return DURABLE_MARKERS.some((re) => re.test(s));
}

/**
 * Propose durable facts from a batch of candidate lines.
 *
 * The caller supplies the lines — from a model's distillation of a session, or
 * from anywhere else. This module owns the JUDGEMENT about what survives, so
 * the same rules apply no matter who is proposing.
 *
 * @param {string[]} candidates
 * @param {object} opts  { existing?: string, limits?, now? }
 * @returns {{ kept: string[], rejected: {text: string, reason: string}[] }}
 */
export function proposeConsolidation(candidates, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const existingText = opts.existing !== undefined ? opts.existing : readSelfMemory();
  const known = parseSelfMemoryEntries(existingText).map((e) => e.text);

  const kept = [];
  const rejected = [];

  for (const raw of candidates || []) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    if (kept.length >= limits.max_candidates) {
      rejected.push({ text, reason: "over the per-run limit" });
      continue;
    }
    if (!looksDurable(text, limits)) {
      rejected.push({ text, reason: "not durable" });
      continue;
    }

    // Against what is already saved AND against what this run already kept —
    // a session that says the same thing twice must not save it twice.
    const clash = [...known, ...kept].find((k) => similarity(k, text) >= limits.dedup_threshold);
    if (clash) {
      rejected.push({ text, reason: `already known: "${clash.slice(0, 60)}"` });
      continue;
    }

    kept.push(text);
  }

  return { kept, rejected };
}

/**
 * Write accepted facts to the notebook, tagged so they can be reverted.
 * Separate from proposing on purpose: the decision to write is the user's.
 */
export function applyConsolidation(facts, opts = {}) {
  const written = [];
  for (const text of facts || []) {
    appendSelfMemory(text, { channel: CONSOLIDATED_CHANNEL, ...(opts.time ? { time: opts.time } : {}) });
    written.push(text);
  }
  return { written, path: SELF_MEMORY_PATH };
}

/**
 * Undo consolidation: drop bullets this module wrote, leaving everything the
 * user or the model wrote by hand exactly where it is.
 *
 * @param {object} opts  { since?: "YYYY-MM-DD" } — only that day and after.
 * @returns {{ removed: number, path: string }}
 */
export function revertConsolidation(opts = {}) {
  const text = readSelfMemory();
  if (!text.trim()) return { removed: 0, path: SELF_MEMORY_PATH };

  const since = opts.since || "";
  const lines = text.split("\n");
  const out = [];
  let day = "";
  let removed = 0;

  for (const line of lines) {
    const h = line.trim().match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (h) { day = h[1]; out.push(line); continue; }

    // Only ever removes a bullet carrying OUR channel tag. A hand-written note
    // that happens to sit next to one is untouched.
    const isOurs = /^[-*]\s+(?:\[[^\]]+\]\s*)?\[consolidated\]\s/i.test(line.trim());
    if (isOurs && (!since || day >= since)) {
      removed += 1;
      continue;
    }
    out.push(line);
  }

  if (removed) {
    fs.writeFileSync(SELF_MEMORY_PATH, stripEmptyDays(out).join("\n"));
  }
  return { removed, path: SELF_MEMORY_PATH };
}

/** Drop day headings left with no bullets under them. Shared with prune.js. */
export function stripEmptyDays(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const isHeading = /^##\s+\d{4}-\d{2}-\d{2}/.test(lines[i].trim());
    if (!isHeading) { out.push(lines[i]); continue; }
    let hasBullet = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s+/.test(lines[j].trim())) break;
      if (/^[-*]\s+\S/.test(lines[j].trim())) { hasBullet = true; break; }
    }
    if (hasBullet) out.push(lines[i]);
  }
  return out;
}

/** How much of the prompt budget the notebook is currently costing. */
export function notebookSize() {
  const text = readSelfMemory();
  const entries = parseSelfMemoryEntries(text);
  return {
    chars: text.length,
    approx_tokens: Math.ceil(text.length / 4),
    entries: entries.length,
    consolidated: entries.filter((e) => e.channel === CONSOLIDATED_CHANNEL).length,
  };
}
