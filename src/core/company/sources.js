// Where a company's own facts come from.
//
// The layer is generic; the facts never are. Appsi reads Knot, its admin API
// and the git history of seven apps; another company reads none of those. So
// the contract is deliberately one sentence:
//
//   A SOURCE IS AN ARTIFACT NAMED `source-*` THAT PRINTS A BLOCK AND IS
//   ALLOWED TO FAIL.
//
// Artifacts already are "managed files in project storage, used as pre/post
// commands for routines", they already live per project outside the repo, and
// the agent can be asked to write one. Naming the convention rather than
// inventing a registry means adding a source never grows this file.
//
// A source that fails is REPORTED, never silently skipped: a brief that says
// "no billing data since Tuesday" is useful, and one that quietly estimates a
// number is the only mistake that costs trust permanently.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { artifactsDir, ARTIFACTS_SKIP_SIGNAL } from "#core/stores/artifacts.js";

const PREFIX = "source-";
/** Enough for an HTTP call or a git walk; past that the ritual would stall. */
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 24_000;

/** Strip the prefix and the extension: `source-knot.sh` → `knot`. */
export function sourceName(file) {
  return file.slice(PREFIX.length).replace(/\.[^.]+$/, "");
}

/**
 * The sources this project declares, in name order so a context block is
 * stable between runs.
 *
 * `only` filters by name — the monthly scorecard is the one ritual that wants
 * the business numbers, and spawning that call daily would spend a minute to
 * answer a question nobody asked.
 */
export function listSources(storagePath, { only = null } = {}) {
  let files = [];
  try {
    files = fs.readdirSync(artifactsDir(storagePath));
  } catch {
    return [];
  }
  return files
    .filter((f) => f.startsWith(PREFIX) && !f.startsWith("."))
    .map((f) => ({ file: f, name: sourceName(f), path: path.join(artifactsDir(storagePath), f) }))
    .filter((s) => (only ? only.includes(s.name) : true))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Run one source. The cwd is the PROJECT, not the artifacts directory: a
 * script that reports on a repo needs to be standing in it.
 */
export function runSource(source, { cwd, env = {}, run = defaultRun } = {}) {
  try {
    const out = run(source.path, { cwd, env });
    const text = String(out ?? "").trim();
    // A source that answers APX_SKIP is saying "not this run" — the business
    // numbers are a monthly question and asking for them daily spends a minute
    // of spawn time on something nobody asked. It is the source's call, not the
    // profile's, so the contract stays one sentence.
    if (text === ARTIFACTS_SKIP_SIGNAL || text.startsWith(`${ARTIFACTS_SKIP_SIGNAL}\n`)) {
      return { ...source, skipped: true };
    }
    if (!text) return { ...source, ok: false, reason: "produced no output" };
    // A source that prints its own block may say it is down inside it. Exiting
    // 0 while reporting `status="unavailable"` is the RIGHT thing for a source
    // to do — it is answering the question — so the summary has to read that
    // and not just the exit code, or the status line contradicts the block
    // right below it.
    const declared = text.match(/^<[a-z][\w-]*\s[^>]*status="([a-z]+)"/i)?.[1];
    if (declared && declared !== "ok") {
      return { ...source, ok: false, text: text.slice(0, MAX_OUTPUT), reason: declared };
    }
    return { ...source, ok: true, text: text.slice(0, MAX_OUTPUT) };
  } catch (error) {
    // The first line is the useful one; a stack in a prompt is noise.
    const reason = String(error?.stderr || error?.message || error).split("\n")[0].trim();
    return { ...source, ok: false, reason: reason || "failed" };
  }
}

function defaultRun(file, { cwd, env }) {
  try {
    fs.chmodSync(file, fs.statSync(file).mode | 0o111);
  } catch {
    // Not ours to fix; if it is not executable the spawn below says so.
  }
  return execFileSync(file, [], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: TIMEOUT_MS,
    env: { ...process.env, ...env },
  });
}

/**
 * A source's output as a block. A script that already prints its own `<tag>`
 * is left alone — that is how a source controls its own shape; anything else
 * is wrapped so the model can tell one source from another.
 */
export function renderSource(result) {
  // A source that reported its own unavailability already said it better than
  // we could — it knows why.
  if (!result.ok && result.text) return result.text;
  if (!result.ok) {
    return `<${result.name} status="unavailable">\n${result.reason}\n</${result.name}>`;
  }
  if (/^<[a-z][\w-]*[\s>]/i.test(result.text)) return result.text;
  return `<${result.name} status="ok">\n${result.text}\n</${result.name}>`;
}

/** Run every source and return the blocks plus the one-line status summary. */
export function collectSources(storagePath, { cwd, only = null, env = {}, run = defaultRun } = {}) {
  const all = listSources(storagePath, { only }).map((s) => runSource(s, { cwd, env, run }));
  const results = all.filter((r) => !r.skipped);
  return {
    results,
    skipped: all.filter((r) => r.skipped).map((r) => r.name),
    blocks: results.map(renderSource),
    summary: results.map((r) => `${r.name}=${r.ok ? "ok" : "unavailable"}`).join(" · "),
  };
}
