#!/usr/bin/env node
// Fails when a tracked file contains a term from the owner's PRIVATE denylist.
//
// This is a public repository, and AGENTS.md rule 3 says no real people,
// businesses, ids or paths go into it. Review alone did not hold that line:
// narrative comments ("<owner> asked for…"), fixtures retyped from a live turn
// and incident notes kept carrying real names in until a full scrub had to
// take them back out. This script is the mechanical half of the rule.
//
// The list itself must never be committed — a denylist of private names in a
// public repo publishes exactly what it is meant to protect. So it is read
// from LOCAL files only, and when none exists the check passes silently: CI
// and every fresh clone have no list, and that is by design. The owner's
// machine (where the commits are written) is the one that has it.
//
// Where the list comes from:
//   - $APX_PRIVATE_TERMS         — when set, this file and nothing else
//   - <repo>/spec/private-terms.txt   (spec/ is gitignored)
//   - $APX_HOME/private-terms.txt     (default ~/.apx/private-terms.txt)
//
// Format, one entry per line:
//   term              matched case- and accent-insensitively, as a whole word
//                     (a letter or digit on either side means no match, so
//                     "ana" does not hit "banana"; "_" and "-" are boundaries)
//   re:<regex>        a raw regular expression (flags "iu"), for number shapes
//   allow:<text>      a literal that is masked before matching — for a real,
//                     functional reference that must stay (a public repo URL)
//   # comment         ignored, as are blank lines
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 2 * 1024 * 1024;

/** Lowercase and strip combining marks, so "Peña" and "pena" compare equal. */
export function fold(text) {
  return String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse the denylist text into matchers. Never throws on a bad regex line. */
export function parseTerms(text) {
  const matchers = [];
  const allow = [];
  const errors = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("allow:")) {
      const lit = line.slice(6).trim();
      if (lit) allow.push(fold(lit));
      continue;
    }
    if (line.startsWith("re:")) {
      const src = line.slice(3).trim();
      try {
        matchers.push({ label: `re:${src}`, rx: new RegExp(src, "iu") });
      } catch (e) {
        errors.push(`bad regex ${JSON.stringify(src)}: ${e.message}`);
      }
      continue;
    }
    const term = fold(line);
    matchers.push({
      label: line,
      rx: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "u"),
      folded: true,
    });
  }
  return { matchers, allow, errors };
}

/** The denylist files that apply, in order. Only existing files are returned. */
export function termFiles(env = process.env, repo = REPO) {
  if (env.APX_PRIVATE_TERMS) {
    return fs.existsSync(env.APX_PRIVATE_TERMS) ? [env.APX_PRIVATE_TERMS] : [];
  }
  const home = env.APX_HOME || path.join(os.homedir(), ".apx");
  return [path.join(repo, "spec", "private-terms.txt"), path.join(home, "private-terms.txt")]
    .filter((f) => fs.existsSync(f));
}

export function loadTerms(env = process.env, repo = REPO) {
  const files = termFiles(env, repo);
  const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  return { files, ...parseTerms(text) };
}

/**
 * Scan `files` (paths relative to `root`) and return every hit as
 * { file, line, term }. Binary and very large files are skipped.
 */
export function findPrivateTerms({ root, files, matchers, allow = [] }) {
  const hits = [];
  if (!matchers.length) return hits;
  for (const rel of files) {
    const abs = path.join(root, rel);
    let buf;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue; // deleted in the working tree
    }
    if (buf.includes(0)) continue; // binary
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      let folded = fold(lines[i]);
      for (const a of allow) folded = folded.split(a).join(" ");
      for (const m of matchers) {
        const target = m.folded ? folded : lines[i];
        if (m.rx.test(target)) hits.push({ file: rel, line: i + 1, term: m.label });
      }
    }
  }
  return hits;
}

function trackedFiles(repo) {
  const res = spawnSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`);
  return res.stdout.split("\0").filter(Boolean);
}

function main() {
  const { files, matchers, allow, errors } = loadTerms();
  for (const e of errors) console.error(`private-terms: ${e}`);
  if (!files.length || !matchers.length) return 0; // no list here — nothing to check
  const hits = findPrivateTerms({ root: REPO, files: trackedFiles(REPO), matchers, allow });
  if (!hits.length) {
    console.log(`private-terms: ok (${matchers.length} terms, local list)`);
    return errors.length ? 1 : 0;
  }
  console.error(`private-terms: ${hits.length} hit(s) of the local denylist in tracked files:`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.term}]`);
  console.error("Replace them with invented placeholders (AGENTS.md rule 3). Never commit the list.");
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
