// JSON files on disk — one implementation.
//
// Six modules had grown their own read/write pair and 35 more sites inlined
// `JSON.parse(fs.readFileSync(...))`. They did not agree on the things that
// matter, so the guarantees your data got depended on which copy happened to
// touch it:
//
//   - Atomicity. Only core/stores/code-sessions.js wrote through a temp file
//     and renamed. Everywhere else, a crash or a full disk mid-write left a
//     truncated file — and since the readers swallow parse errors, the next
//     read silently returned "empty" instead of "corrupt". routines.json and
//     the MCP stores were exposed to that.
//   - Permissions. vars and mcp chmod 0600 because they hold tokens; the
//     others did not, so the same kind of data could land world-readable
//     depending on the writer.
//   - Missing-file semantics. Some returned null, some {}, some threw.
//
// Reads are forgiving by design (a missing or corrupt file yields the caller's
// fallback), because every caller here treats "no data" as a valid state.
// Writes are strict: they create the directory, write atomically, and throw if
// they cannot.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Mode for files that may contain tokens or credentials. */
export const SECRET_MODE = 0o600;

// Twelve call sites still parse inline, on purpose. They are the ones whose
// failure mode is not "fall back to empty":
//
//   config/index.js       a corrupt ~/.apx/config.json must THROW, loudly. Its
//                         silent fallback would be an empty config, i.e. every
//                         key reset — the worst possible recovery.
//   mcp/sources.js,       these report *which* file failed and why, so the user
//   integrations/sources  can fix it; a bare fallback would hide the problem.
//   profiles/lifecycle,   these read package.json / manifests where a parse
//   project-config, …     error is a real error, not a missing-file state.
//
// If you are adding a new read whose answer on failure is "treat it as empty",
// use readJson. If it is "tell the user", keep it explicit.

/**
 * Read and parse a JSON file.
 *
 * @param {string} file
 * @param {unknown} [fallback=null] returned when the file is missing, empty or
 *   unparseable. Pass `{}` or `[]` when the caller wants a shape it can spread.
 */
export function readJson(file, fallback = null) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return fallback; // missing file is a normal state, not an error
  }
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Async variant, for request paths that must not block the event loop. */
export async function readJsonAsync(file, fallback = null) {
  let raw;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    return fallback;
  }
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Write a value as pretty JSON, atomically.
 *
 * Writes to `<file>.<pid>.tmp` and renames, so a reader never observes a
 * half-written file and a crash cannot destroy the previous contents.
 *
 * @param {string} file
 * @param {unknown} value
 * @param {{ mode?: number }} [opts] `mode: SECRET_MODE` for files holding
 *   credentials.
 */
export function writeJson(file, value, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    // Never leave the temp file behind on a failed write.
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
}

/** Async variant. Same atomic rename. */
export async function writeJsonAsync(file, value, { mode } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
    if (mode !== undefined) await fsp.chmod(tmp, mode);
    await fsp.rename(tmp, file);
  } catch (err) {
    try { await fsp.unlink(tmp); } catch { /* already gone */ }
    throw err;
  }
}

/**
 * Read, transform, write back — atomically, with the same fallback rules.
 * Returns the value that was written.
 */
export function updateJson(file, updater, { fallback = null, mode } = {}) {
  const next = updater(readJson(file, fallback));
  writeJson(file, next, { mode });
  return next;
}
