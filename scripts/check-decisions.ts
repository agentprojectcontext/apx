#!/usr/bin/env node
// `pnpm check:decisions`: rules/DECISIONS.md stays a record links can trust. Each `## D-NNN — date — title` has its
// `<a id="d-NNN">` on the line before, numbers run in order with no gap, anchors are unique (a number two merges both
// took keeps one entry under a suffixed anchor, `d-059-routines`), and every `DECISIONS.md#d-…` link and `D-NNN` mention in
// a tracked file names a decision that exists.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DecisionProblem = { file: string; line: number; problem: string };

const DECISIONS = "rules/DECISIONS.md";
/** Numbers never used: their gap is known, not a lost entry. */
const KNOWN_GAPS = new Set([146]);
const HEADING = /^## D-(\d{3})\b(.*)$/;
const ANCHOR = /^<a id="(d-(\d{3})(-[a-z0-9-]+)?)"><\/a>$/;

export function checkRecord(text: string): { problems: DecisionProblem[]; anchors: Set<string>; numbers: Set<number> } {
  const lines = text.split("\n");
  const problems: DecisionProblem[] = [];
  const anchors = new Set<string>();
  const numbers = new Set<number>();
  const at = (i: number, problem: string) => problems.push({ file: DECISIONS, line: i + 1, problem });
  let last = 0;
  lines.forEach((line, i) => {
    const anchor = ANCHOR.exec(line);
    if (anchor) {
      const id = anchor[1] ?? "";
      if (anchors.has(id)) at(i, `anchor ${id} appears twice`);
      anchors.add(id);
      if (!HEADING.test(lines[i + 1] ?? "")) at(i, `anchor ${id} is not right before a decision`);
    } else if (/<a id="d-/.test(line)) at(i, "an anchor not on a line of its own");
    const heading = HEADING.exec(line);
    if (!heading) return;
    const n = Number(heading[1]);
    if (!/^ — \d{4}-\d{2}-\d{2} — \S/.test(heading[2] ?? ""))
      at(i, `D-${heading[1]} is not "D-NNN — YYYY-MM-DD — title"`);
    const before = ANCHOR.exec(lines[i - 1] ?? "");
    if (!before || Number(before[2]) !== n)
      at(i, `D-${heading[1]} has no <a id="d-${heading[1]}"></a> on the line before`);
    if (n < last) at(i, `D-${heading[1]} comes after D-${String(last).padStart(3, "0")}`);
    numbers.add(n);
    last = n;
  });
  const top = Math.max(0, ...numbers);
  for (let n = 1; n < top; n++)
    if (!numbers.has(n) && !KNOWN_GAPS.has(n)) at(lines.length - 1, `D-${String(n).padStart(3, "0")} is missing`);
  return { problems, anchors, numbers };
}

/** Links to an anchor that does not exist, and `D-NNN` mentions of a number never used. */
export function checkCitations(
  file: string,
  text: string,
  anchors: Set<string>,
  numbers: Set<number>,
): DecisionProblem[] {
  const problems: DecisionProblem[] = [];
  text.split("\n").forEach((line, i) => {
    const linking = file === DECISIONS || line.includes("DECISIONS.md");
    if (linking)
      for (const m of line.matchAll(/#(d-\d{3}(?:-[a-z0-9]+)*)\b/g))
        if (!anchors.has(m[1] ?? "")) problems.push({ file, line: i + 1, problem: `links to missing #${m[1]}` });
    for (const m of line.matchAll(/\bD-(\d{3})\b/g))
      if (!numbers.has(Number(m[1])))
        problems.push({ file, line: i + 1, problem: `names D-${m[1]}, which does not exist` });
  });
  return problems;
}

function main(): void {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const record = checkRecord(fs.readFileSync(path.join(repo, DECISIONS), "utf8"));
  const problems = [...record.problems];
  const files = execFileSync("git", ["grep", "-lE", "[Dd]-[0-9]{3}", "--", ".", ":!plan"], {
    cwd: repo,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  for (const file of files)
    problems.push(
      ...checkCitations(file, fs.readFileSync(path.join(repo, file), "utf8"), record.anchors, record.numbers),
    );
  for (const p of problems) console.error(`${p.file}:${p.line}: ${p.problem}`);
  if (problems.length) {
    console.error(`check:decisions: ${problems.length} problem(s)`);
    process.exitCode = 1;
  } else console.log(`check:decisions: ${record.numbers.size} decisions, ${files.length} citing files, all resolve`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
