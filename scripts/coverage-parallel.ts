#!/usr/bin/env node
// The --e2e coverage run as CI splits it (unit, panel in six, desktop), every part at once on this machine, then merged
// into coverage/all like CI's coverage-report: `pnpm verify` in the remote runner's box (rules/TESTING.md#remote-runner).
//   node scripts/coverage-parallel.ts             # builds once, runs the parts side by side (4 at a time), merges
//   APX_COVERAGE_JOBS=8 node scripts/coverage-parallel.ts   # more or fewer at a time
// Each part's output goes to coverage/all/logs/<part>.log; a failing part's last lines are shown.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunTimers } from "../apps/core/src/engine/engine.ts";
import { stopTree } from "../apps/core/src/processes.ts";

export type Part = { name: string; args: string[] };

/** The same parts as verify.yml's coverage matrix, the longest first. */
export const PARTS: Part[] = [
  { name: "unit", args: ["--part=unit"] },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ name: `web-${i}-of-6`, args: ["--part=web", `--shard=${i}/6`] })),
  { name: "desktop", args: ["--part=desktop"] },
];

/**
 * What the parts would each build: built once before they start, so none rebuilds a dist another is reading. Coverage
 * builds (`APX_TEST_COVERAGE=1`) carry the source maps the report maps browser counters through.
 */
export const BUILDS: string[][] = [
  ["pnpm", "build:web"],
  ["pnpm", "--filter", "@apx/artifact-worker", "build"],
  ["pnpm", "--filter", "@apx/desktop", "build"],
];

/**
 * Parts running at once. All eight together start six sandbox cores, six Chromiums and the unit run in the same second,
 * and the setup each panel part replays first then misses its 30 s budget; four (unit and three panel parts) keep each
 * part near its speed alone. `APX_COVERAGE_JOBS` changes it.
 */
export const JOBS = 4;

/** A part that has not ended by then is stopped and counts as failed; each suite inside has a shorter limit of its own. */
const PART_MS = 45 * 60_000;

export type Start = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; log?: string },
) => { done: Promise<boolean>; stop: () => Promise<void> };

export type TogetherOptions = {
  root: string;
  env: NodeJS.ProcessEnv;
  start: Start;
  print: (line: string) => void;
  now?: () => number;
  after?: RunTimers["after"];
  parts?: Part[];
  partMs?: number;
  /** How many parts run at the same time; the next one starts when one ends. */
  jobs?: number;
  /** Lines of a failing part's log shown. */
  tail?: number;
};

const minutes = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const defaultAfter: RunTimers["after"] = (ms, callback) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

/** Builds, runs every part at once, merges; resolves true when anything failed. */
export async function runTogether(o: TogetherOptions): Promise<boolean> {
  const now = o.now ?? Date.now;
  const after = o.after ?? defaultAfter;
  const parts = o.parts ?? PARTS;
  const all = path.join(o.root, "coverage", "all");
  const logs = path.join(all, "logs");
  // Parts left from an earlier run would be merged as if they were this one's.
  fs.rmSync(all, { recursive: true, force: true });
  fs.mkdirSync(logs, { recursive: true });
  const env = { ...o.env, APX_TEST_COVERAGE: "1" };

  for (const [command = "", ...args] of BUILDS) {
    o.print(`coverage: ${[command, ...args].join(" ")}`);
    if (!(await o.start(command, args, { env }).done)) {
      o.print(`coverage: ${[command, ...args].join(" ")} failed; no part runs against stale output`);
      return true;
    }
  }

  const started = now();
  const jobs = Math.max(1, Math.min(o.jobs ?? JOBS, parts.length));
  o.print(`coverage: ${parts.length} parts, ${jobs} at a time (${parts.map((p) => p.name).join(", ")})`);
  const runPart = async (part: Part) => {
    const partStarted = now();
    const log = path.join(logs, `${part.name}.log`);
    // Coverage slows every unit test and that part runs many files at once: waits get twice the room, as in CI.
    const partEnv = part.name === "unit" ? { TEST_TIME_SCALE: "2", ...env } : env;
    const run = o.start(process.execPath, ["scripts/test-coverage.ts", "--e2e", ...part.args, "--together"], {
      env: partEnv,
      log,
    });
    let timedOut = false;
    const cancel = after(o.partMs ?? PART_MS, () => {
      timedOut = true;
      void run.stop();
    });
    const passed = (await run.done) && !timedOut;
    cancel();
    const took = `${minutes(now() - partStarted)} (total ${minutes(now() - started)})`;
    o.print(`${passed ? "✓" : "✗"} ${part.name}  ${took}${timedOut ? "  out of time, stopped" : ""}`);
    return { part, passed, log };
  };
  const queue = [...parts];
  const results: Awaited<ReturnType<typeof runPart>>[] = [];
  const lane = async () => {
    for (let part = queue.shift(); part; part = queue.shift()) results.push(await runPart(part));
  };
  await Promise.all(Array.from({ length: jobs }, lane));
  results.sort((a, b) => parts.indexOf(a.part) - parts.indexOf(b.part));

  for (const { part, log } of results.filter((r) => !r.passed)) {
    const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trimEnd().split("\n") : [];
    o.print(`\n── ${part.name}: last lines ──`);
    o.print(lines.slice(-(o.tail ?? 80)).join("\n"));
    o.print(`Full output: ${path.relative(o.root, log)}`);
  }

  o.print("coverage: merging the parts");
  const merged = await o.start(
    process.execPath,
    ["scripts/test-coverage.ts", "--e2e", "--merge", `--expect-parts=${parts.length}`],
    { env },
  ).done;
  return !merged || results.some((r) => !r.passed);
}

/** The children running now, stopped (with what they started) on Ctrl-C or a stop. */
const running = new Set<number>();

/** A child in its own process group (so stopping it stops what it started), its output in `log` or inherited. */
function startProcess(root: string): Start {
  return (command, args, { env, log }) => {
    const fd = log === undefined ? undefined : fs.openSync(log, "w");
    const exe = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
    const child = spawn(exe, args, {
      cwd: root,
      env,
      stdio: fd === undefined ? "inherit" : ["ignore", fd, fd],
      detached: process.platform !== "win32",
      shell: exe.endsWith(".cmd"),
      windowsHide: true,
    });
    const done = new Promise<boolean>((resolve) => {
      child.once("error", (error) => {
        console.error(error.message);
        resolve(false);
      });
      child.once("exit", (code) => resolve(code === 0));
    }).finally(() => {
      if (fd !== undefined) fs.closeSync(fd);
    });
    const pid = child.pid;
    if (pid) {
      running.add(pid);
      void done.finally(() => running.delete(pid));
    }
    return { done, stop: () => (child.pid ? stopTree(child.pid) : Promise.resolve()) };
  };
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const interrupt = () => {
    for (const pid of running) void stopTree(pid);
    process.exitCode = 130;
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const failed = await runTogether({
    root,
    env: process.env,
    start: startProcess(root),
    print: (line) => console.log(line),
    jobs: Number(process.env.APX_COVERAGE_JOBS) || JOBS,
  });
  if (failed && !process.exitCode) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
