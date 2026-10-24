#!/usr/bin/env node
// One part of every package's unit tests, so CI runs them on several machines at once:
//   node scripts/test-shard.ts 2/4
// Each package's own `test` script says what runs (its `node --test` flags and globs, and any step before them); the
// test files of all packages are dealt out in turn, so the core's many files spread over every part. A package whose
// tests are not `node --test` (the mobile app's Jest) and the repo's scripts/*.test.ts run whole in part 1.
//   node scripts/test-shard.ts 2/4 --rerun-failed   # Windows: a failed file runs once more; passing then is "flaky"
// The rerun policy and why it is Windows only: DECISIONS.md#d-145.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Suite =
  | { dir: string; before: string[]; flags: string[]; files: string[] }
  | { dir: string; whole: string };

const SHELL_WORD = /"([^"]*)"|'([^']*)'|(\S+)/g;
const words = (s: string) => [...s.matchAll(SHELL_WORD)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");

/** A package's test script read as the steps before `node --test`, its flags and its globs; undefined if it has none. */
export function parseTestScript(script: string) {
  const steps = script.split("&&").map((s) => s.trim());
  const at = steps.findIndex((s) => /^node\s+--test(\s|$)/.test(s));
  if (at < 0 || at !== steps.length - 1) return undefined;
  const args = words(steps[at] ?? "").slice(2);
  return {
    before: steps.slice(0, at),
    flags: args.filter((a) => a.startsWith("-")),
    globs: args.filter((a) => !a.startsWith("-")),
  };
}

/** Deals the files out in turn over `total` parts and keeps those of part `index` (1-based), per package. */
export function shard(suites: Suite[], index: number, total: number): Suite[] {
  let n = 0;
  const out: Suite[] = [];
  for (const s of suites) {
    if ("whole" in s) {
      if (index === 1) out.push(s);
      continue;
    }
    const files = s.files.filter(() => n++ % total === index - 1);
    if (files.length) out.push({ ...s, files });
  }
  return out;
}

export function suites(root: string): Suite[] {
  const workspaces = ["apps", "packages"].flatMap((d) =>
    fs
      .readdirSync(path.join(root, d), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, d, e.name, "package.json")))
      .map((e) => path.join(d, e.name)),
  );
  const out: Suite[] = [];
  for (const dir of workspaces.sort()) {
    const script = (
      JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      }
    ).scripts?.test;
    if (!script) continue;
    const parsed = parseTestScript(script);
    if (!parsed) {
      out.push({ dir, whole: script });
      continue;
    }
    const cwd = path.join(root, dir);
    const files = parsed.globs.flatMap((g) => fs.globSync(g, { cwd })).sort();
    out.push({ dir, before: parsed.before, flags: parsed.flags, files });
  }
  return [...out, { dir: ".", whole: 'node --test "scripts/*.test.ts"' }];
}

const REPORTER = path.join(import.meta.dirname, "failed-files-reporter.ts");

/**
 * Runs test files with node --test: the files with a failed test, and whether the runner said which (it does not when
 * it crashes before reporting, and then no file may count as flaky).
 */
export function runFiles(cwd: string, flags: string[], files: string[], stdio: "inherit" | "ignore" = "inherit") {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apx-shard-")), "failed.txt");
  const reporters = ["--test-reporter=spec", "--test-reporter-destination=stdout"];
  const failedFiles = [`--test-reporter=${pathToFileURL(REPORTER).href}`, `--test-reporter-destination=${out}`];
  // A run started from inside another test run must not report to it instead of running on its own.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const args = ["--test", ...flags, ...reporters, ...failedFiles, ...files];
  const run = spawnSync(process.execPath, args, { cwd, stdio, env });
  const listed = fs.existsSync(out) ? fs.readFileSync(out, "utf8").split("\n").filter(Boolean) : [];
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  if (run.status === 0) return { failed: [], attributed: true };
  // The runner reports real paths (a symlinked temp folder, a drive letter's case), so both sides are compared so.
  const real = (f: string) => (fs.existsSync(f) ? fs.realpathSync.native(f) : path.resolve(f));
  const byPath = new Map(files.map((f) => [real(path.resolve(cwd, f)), f]));
  const failed = listed.map((f) => byPath.get(real(f))).filter((f): f is string => Boolean(f));
  return failed.length ? { failed, attributed: true } : { failed: files, attributed: false };
}

/** One more run of the files that failed: those that pass now were flaky, those that fail again failed. */
export function rerunVerdict(first: readonly string[], again: readonly string[]) {
  const still = new Set(again);
  return { flaky: first.filter((f) => !still.has(f)), failed: first.filter((f) => still.has(f)) };
}

/** Flaky files as GitHub annotations and a job summary table, so every one is seen and counted. */
export function reportFlaky(flaky: readonly string[], part: string, summary = process.env.GITHUB_STEP_SUMMARY) {
  if (!flaky.length) return;
  for (const file of flaky)
    console.log(
      `::warning file=${file},title=Flaky test file::${file} failed, then passed on its one rerun (part ${part})`,
    );
  const rows = flaky.map((f) => `| \`${f}\` | ${process.platform} | ${part} |`);
  const table = [
    `### Flaky: ${flaky.length} file(s) passed only on rerun`,
    "",
    "| File | OS | Part |",
    "|---|---|---|",
    ...rows,
    "",
  ];
  if (summary) fs.appendFileSync(summary, `${table.join("\n")}\n`);
  else console.log(table.join("\n"));
}

function main(): void {
  const [index, total] = (process.argv[2] ?? "").split("/").map(Number);
  if (!index || !total || index > total) throw new Error("usage: node scripts/test-shard.ts <part>/<parts>, e.g. 2/4");
  const rerun = process.argv.includes("--rerun-failed");
  const root = path.resolve(import.meta.dirname, "..");
  const failed: string[] = [];
  const flaky: string[] = [];
  const all = suites(root);
  const step = (dir: string, command: string) => {
    if (spawnSync(command, { cwd: path.join(root, dir), stdio: "inherit", shell: true }).status !== 0)
      failed.push(`${dir}: ${command}`);
  };
  // Every package's steps before its tests run in every part: another package's tests may need what they build
  // (the panel's import the design system's dist), as pnpm's dependency order gives them in a whole run.
  for (const s of all) if (!("whole" in s)) for (const command of s.before) step(s.dir, command);
  for (const s of shard(all, index, total)) {
    const cwd = path.join(root, s.dir);
    console.log(`\n${s.dir}: ${"whole" in s ? s.whole : `${s.files.length} files`}`);
    if ("whole" in s) {
      step(s.dir, s.whole);
      continue;
    }
    const first = runFiles(cwd, s.flags, s.files);
    if (!first.failed.length) continue;
    if (!rerun || !first.attributed) {
      failed.push(s.dir);
      continue;
    }
    console.log(`\n${s.dir}: running ${first.failed.length} failed file(s) once more: ${first.failed.join(", ")}`);
    const verdict = rerunVerdict(first.failed, runFiles(cwd, s.flags, first.failed).failed);
    flaky.push(...verdict.flaky.map((f) => path.join(s.dir, f).split(path.sep).join("/")));
    if (verdict.failed.length) failed.push(`${s.dir} (${verdict.failed.join(", ")})`);
  }
  reportFlaky(flaky, `${index}/${total}`);
  if (failed.length) {
    console.error(`\nFailed in part ${index}/${total}: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
