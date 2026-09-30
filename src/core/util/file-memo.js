// What a file SAYS, remembered for as long as the file does not change.
//
// The list views (inbox, chat sidebars) re-derive the same summaries from the
// same ledger files on every request, and the panel asks on every live-feed
// event. Parsing is CPU, so async I/O alone does not keep it off the event
// loop — the only cheap parse is the one not repeated. A file is keyed by its
// (mtime, size): an append moves both, so only the day being written re-parses.
//
// `derive` must return something SMALL (a summary, one channel's rows): the
// memo holds it, and the ledger it came from runs to tens of megabytes.
import fs from "node:fs";
import fsp from "node:fs/promises";

const MAX_ENTRIES = 20_000;
const memo = new Map(); // `${kind}\0${file}` → { mtimeMs, size, value }
const stats = { hits: 0, misses: 0 };

function lookup(key, st, fresh) {
  const hit = memo.get(key);
  if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) return undefined;
  if (fresh && !fresh(hit.value)) return undefined;
  // Re-inserting keeps the Map in least-recently-used order for eviction.
  memo.delete(key);
  memo.set(key, hit);
  stats.hits += 1;
  return hit;
}

function store(key, st, value) {
  stats.misses += 1;
  memo.set(key, { mtimeMs: st.mtimeMs, size: st.size, value });
  if (memo.size > MAX_ENTRIES) memo.delete(memo.keys().next().value);
  return value;
}

/**
 * `derive(text)` for `file`, recomputed only when the file changed. `kind`
 * names the derivation, so two readers of one file never share an entry.
 * Returns `missing` when the file cannot be read.
 *
 * `fresh(value)` is for a derivation that also depends on something OUTSIDE the
 * file: returning false re-derives even though the file is unchanged.
 *
 * The stat is taken BEFORE the read, so a write racing the read is cached
 * under the older stat and the next call sees a mismatch — never the reverse.
 */
export async function memoFile(kind, file, derive, { missing = null, fresh = null } = {}) {
  const key = `${kind}\0${file}`;
  let st;
  try { st = await fsp.stat(file); } catch { memo.delete(key); return missing; }
  const hit = lookup(key, st, fresh);
  if (hit) return hit.value;
  let text;
  try { text = await fsp.readFile(file, "utf8"); } catch { return missing; }
  return store(key, st, derive(text));
}

/** The same memo, for the sync readers that have not moved off a request path yet. */
export function memoFileSync(kind, file, derive, { missing = null, fresh = null } = {}) {
  const key = `${kind}\0${file}`;
  let st;
  try { st = fs.statSync(file); } catch { memo.delete(key); return missing; }
  const hit = lookup(key, st, fresh);
  if (hit) return hit.value;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return missing; }
  return store(key, st, derive(text));
}

/** Hit/miss counters — a miss is a parse. For tests and diagnostics. */
export function fileMemoStats() {
  return { ...stats, entries: memo.size };
}

export function clearFileMemo() {
  memo.clear();
  stats.hits = 0;
  stats.misses = 0;
}
