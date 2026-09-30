#!/usr/bin/env node
// Fails when a tracked (or about-to-be-tracked) file leaks private data. Ported from v1.
//
// Two layers:
//  1. A PRIVATE denylist that is never committed (a denylist in the repo would publish what it protects).
//     Read from $APX_PRIVATE_TERMS, <repo>/spec/private-terms.txt (gitignored) or ~/.apx/private-terms.txt.
//     No file → the layer passes silently (CI, fresh clones). Format per line:
//       term | re:<regex> | allow:<literal> | # comment
//  2. Public SHAPES that run everywhere: real-looking WhatsApp numbers and absolute /Users|/Volumes paths.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 2 * 1024 * 1024;

type Hit = { file: string; line: number; term: string };
type Matcher = { label: string; rx: RegExp; folded: boolean };

export const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseTerms(text: string): { matchers: Matcher[]; allow: string[]; errors: string[] } {
  const matchers: Matcher[] = [];
  const allow: string[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("allow:")) {
      const lit = line.slice(6).trim();
      if (lit) allow.push(fold(lit));
    } else if (line.startsWith("re:")) {
      const src = line.slice(3).trim();
      try {
        matchers.push({ label: `re:${src}`, rx: new RegExp(src, "iu"), folded: false });
      } catch (e) {
        errors.push(`bad regex ${JSON.stringify(src)}: ${(e as Error).message}`);
      }
    } else {
      const term = fold(line);
      matchers.push({
        label: line,
        rx: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "u"),
        folded: true,
      });
    }
  }
  return { matchers, allow, errors };
}

function termFiles(env = process.env): string[] {
  if (env.APX_PRIVATE_TERMS) return fs.existsSync(env.APX_PRIVATE_TERMS) ? [env.APX_PRIVATE_TERMS] : [];
  return [path.join(REPO, "spec", "private-terms.txt"), path.join(os.homedir(), ".apx", "private-terms.txt")].filter(
    (f) => fs.existsSync(f),
  );
}

// Invented numbers carry four identical digits, doubled pairs or a counting run; real ones almost never do.
const PLACEHOLDER_DIGITS = [/(\d)\1{3}/, /(\d)\1(\d)\2(\d)\3/, /123456|234567|345678|456789|987654/];
const PLACEHOLDER_PATH_NAMES = new Set([
  "x",
  "a",
  "me",
  "you",
  "vos",
  "user",
  "username",
  "name",
  "someone",
  "demo",
  "acme",
  "northwind",
  "tu-usuario",
  "shared",
  "...",
  "…",
  "work",
  "repo",
  "disk",
]);

const SHAPES: { label: string; rx: RegExp; real: (m: RegExpMatchArray) => boolean }[] = [
  {
    label: "whatsapp-number",
    rx: /(?<!\d)(\d{8,20})@(?:s\.whatsapp\.net|lid|c\.us)\b|(?<!\d)(549\d{10})(?!\d)|\+54[ -]?9?[ -]?(\d{2,4}[ -]?\d{3,4}[ -]?\d{4})/g,
    real: (m) => !PLACEHOLDER_DIGITS.some((rx) => rx.test((m[1] || m[2] || m[3] || "").replace(/\D/g, ""))),
  },
  {
    label: "user-path",
    rx: /(?<![\w.-])\/(Users|Volumes)\/([^/\s"'`<>)\],;]+)/g,
    real: (m) => !PLACEHOLDER_PATH_NAMES.has((m[2] ?? "").toLowerCase()) && !(m[2] ?? "").startsWith("$"),
  },
];

function candidateFiles(): string[] {
  // Tracked + untracked-but-not-ignored: catches leaks before the first `git add`.
  const out = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO,
    encoding: "utf8",
  });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return out.stdout.split("\0").filter(Boolean);
}

function readLines(rel: string): string[] | undefined {
  try {
    const abs = path.join(REPO, rel);
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) return undefined;
    const buf = fs.readFileSync(abs);
    return buf.includes(0) ? undefined : buf.toString("utf8").split("\n");
  } catch {
    return undefined;
  }
}

export function scan(files: string[], matchers: Matcher[], allow: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const rel of files) {
    if (rel.endsWith("check-private-terms.ts")) continue;
    const lines = readLines(rel);
    if (!lines) continue;
    lines.forEach((text, i) => {
      let folded = fold(text);
      for (const a of allow) folded = folded.split(a).join(" ");
      for (const m of matchers)
        if (m.rx.test(m.folded ? folded : text)) hits.push({ file: rel, line: i + 1, term: m.label });
      for (const shape of SHAPES) {
        for (const m of text.matchAll(shape.rx))
          if (shape.real(m)) hits.push({ file: rel, line: i + 1, term: shape.label });
      }
    });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = termFiles();
  const { matchers, allow, errors } = parseTerms(files.map((f) => fs.readFileSync(f, "utf8")).join("\n"));
  for (const e of errors) console.error(`check:private: ${e}`);
  const hits = scan(candidateFiles(), matchers, allow);
  if (hits.length) {
    // Never echo the private term itself for denylist hits — only where it is.
    for (const h of hits)
      console.error(
        `  ${h.file}:${h.line}  ${h.term.startsWith("re:") || SHAPES.some((s) => s.label === h.term) ? h.term : "private-term"}`,
      );
    console.error(`check:private: ${hits.length} hit(s). Replace with placeholders (Acme, Northwind, ~/work/…).`);
    process.exit(1);
  }
  console.log(
    `check:private: ok (${files.length ? `${matchers.length} private terms` : "no private list"} + ${SHAPES.length} shapes)`,
  );
}
