// Updates for an APX that runs from its source checkout: every few hours it asks git whether main moved, and on the
// owner's word it pulls (fast-forward only), installs and builds the panel. A supervisor (`pnpm app`) starts the core
// again with the new code; without one the owner is told to restart.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./errors.ts";
import type { Log } from "./log.ts";

export type UpdateStatus = {
  /** Where updates come from: this checkout's git remote, or nowhere (a packaged build, a test). */
  source: "git" | "none";
  /** Commits on main this checkout does not have. */
  behind: number;
  latest?: string | undefined;
  /** What they change, newest first (their commit subjects). */
  changes: string[];
  checked_at?: string | undefined;
  error?: string | undefined;
};
export type UpdateResult = { ok: boolean; restart: boolean; log: string };

/** Runs a command in the checkout; never throws (a failure is a non-zero code). */
export type Runner = (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; out: string }>;

const EVERY_MS = 6 * 3600_000;
const FIRST_MS = 60_000;
const CHANGES = 8;
const BRANCH = "main";
/** The exit code that asks a supervisor to start the core again. */
export const RESTART_CODE = 75;

const run =
  (cwd: string): Runner =>
  (cmd, args, timeoutMs) =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
      let out = "";
      const keep = (d: Buffer) => {
        out = (out + d.toString()).slice(-8000);
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      child.on("error", (err) => resolve({ code: 1, out: errorMessage(err) }));
      child.on("close", (code) => resolve({ code: code ?? 1, out }));
    });

export function createUpdates(opts: {
  root: string;
  log: Log;
  enabled: boolean;
  /** A supervisor starts the core again after an update (exit code RESTART_CODE). */
  supervised: boolean;
  run?: Runner;
  restart?: () => void;
}) {
  const git = opts.enabled && fs.existsSync(path.join(opts.root, ".git"));
  const sh = opts.run ?? run(opts.root);
  let status: UpdateStatus = { source: git ? "git" : "none", behind: 0, changes: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy: Promise<unknown> | undefined;

  async function check(): Promise<UpdateStatus> {
    if (!git) return status;
    const fetched = await sh("git", ["fetch", "--quiet", "origin", BRANCH], 60_000);
    if (fetched.code !== 0) {
      status = { ...status, error: fetched.out.trim().slice(-300) || "git fetch failed", checked_at: now() };
      return status;
    }
    const count = await sh("git", ["rev-list", "--count", `HEAD..origin/${BRANCH}`], 10_000);
    const latest = await sh("git", ["rev-parse", "--short=12", `origin/${BRANCH}`], 10_000);
    const subjects = await sh("git", ["log", "--format=%s", `-n${CHANGES}`, `HEAD..origin/${BRANCH}`], 10_000);
    status = {
      source: "git",
      behind: Number.parseInt(count.out.trim(), 10) || 0,
      latest: latest.out.trim() || undefined,
      changes: subjects.out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      checked_at: now(),
    };
    return status;
  }

  async function apply(): Promise<UpdateResult> {
    if (!git) return { ok: false, restart: false, log: "This APX does not run from a git checkout." };
    const steps: Array<[string, string[], number]> = [
      ["git", ["pull", "--ff-only", "origin", BRANCH], 120_000],
      ["pnpm", ["install", "--frozen-lockfile"], 600_000],
      ["pnpm", ["build:web"], 600_000],
    ];
    let log = "";
    for (const [cmd, args, ms] of steps) {
      const r = await sh(cmd, args, ms);
      log += `$ ${cmd} ${args.join(" ")}\n${r.out.trim()}\n`;
      if (r.code !== 0) return { ok: false, restart: false, log: log.slice(-6000) };
    }
    await check().catch(() => status);
    if (opts.supervised) {
      // The answer goes out first; then the supervisor brings the new code up.
      const t = setTimeout(() => opts.restart?.(), 500);
      t.unref?.();
    }
    return { ok: true, restart: opts.supervised, log: log.slice(-6000) };
  }

  /** One check or update at a time: a second caller waits for the one running. */
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = (busy ?? Promise.resolve()).then(work, work);
    busy = next.catch(() => {});
    return next;
  };

  return {
    status: () => status,
    check: () => serial(check),
    apply: () => serial(apply),
    start() {
      if (!git) return;
      const tick = (ms: number) => {
        timer = setTimeout(() => {
          void serial(check)
            .catch((err) => opts.log.warn({ err: errorMessage(err, 200) }, "update check failed"))
            .finally(() => tick(EVERY_MS));
        }, ms);
        timer.unref?.();
      };
      tick(FIRST_MS);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

const now = () => new Date().toISOString();
export type Updates = ReturnType<typeof createUpdates>;
