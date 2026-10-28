#!/usr/bin/env node
// `pnpm verify` and `pnpm preflight`, one step at a time, saying where they are:
//   node scripts/verify.ts verify            # in a terminal: one status line (step k of N, bar, timers, time left)
//   node scripts/verify.ts preflight --stream   # every step's output as it runs, one plain line per step
// The steps are the root scripts the plan names, expanded through package.json, so the chain lives there. In a
// terminal the steps' output goes to a log file and only a failing step's is shown; elsewhere (CI, a log file, --stream)
// it streams and the status is one line per step start and end. The estimate is each step's last passing duration.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Step = { label: string; command: string };
export type History = Record<string, number>;
type Out = { write(chunk: string): unknown; isTTY?: boolean; columns?: number };

const PREFLIGHT = ["pnpm preflight:static", "pnpm test"];
export const PLANS: Record<string, string[]> = {
  preflight: PREFLIGHT,
  verify: [...PREFLIGHT, "pnpm test:coverage:all", "node --no-warnings scripts/perf.ts"],
};

// Names for the long steps whose command says little at a glance.
const LABELS: Record<string, string> = {
  "pnpm -r --if-present test": "test › unit tests (every package)",
  'node --test "scripts/*.test.ts"': "test › repo scripts' tests",
  "pnpm test:coverage:all": "test:coverage:all (every suite + e2e)",
  "node --no-warnings scripts/perf.ts": "perf budgets",
};

const ROOT_SCRIPT = /^pnpm\s+(?:run\s+)?([\w:.-]+)$/;

/**
 * The steps a plan runs: a `pnpm <script>` whose body is a chain (`a && b`) becomes its parts, recursively; a
 * single-command script stays `pnpm <script>`. A command already run earlier in the plan is not run again.
 */
export function expand(commands: readonly string[], scripts: Record<string, string>): Step[] {
  const steps: Step[] = [];
  const seen = new Set<string>();
  const add = (step: Step) => {
    if (seen.has(step.command)) return;
    seen.add(step.command);
    steps.push(step);
  };
  const visit = (command: string, parent: string | undefined, depth: number) => {
    const name = ROOT_SCRIPT.exec(command)?.[1];
    const body = name === undefined ? undefined : scripts[name];
    const parts = body?.split("&&").map((p) => p.trim()) ?? [];
    if (name === undefined || parts.length < 2 || depth > 8) {
      add({ label: LABELS[command] ?? name ?? (parent ? `${parent} › ${command}` : command), command });
      return;
    }
    for (const part of parts) visit(part, name, depth + 1);
  };
  for (const command of commands) visit(command.trim(), undefined, 0);
  return steps;
}

/** How far the plan is (0..1) and, when every step has a past duration, the time left. */
export function progress(steps: readonly Step[], history: History, index: number, stepElapsed: number) {
  const past = steps.map((s) => history[s.command]);
  const byCount = Math.min(1, index / Math.max(1, steps.length));
  if (past.some((ms) => ms === undefined)) return { fraction: byCount, left: undefined };
  const estimates = past as number[];
  const total = estimates.reduce((a, b) => a + b, 0);
  const done =
    estimates.slice(0, index).reduce((a, b) => a + b, 0) + Math.min(stepElapsed, estimates[index] ?? stepElapsed);
  if (total <= 0) return { fraction: byCount, left: 0 };
  return { fraction: Math.min(1, done / total), left: Math.max(0, total - done) };
}

/** 9s, 4:05, 1:02:03. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

const bar = (fraction: number, width = 20) => {
  const full = Math.round(fraction * width);
  return `${"█".repeat(full)}${"░".repeat(width - full)}`;
};

export type Status = {
  index: number;
  total: number;
  label: string;
  stepElapsed: number;
  totalElapsed: number;
  fraction: number;
  left: number | undefined;
};

/** The live line: `4/12 ██████░░░░ 38%  3:05 · ~4:10 left │ lint 12s`, cut to the terminal's width. */
export function statusLine(s: Status, columns = 100): string {
  const left = s.left === undefined ? "" : ` · ~${clock(s.left)} left`;
  const line =
    `${s.index + 1}/${s.total} ${bar(s.fraction)} ${String(Math.floor(s.fraction * 100)).padStart(3)}%  ` +
    `${clock(s.totalElapsed)}${left} │ ${s.label} ${clock(s.stepElapsed)}`;
  // A pseudo-terminal can report 0 columns.
  const max = Math.max(20, (columns || 100) - 1);
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function readHistory(file: string): History {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { steps?: History };
    return data.steps && typeof data.steps === "object" ? data.steps : {};
  } catch {
    return {};
  }
}

export type RunOptions = {
  name: string;
  steps: Step[];
  root: string;
  /** Where the history and the steps' logs are kept. */
  cacheDir: string;
  out: Out;
  /** Redraw one status line and keep the steps' output in log files; otherwise stream it with plain lines. */
  live: boolean;
  now?: () => number;
  /** Redraw interval in ms for the live line; 0 redraws only when a step starts or ends. */
  every?: number;
  /** Lines of a failing step's log shown in live mode. */
  tail?: number;
  /** Aborted (Ctrl-C): no further step starts. */
  signal?: AbortSignal;
};

