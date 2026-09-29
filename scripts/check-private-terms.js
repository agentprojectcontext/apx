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

// ── Built-in shapes — public, so they run everywhere, CI included ───────────
//
// The denylist above only exists on the owner's machine, so a clone, a CI run
// or a second contributor checks nothing with it. These shapes need no private
// list: they describe what a REAL identifier looks like, not which one.
//
//  - A WhatsApp number or LID must look invented. Every placeholder in this
//    repo carries a run of four identical digits (5491155550000, 100000000000100),
//    doubled pairs (5491122334455) or a counting run (1234567890); a real phone
//    number or LID almost never does. A leaked one — the
//    owner's own number and LID sat in comments and tests for weeks — trips this
//    without anybody having to list it.
//  - An absolute macOS path names a user or a disk; only placeholder names pass.

// Invented on purpose: four identical digits in a row, doubled pairs
// (…11223344…), or a counting run (…123456…).
const PLACEHOLDER_DIGITS = [/(\d)\1{3}/, /(\d)\1(\d)\2(\d)\3/, /123456|234567|345678|456789|987654/];
// WhatsApp's own service accounts (core/identity/whatsapp.js). Public, and the
// code has to name them to ignore them.
const PUBLIC_SERVICE_NUMBERS = ["16505361212", "16508638904"];

function looksInvented(digits) {
  if (PUBLIC_SERVICE_NUMBERS.some((n) => digits.startsWith(n))) return true;
  return PLACEHOLDER_DIGITS.some((rx) => rx.test(digits));
}
const PLACEHOLDER_PATH_NAMES = new Set([
  "x", "a", "me", "you", "vos", "user", "username", "name", "someone", "demo", "acme",
  "northwind", "tu-usuario", "shared", "...", "…", "work", "repo", "disk",
]);

const SHAPES = [
  {
    label: "whatsapp-number",
    // A JID/LID address, a bare Argentine mobile (549 + 10 digits), or one
    // written the way a person types it (+54 9 11 1234-5678).
    rx: /(?<!\d)(\d{8,20})@(?:s\.whatsapp\.net|lid|c\.us)\b|(?<!\d)(549\d{10})(?!\d)|\+54[ -]?9?[ -]?(\d{2,4}[ -]?\d{3,4}[ -]?\d{4})/g,
    real: (m) => {
      const digits = (m[1] || m[2] || m[3] || "").replace(/\D/g, "");
      return !looksInvented(digits);
    },
  },
  {
    label: "user-path",
    rx: /(?<![\w.-])\/(Users|Volumes)\/([^/\s"'`<>)\],;]+)/g,
    real: (m) => !PLACEHOLDER_PATH_NAMES.has(m[2].toLowerCase()) && !m[2].startsWith("$"),
  },
];

/** Hits of the built-in shapes in `files` (relative to `root`). */
export function findRealShapes({ root, files, shapes = SHAPES }) {
  const hits = [];
  for (const rel of files) {
    let buf;
    try {
      const abs = path.join(root, rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const shape of shapes) {
        for (const m of lines[i].matchAll(shape.rx)) {
          if (shape.real(m)) hits.push({ file: rel, line: i + 1, term: shape.label });
        }
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
  const tracked = trackedFiles(REPO);
  // Shapes always run; the local list only where it exists (never in CI).
  const hits = [
    ...findRealShapes({ root: REPO, files: tracked }),
    ...(files.length && matchers.length ? findPrivateTerms({ root: REPO, files: tracked, matchers, allow }) : []),
  ];
  if (!hits.length) {
    const list = files.length ? `${matchers.length} terms, local list` : "no local list";
    console.log(`private-terms: ok (shapes; ${list})`);
    return errors.length ? 1 : 0;
  }
  console.error(`private-terms: ${hits.length} hit(s) of private data in tracked files:`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.term}]`);
  console.error(
    "Replace them with invented placeholders (AGENTS.md rule 3). A placeholder number carries a run of " +
      "four identical digits (5491155550000); a placeholder path uses /Users/you or /path/to/project. " +
      "Never commit the local list.",
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
