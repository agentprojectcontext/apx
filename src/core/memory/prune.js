// Pruning the notebook — collapse replicated entries, keep the newest.
//
// THE MESS THIS CLEANS: consolidate.js guards what gets IN going forward, but
// nothing ever looked back. A routine that called `remember` every day filled
// ~/.apx/memory.md with sixty near-identical weather bullets — sixty days of
// weather is zero facts. The remember handler now diverts that chatter at the
// source; this module removes what already accumulated.
//
// Deterministic on purpose (no LLM): the same file pruned twice gives the same
// answer, and what gets removed is explainable line by line. Two passes:
//
//   1. SERIES. Daily chatter varies in the middle (-8°C today, 1°C tomorrow)
//      but keeps its opening words ("Hoy en Bariloche hace…"). Entries on the
//      same channel sharing their normalized opener, appearing series_min+
//      times, are one habit, not N facts — the newest survives. The opener
//      alone is not enough: "Se agregó el MCP 'atlassian'" and "Se agregó el
//      MCP 'dokploy'" open identically and are two facts, so an older member
//      is only dropped when it also shares the TEMPLATE with another member
//      (digit-blind, all-words similarity ≥ series_sim).
//   2. NEAR-DUPLICATES. The same fact recorded twice anywhere (Jaccard ≥
//      near_dup, via consolidate's similarity) keeps only its newest copy.
//
// Like consolidate: propose by default, write only on request, and every write
// leaves a timestamped backup next to the file.
import fs from "node:fs";
import {
  readSelfMemory,
  parseSelfMemoryEntries,
  SELF_MEMORY_PATH,
} from "#core/agent/self-memory.js";
import { similarity, stripEmptyDays } from "./consolidate.js";

export const DEFAULT_PRUNE = Object.freeze({
  /** Same-opener entries on one channel before it counts as a series. */
  series_min: 3,
  /**
   * Jaccard overlap at which two entries are the same fact said twice. Higher
   * than consolidate's dedup_threshold (0.5) on purpose: consolidate declines
   * to ADD a maybe-duplicate, which costs nothing; prune DELETES, so it must
   * be surer.
   */
  near_dup: 0.75,
  /** Opening words that form a series signature. */
  opener_words: 4,
  /**
   * Template overlap (digit-blind, all words) an older series member must
   * share with SOME other member before it is dropped. Keeps same-opener but
   * different-fact entries ("Se agregó el MCP 'X'" / "…'Y'") apart.
   */
  series_sim: 0.5,
});

/**
 * The series fingerprint: first N words, lowercased, digits stripped so
 * temperatures, speeds and dates never break a match.
 */
function normalizedWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\p{N}]+/gu, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function openerSignature(text, words = DEFAULT_PRUNE.opener_words) {
  return normalizedWords(text).slice(0, words).join(" ");
}

/**
 * Quoted identifiers are the OBJECT of a note: "Se agregó el MCP 'dokploy'"
 * and "…'brightbean'" share their whole template yet record two facts. Two
 * entries whose quoted sets differ are never the same series member.
 */
function quotedIdentifiers(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/['"`]([^'"`]{1,80})['"`]/g)) {
    out.add(m[1].trim().toLowerCase());
  }
  return out;
}

function quotesConflict(a, b) {
  const A = quotedIdentifiers(a);
  const B = quotedIdentifiers(b);
  if (!A.size || !B.size) return false;
  if (A.size !== B.size) return true;
  for (const q of A) if (!B.has(q)) return true;
  return false;
}

/**
 * Template overlap: Jaccard over ALL normalized words, digits stripped. Unlike
 * consolidate's similarity (content words only), the skeleton words ("con",
 * "de", "y") count — a templated series shares its skeleton even when every
 * number and condition changes.
 */
function templateSimilarity(a, b) {
  const A = new Set(normalizedWords(a));
  const B = new Set(normalizedWords(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/**
 * Decide what a prune would remove. Pure — no filesystem.
 *
 * @param {string} text  the notebook body
 * @returns {{ entries: object[], removed: object[], kept: number }}
 *   `removed` entries carry the parser's `line` index into `text`.
 */
export function planPrune(text, opts = {}) {
  const cfg = { ...DEFAULT_PRUNE, ...(opts || {}) };
  const entries = parseSelfMemoryEntries(text); // oldest → newest
  const drop = new Set();

  // Pass 1 — series.
  const groups = new Map();
  entries.forEach((e, i) => {
    const sig = `${e.channel}|${openerSignature(e.text, cfg.opener_words)}`;
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(i);
  });
  for (const idxs of groups.values()) {
    if (idxs.length < cfg.series_min) continue;
    for (const i of idxs.slice(0, -1)) {
      const cohesive = idxs.some(
        (j) =>
          j !== i &&
          !quotesConflict(entries[i].text, entries[j].text) &&
          templateSimilarity(entries[i].text, entries[j].text) >= cfg.series_sim,
      );
      if (cohesive) drop.add(i);
    }
  }

  // Pass 2 — near-duplicates. Chronological order means "a later twin exists"
  // is exactly "this copy is not the newest".
  for (let i = 0; i < entries.length; i++) {
    if (drop.has(i)) continue;
    for (let j = i + 1; j < entries.length; j++) {
      if (drop.has(j)) continue;
      if (similarity(entries[i].text, entries[j].text) >= cfg.near_dup) {
        drop.add(i);
        break;
      }
    }
  }

  const removed = [...drop].sort((a, b) => a - b).map((i) => entries[i]);
  return { entries, removed, kept: entries.length - removed.length };
}

/**
 * Prune ~/.apx/memory.md. Dry by default — pass { apply: true } to write.
 * Removal is line-precise: prose, headers, and anything the parser doesn't
 * recognize stay exactly as written. A write first copies the file to
 * memory.md.bak-<stamp>.
 */
export function pruneSelfMemory(opts = {}) {
  const text = readSelfMemory();
  const base = { path: SELF_MEMORY_PATH, applied: false, backup: "" };
  if (!text.trim()) return { ...base, kept: 0, removed: [] };

  const { removed, kept } = planPrune(text, opts);
  if (!removed.length || !opts.apply) return { ...base, kept, removed };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${SELF_MEMORY_PATH}.bak-${stamp}`;
  fs.copyFileSync(SELF_MEMORY_PATH, backup);

  const dropLines = new Set(removed.map((e) => e.line));
  const lines = text.split("\n").filter((_, idx) => !dropLines.has(idx));
  let body = stripEmptyDays(lines).join("\n");
  body = body.replace(/\n{3,}/g, "\n\n");
  if (!body.endsWith("\n")) body += "\n";
  fs.writeFileSync(SELF_MEMORY_PATH, body);

  return { ...base, applied: true, backup, kept, removed };
}
