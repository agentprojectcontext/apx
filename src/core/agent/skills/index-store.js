// Persistent vector index for the skill inspector.
//
// Why a store instead of re-embedding every turn:
//   - The inspector scores the user prompt against every known skill on every
//     turn. Even with the in-process cache in rag.js, a daemon restart pays the
//     cold cost. A JSON-backed store survives restarts and makes `apx skills
//     index` a real, observable operation (progress bar, totals).
//   - It also unlocks "chunked" descriptions later: today we embed just the
//     condensed description; tomorrow we can index the SKILL.md body itself.
//
// Format (~/.apx/skills/.index.json):
//   {
//     embedder: "tf" | "ollama:nomic-embed-text" | "openai:text-embedding-3-small" | ...,
//     dim: 256 | 768 | ...,
//     updated_at: "2026-06-13T...",
//     items: {
//       "<slug>": {
//         slug, source, file, mtime_ms,
//         desc_hash, desc, desc_vector: [..],
//         // future: chunks: [{ text, vector }]
//       }
//     }
//   }
//
// Invariants:
//   - All vectors in the file share the same embedder tag and dim. Switching
//     embedder invalidates the entire index — we rebuild from scratch.
//   - A skill whose source file has a different mtime than what's recorded is
//     re-embedded the next time `ensureIndex` runs. A skill that disappeared
//     is dropped.
//   - Reads NEVER throw into the daemon: a corrupted file is treated as empty.
//
// Concurrency: the daemon is single-process for now; we use a simple write-
// then-rename to avoid half-written files, no advisory lock. If a future
// multi-process arrangement is added, swap in proper file locking here.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { embedOne } from "#core/memory/embeddings.js";
import { listSkills } from "./loader.js";
import { condenseSkillDescription } from "./catalog.js";

const INDEX_PATH = path.join(os.homedir(), ".apx", "skills", ".index.json");

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

function emptyIndex() {
  return { embedder: null, dim: null, updated_at: null, items: {} };
}

export function indexPath() {
  return INDEX_PATH;
}

export function readIndex() {
  try {
    if (!fs.existsSync(INDEX_PATH)) return emptyIndex();
    const raw = fs.readFileSync(INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.items) return emptyIndex();
    return parsed;
  } catch {
    return emptyIndex();
  }
}