const slug = (s: string) =>
  s
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function exec(command: string, cwd: string, log: number | undefined) {
  const bin = path.join(cwd, "node_modules", ".bin");
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  const stdio = log === undefined ? (["ignore", "inherit", "inherit"] as const) : (["ignore", log, log] as const);
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: [...stdio] });
    child.on("error", () => resolve({ code: 127, signal: null }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

/** Runs the steps in order and stops at the first failure; resolves with its exit code (0 when all pass). */
export async function runSteps(o: RunOptions): Promise<number> {
  const now = o.now ?? Date.now;
  const historyFile = path.join(o.cacheDir, "history.json");
  const logDir = path.join(o.cacheDir, "logs");
  const past = readHistory(historyFile);
  const history: History = { ...past };
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(logDir, { recursive: true });

  const started = now();
  const total = o.steps.length;
  const ahead = progress(o.steps, past, 0, 0).left;
  const line = (text: string) => o.out.write(o.live ? `\r\x1b[2K${text}\n` : `${text}\n`);
  line(`${o.name}: ${total} steps${ahead === undefined ? "" : `, about ${clock(ahead)} last time`}`);

  for (const [index, step] of o.steps.entries()) {
    if (o.signal?.aborted) {
      line(`${o.name} interrupted before step ${index + 1}/${total}`);
      return 130;
    }
    const stepStarted = now();
    const tag = `${index + 1}/${total} ${step.label}`;
    const render = () => {
      const t = now();
      const p = progress(o.steps, past, index, t - stepStarted);
      const status = { index, total, label: step.label, stepElapsed: t - stepStarted, totalElapsed: t - started };
      o.out.write(`\r\x1b[2K${statusLine({ ...status, ...p }, o.out.columns)}`);
    };
    let timer: NodeJS.Timeout | undefined;
    let logFile: string | undefined;
    let fd: number | undefined;
    if (o.live) {
      logFile = path.join(logDir, `${String(index + 1).padStart(2, "0")}-${slug(step.label)}.log`);
      fd = fs.openSync(logFile, "w");
      render();
      if (o.every) timer = setInterval(render, o.every);
    } else line(`▶ ${tag}`);

    const result = await exec(step.command, o.root, fd);
    if (timer) clearInterval(timer);
    if (fd !== undefined) fs.closeSync(fd);
    const took = now() - stepStarted;
    const elapsed = clock(now() - started);

    if (result.code === 0) {
      history[step.command] = took;
      fs.writeFileSync(historyFile, `${JSON.stringify({ steps: history }, null, 2)}\n`);
      const left = progress(o.steps, past, index + 1, 0).left;
      const rest = left === undefined || index + 1 === total ? "" : `, ~${clock(left)} left`;
      line(`✓ ${tag}  ${clock(took)}  (total ${elapsed}${rest})`);
      continue;
    }

    const interrupted = result.signal === "SIGINT" || result.code === 130 || Boolean(o.signal?.aborted);
    const code = interrupted ? 130 : (result.code ?? 1);
    if (logFile) {
      const lines = fs.readFileSync(logFile, "utf8").trimEnd().split("\n");
      const shown = lines.slice(-(o.tail ?? 150));
      line(`✗ ${tag}  ${interrupted ? "interrupted" : `exit ${code}`} after ${clock(took)}`);
      if (lines.length > shown.length) line(`… ${lines.length - shown.length} earlier lines`);
      if (shown.join("")) o.out.write(`${shown.join("\n")}\n`);
      line(`Full output: ${logFile}`);
    } else line(`✗ ${tag}  ${interrupted ? "interrupted" : `exit ${code}`} after ${clock(took)}`);
    line(`${o.name} failed at step ${index + 1}/${total} after ${elapsed}`);
    return code;
  }
  line(`${o.name} passed in ${clock(now() - started)}`);
  return 0;
}

async function main(argv: string[]) {
  const name = argv.find((a) => !a.startsWith("-")) ?? "verify";
  const plan = PLANS[name];
  if (!plan) throw new Error(`unknown plan "${name}" (${Object.keys(PLANS).join(", ")})`);
  const root = path.dirname(import.meta.dirname);
  const scripts = (
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  const out = process.stderr;
  // A Ctrl-C reaches the running step too; the run ends when it does, with the line cleared and 130.
  const stop = new AbortController();
  process.on("SIGINT", () => stop.abort());
  return runSteps({
    name,
    steps: expand(plan, scripts),
    root,
    cacheDir: path.join(root, "node_modules", ".cache", "apx-verify"),
    out,
    live: Boolean(out.isTTY) && !argv.includes("--stream") && !process.env.CI,
    every: 1000,
    signal: stop.signal,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: Error) => {
      console.error(`verify: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
