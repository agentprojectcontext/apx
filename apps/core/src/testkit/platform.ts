// Test helpers that behave the same on every system: waits with a wall-clock budget, temp folders removed only after
// the processes using them let go, a virtual clock for idle/cap/deadline behaviour, and path assertions that compare
// as the system does. AGENTS.md rule 26; the gate in scripts/test-quality.ts keeps tests on these.
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunTimers } from "../engine/engine.ts";
import { real, samePath } from "../paths.ts";

/**
 * How much longer than on a developer's machine a wait may take here. CI sets it for slow runners (Windows); it only
 * stretches budgets, never what a test decides.
 */
export const TIME_SCALE = (() => {
  const n = Number(process.env.TEST_TIME_SCALE);
  return Number.isFinite(n) && n >= 1 ? n : 1;
})();

/** A budget in ms, stretched by TEST_TIME_SCALE. */
export const scaled = (ms: number) => Math.round(ms * TIME_SCALE);

type Truthy<T> = Exclude<T, false | 0 | "" | null | undefined>;

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls `check` until it returns something truthy, and returns that. Fails after `ms` of wall-clock time (× the
 * scale), never after a number of tries: a slow machine gets as long as a fast one.
 */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  what = "the condition",
  o: { ms?: number; every?: number } = {},
): Promise<Truthy<T>> {
  const budget = scaled(o.ms ?? 5000);
  const end = performance.now() + budget;
  while (true) {
    const v = await check();
    if (v) return v as Truthy<T>;
    if (performance.now() >= end) throw new Error(`timed out after ${budget} ms waiting for ${what}`);
    await tick(o.every ?? 20);
  }
}

/** Settles once `child` has exited (at once if it already has); fails after `ms` (× the scale). */
export function stopped(child: ChildProcess, ms = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process ${child.pid} did not exit`)), scaled(ms));
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const BUSY = new Set(["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"]);

/**
 * Removes a folder, waiting out a system that still holds it (Windows keeps a folder a process just left, or a file
 * an exiting process had open, for a moment). Node's own retries do not cover every such EPERM, so this backs off
 * itself, up to `ms` (× the scale), then fails with the last error.
 */
export async function removeDir(dir: string, ms = 10_000): Promise<void> {
  const end = performance.now() + scaled(ms);
  for (let wait = 25; ; wait = Math.min(wait * 2, 500)) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (!BUSY.has((err as NodeJS.ErrnoException).code ?? "") || performance.now() >= end) throw err;
      await tick(wait);
    }
  }
}

export type TempDir = {
  /** Its real path (links and Windows short names resolved), so it compares equal to what the core reports. */
  path: string;
  /** Removes it; await every child the test started (`stopped`) first. */
  remove(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
};

/** A fresh folder under the system's temp folder. */
export function tempDir(prefix = "apx-test-"): TempDir {
  const dir = real(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const remove = () => removeDir(dir);
  return { path: dir, remove, [Symbol.asyncDispose]: remove };
}

/**
 * A virtual clock for the engine's run timers (`startCore({ runTimers })`): idle, cap and deadline windows pass only
 * when the test says so, so a slow machine can never make them fire early. HTTP and other I/O stay on real time.
 */
export function manualTimers() {
  let now = Date.now();
  let sequence = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: RunTimers = {
    now: () => now,
    after(ms, callback) {
      const id = sequence++;
      pending.set(id, { at: now + ms, callback });
      return () => {
        pending.delete(id);
      };
    },
  };
  const next = () => [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  return {
    ...timers,
    pending: () => pending.size,
    /** How many timers were ever set: it changes whenever anything (re)arms one. */
    armed: () => sequence,
    /** When the earliest pending timer fires, if any. */
    nextAt: () => next()?.[1].at,
    /** Moves the clock `ms` on, firing every timer due on the way, in order. */
    tick(ms: number) {
      const target = now + ms;
      while (true) {
        const due = next();
        if (!due || due[1].at > target) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    },
  };
}
export type ManualTimers = ReturnType<typeof manualTimers>;

/**
 * Moves a manual clock on by itself, one timer at a time, for tests whose steps cannot be scripted one by one (runs
 * that continue, delegate and wake each other). It only moves while `waiting()` says something waits on virtual time
 * (a fixture's sleep) and nothing has changed (`state()`, the timers set) for a few polls: work on real time
 * always gets to finish first. Returns a function that stops it.
 */
export function autoAdvance(timers: ManualTimers, o: { waiting: () => boolean; state?: () => unknown }): () => void {
  let on = true;
  void (async () => {
    let last = "";
    let quiet = 0;
    while (on) {
      await new Promise((r) => setTimeout(r, 10).unref());
      const now = `${timers.armed()}:${timers.pending()}:${String(o.state?.() ?? "")}`;
      quiet = now === last ? quiet + 1 : 0;
      last = now;
      const at = timers.nextAt();
      if (quiet < 3 || at === undefined || !o.waiting()) continue;
      timers.tick(at - timers.now());
      quiet = 0;
    }
  })();
  return () => {
    on = false;
  };
}

/** A sleep on a virtual clock, ended early by `signal`. */
export function sleepOn(timers: RunTimers, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      cancel();
      reject(signal?.reason);
    };
    const cancel = timers.after(ms, () => {
      signal?.removeEventListener("abort", stop);
      resolve();
    });
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  });
}

/** Asserts two paths name the same place, as the system compares them (any case and short names on Windows). */
export function assertPath(actual: string | undefined, expected: string, message?: string): void {
  assert.ok(
    actual !== undefined && samePath(real(actual), real(expected)),
    message ?? `expected ${String(actual)} to be ${expected}`,
  );
}