function writeIndex(idx) {
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  const tmp = INDEX_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
  fs.renameSync(tmp, INDEX_PATH);
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function descHashOf(text) {
  let h = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function fileMtimeMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// ---------------------------------------------------------------------------
// Build / refresh
// ---------------------------------------------------------------------------

/**
 * Decide what work the next ensureIndex() call would do — without actually
 * embedding anything. Used by `apx skills index` to render the progress bar
 * and by the inspector startup probe to decide whether to bother rebuilding.
 *
 * Returns: { existing, missing, stale, gone, total } — `existing` are the
 * slugs that already have an up-to-date vector, `missing` need a first embed,
 * `stale` had their description rewritten, `gone` are slugs in the index but
 * no longer on disk.
 */
export function planIndex({ projectPath, currentEmbedder } = {}) {
  const skills = listSkills({ projectPath });
  const idx = readIndex();
  const embedderChanged = currentEmbedder && idx.embedder && idx.embedder !== currentEmbedder;

  const existing = [];
  const missing = [];
  const stale = [];
  const slugsSeen = new Set();

  for (const s of skills) {
    slugsSeen.add(s.slug);
    const desc = condenseSkillDescription(s.description);
    const hash = descHashOf(desc + "|" + s.file);
    const mtime = fileMtimeMs(s.file);
    const hit = idx.items?.[s.slug];

    if (embedderChanged || !hit || !Array.isArray(hit.desc_vector)) {
      missing.push(s.slug);
    } else if (hit.desc_hash !== hash || hit.mtime_ms !== mtime) {
      stale.push(s.slug);
    } else {
      existing.push(s.slug);
    }
  }

  const gone = Object.keys(idx.items || {}).filter((slug) => !slugsSeen.has(slug));

  return {
    existing,
    missing,
    stale,
    gone,
    total: skills.length,
    embedderChanged: !!embedderChanged,
    embedder: idx.embedder,
  };
}

/**
 * Bring the on-disk index up to date with the current skill catalog. Skills
 * with unchanged file+desc are skipped (cheap). Skills with new/changed
 * content are re-embedded. Skills that disappeared are dropped. When the
 * embedder differs from the file's tag, the whole index is rebuilt.
 *
 * @param opts.projectPath  also scan this project's .apc/skills
 * @param opts.embedOpts    forwarded to embedOne (globalConfig, provider, ...)
 * @param opts.onProgress   called as ({ done, total, slug, action })
 * @param opts.force        rebuild every slug from scratch
 * @returns { embedder, dim, items, changed: { added, refreshed, removed, kept } }
 */
export async function ensureIndex({ projectPath, embedOpts = {}, onProgress, force = false } = {}) {
  const skills = listSkills({ projectPath });
  const idxBefore = readIndex();

  // Probe the embedder once. If TF fallback wins, every skill embeds offline —
  // no per-skill provider timeout cost. Tag is "<provider>:<model>" or "tf".
  const probe = await embedOne("probe", embedOpts);
  const embedder = embedderTag(probe);
  const dim = probe.vector.length;

  const embedderChanged = !force && idxBefore.embedder && idxBefore.embedder !== embedder;
  const items = embedderChanged || force ? {} : structuredClone(idxBefore.items || {});

  const added = [];
  const refreshed = [];
  const kept = [];

  const seen = new Set();
  let done = 0;
  for (const s of skills) {
    seen.add(s.slug);
    const desc = condenseSkillDescription(s.description);
    const hash = descHashOf(desc + "|" + s.file);
    const mtime = fileMtimeMs(s.file);

    const prev = items[s.slug];
    const upToDate = prev
      && Array.isArray(prev.desc_vector)
      && prev.desc_hash === hash
      && prev.mtime_ms === mtime;

    let action;
    if (upToDate) {
      kept.push(s.slug);
      action = "kept";
    } else {
      const out = await embedOne(desc, embedOpts);
      const vector = Array.isArray(out?.vector) ? out.vector : [];
      items[s.slug] = {
        slug: s.slug,
        source: s.source,
        file: s.file,
        mtime_ms: mtime,
        desc_hash: hash,
        desc,
        desc_vector: vector,
      };
      if (prev) {
        refreshed.push(s.slug);
        action = "refreshed";
      } else {
        added.push(s.slug);
        action = "added";
      }
    }

    done += 1;
    try { onProgress?.({ done, total: skills.length, slug: s.slug, action }); }
    catch { /* progress callback errors must not break indexing */ }
  }

  const removed = Object.keys(items).filter((slug) => !seen.has(slug));
  for (const slug of removed) delete items[slug];

  const next = {
    embedder,
    dim,
    updated_at: new Date().toISOString(),
    items,
  };
  writeIndex(next);

  return {
    embedder,
    dim,
    items,
    changed: { added, refreshed, removed, kept },
  };
}

// ---------------------------------------------------------------------------
// Self-healing background refresh
// ---------------------------------------------------------------------------

// Single in-flight guard so concurrent turns don't stack reindexes. Module-
// scoped: one daemon process = one refresh at a time.
let refreshInFlight = null;

/**
 * If the on-disk index is out of date relative to the live catalog (a skill
 * was added/edited/removed, or the embedder changed), kick a background
 * rebuild — WITHOUT blocking the caller. The current turn keeps using whatever
 * is already indexed; the next turn sees the fresh vectors.
 *
 * This is what makes "drop a SKILL.md and it just works" true: the inspector
 * calls this every turn (fire-and-forget), and the daemon calls it on startup.
 *
 * Returns a small descriptor of what it decided to do (handy for logging/tests).
 */
export function backgroundRefreshIfStale({ projectPath, embedOpts = {}, currentEmbedder, onDone } = {}) {
  if (refreshInFlight) return { started: false, reason: "in_flight" };

  let plan;
  try {
    plan = planIndex({ projectPath, currentEmbedder });
  } catch {
    return { started: false, reason: "plan_failed" };
  }

  const work = plan.missing.length + plan.stale.length + plan.gone.length;
  if (work === 0 && !plan.embedderChanged) {
    return { started: false, reason: "fresh" };
  }

  refreshInFlight = ensureIndex({ projectPath, embedOpts, force: plan.embedderChanged })
    .then((out) => {
      try { onDone?.(out); } catch { /* best-effort */ }
      return out;
    })
    .catch(() => null)
    .finally(() => { refreshInFlight = null; });

  return {
    started: true,
    missing: plan.missing.length,
    stale: plan.stale.length,
    gone: plan.gone.length,
    embedderChanged: plan.embedderChanged,
  };
}

/** Await any in-flight background refresh (used by tests / graceful shutdown). */
export async function awaitRefresh() {
  if (refreshInFlight) { try { await refreshInFlight; } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function embedderTag(probe) {
  if (!probe) return "tf";
  if (probe.embedder) return probe.embedder;
  return "tf";
}

/** Delete the on-disk index. Used by `apx skills index --reset`. */
export function clearIndex() {
  try { fs.unlinkSync(INDEX_PATH); } catch { /* missing is fine */ }
}
