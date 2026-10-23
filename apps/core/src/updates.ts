// Updates for an APX that runs from its source checkout or from an installed bundle. Every few hours it asks git
// whether release/v2 moved (a checkout) or the release feed whether a newer APX is out (a bundle, see updates-release.ts),
// and on the owner's word it brings it in. A supervisor (`pnpm app`, the service) starts the core again with the new
// code; without one the owner is told to restart.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type Platform, platformOf, type Release, releaseChanges } from "@apx/protocol";
import { errorMessage } from "./errors.ts";
import type { Log } from "./log.ts";
import { checkReleases, installRelease, runningVersion } from "./updates-release.ts";

export type UpdateStatus = {
  /**
   * Where updates come from: this checkout's git remote, the release feed (a daemon installed from a bundle), the
   * release feed for a core the desktop app carries (the app installs them), or nowhere (a test).
   */
  source: "git" | "release" | "app" | "none";
  /** Commits on release/v2 this checkout does not have, or releases newer than this one. */
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
// v2's branch in the public repo, whose main is still v1.
const BRANCH = "release/v2";
/** The exit code that asks a supervisor to start the core again. */
export const RESTART_CODE = 75;
/** How long a core may take to close for an update before it exits anyway. */
export const RESTART_CLOSE_MS = 10_000;

/**
 * Closes, then exits with RESTART_CODE so the supervisor starts the new code. A close that hangs is not waited for: a
 * core left running would keep the old version's folder in use, and the next update could prune it.
 */
export async function restartAfterClose(
  close: () => Promise<unknown>,
  exit: (code: number) => void,
  ms = RESTART_CLOSE_MS,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([close().catch(() => {}), deadline]);
  clearTimeout(timer);
  exit(RESTART_CODE);
}

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
  /** This APX's version (what the release feed is compared with). */
  version?: string;
  /** APX_APP: the folder a bundle install lives in (install.sh/ps1); updates then come from the release feed. */
  app?: string | undefined;
  /** The desktop app carries this core and installs its updates: the core only says a newer one is out. */
  byApp?: boolean;
  /** owner/repo of the release feed; undefined turns release updates off. */
  feed?: string | undefined;
  platform?: Platform | undefined;
  fetch?: typeof fetch;
  run?: Runner;
  restart?: () => void;
}) {
  const git = opts.enabled && fs.existsSync(path.join(opts.root, ".git"));
  const platform = opts.platform ?? platformOf(process.platform, process.arch);
  const release = !git && opts.enabled && Boolean((opts.app || opts.byApp) && opts.feed && opts.version && platform);
  const releaseSource = opts.byApp ? "app" : "release";
  // Bundle versions can be pruned while a daemon still runs from one; the install directory survives updates.
  const sh = opts.run ?? run(git ? opts.root : (opts.app ?? opts.root));
  const fetchImpl = opts.fetch ?? fetch;
  let status: UpdateStatus = { source: git ? "git" : release ? releaseSource : "none", behind: 0, changes: [] };
  let newer: Release[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy: Promise<unknown> | undefined;

  async function checkGit(): Promise<UpdateStatus> {
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

  async function checkRelease(): Promise<UpdateStatus> {
    try {
      ({ newer } = await checkReleases(opts.feed ?? "", opts.version ?? "", fetchImpl));
    } catch (err) {
      status = { ...status, error: errorMessage(err, 300), checked_at: now() };
      return status;
    }
    status = {
      source: releaseSource,
      behind: newer.length,
      latest: newer[0]?.version,
      changes: releaseChanges(newer),
      checked_at: now(),
    };
    return status;
  }

  const check = (): Promise<UpdateStatus> => (git ? checkGit() : release ? checkRelease() : Promise.resolve(status));

  async function applyGit(): Promise<UpdateResult> {
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
    return { ok: true, restart: false, log };
  }

  async function applyRelease(): Promise<UpdateResult> {
    if (!newer.length) await checkRelease();
    const next = newer[0];
    if (!next || !platform || !opts.app)
      return { ok: false, restart: false, log: status.error ?? "Nothing newer to install." };
    try {
      const running = runningVersion(opts.app, opts.root);
      const log = await installRelease({
        app: opts.app,
        release: next,
        platform,
        fetch: fetchImpl,
        run: sh,
        ...(running ? { running } : {}),
      });
      return { ok: true, restart: false, log };
    } catch (err) {
      return { ok: false, restart: false, log: errorMessage(err, 2000) };
    }
  }

  async function apply(): Promise<UpdateResult> {
    if (opts.byApp || (!git && !release))
      return { ok: false, restart: false, log: "This APX updates with its desktop app, or by hand." };
    const r = git ? await applyGit() : await applyRelease();
    if (!r.ok) return { ...r, log: r.log.slice(-6000) };
    if (release) newer = [];
    await check().catch(() => status);
    if (opts.supervised) {
      // The answer goes out first; then the supervisor brings the new code up.
      const t = setTimeout(() => opts.restart?.(), 500);
      t.unref?.();
    }
    return { ok: true, restart: opts.supervised, log: r.log.slice(-6000) };
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
      if (!git && !release) return;
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
