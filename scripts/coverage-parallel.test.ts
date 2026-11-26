import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { manualTimers, tempDir, waitFor } from "../apps/core/src/testkit/platform.ts";
import { BUILDS, JOBS, PARTS, runTogether, type Start } from "./coverage-parallel.ts";

type Call = { command: string; args: string[]; env: NodeJS.ProcessEnv; log?: string };

/** A fake process starter: every command passes unless `fail` names it; parts wait until `release` is called. */
function fakeStart(o: { fail?: (c: Call) => boolean; hold?: boolean } = {}) {
  const calls: Call[] = [];
  const waiting: (() => void)[] = [];
  const stopped: string[] = [];
  const start: Start = (command, args, options) => {
    const call = { command, args, ...options };
    calls.push(call);
    if (options.log) fs.writeFileSync(options.log, `output of ${args.join(" ")}\n`);
    const isPart = args.includes("--together");
    let resolve!: (ok: boolean) => void;
    const done = new Promise<boolean>((r) => {
      resolve = r;
    });
    const finish = () => resolve(!o.fail?.(call));
    if (isPart && o.hold) waiting.push(finish);
    else finish();
    return {
      done,
      stop: async () => {
        stopped.push(args.join(" "));
        resolve(false);
      },
    };
  };
  return {
    start,
    calls,
    release: () => {
      for (const finish of waiting.splice(0)) finish();
    },
    waiting,
    stopped,
  };
}

test("builds once, runs every CI part with no more than the limit at a time, then merges all of them", async () => {
  const dir = tempDir("coverage-parallel-");
  try {
    const stale = path.join(dir.path, "coverage", "all", "parts", "old");
    fs.mkdirSync(stale, { recursive: true });
    const fake = fakeStart({ hold: true });
    const lines: string[] = [];
    const run = runTogether({ root: dir.path, env: {}, start: fake.start, print: (l) => lines.push(l), staggerMs: 0 });
    // The first parts run side by side, never more than the limit; each one that ends lets the next start.
    let peak = 0;
    while (fake.calls.filter((c) => c.args.includes("--together")).length < PARTS.length || fake.waiting.length) {
      await waitFor(() => fake.waiting.length > 0, "a part running");
      peak = Math.max(peak, fake.waiting.length);
      assert.ok(fake.waiting.length <= JOBS);
      fake.waiting.shift()?.();
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(peak, JOBS);
    assert.equal(fs.existsSync(stale), false, "an earlier run's parts are never merged into this one");
    assert.equal(await run, false);

    const commands = fake.calls.map((c) => [c.command, ...c.args]);
    assert.deepEqual(commands.slice(0, BUILDS.length), BUILDS);
    const parts = fake.calls.filter((c) => c.args.includes("--together"));
    assert.deepEqual(
      parts.map((c) => c.args.filter((a) => a.startsWith("--part") || a.startsWith("--shard"))),
      [["--part=unit"], ...[1, 2, 3, 4, 5, 6].map((i) => ["--part=web", `--shard=${i}/6`]), ["--part=desktop"]],
    );
    assert.ok(parts.every((c) => c.args.includes("--e2e") && c.log?.endsWith(".log")));
    assert.equal(new Set(parts.map((c) => c.log)).size, PARTS.length, "each part writes a log of its own");
    assert.ok(
      fake.calls.every((c) => c.env.APX_TEST_COVERAGE === "1"),
      "builds and parts carry coverage maps",
    );
    assert.equal(parts.find((c) => c.args.includes("--part=unit"))?.env.TEST_TIME_SCALE, "2");
    assert.equal(parts.find((c) => c.args.includes("--part=desktop"))?.env.TEST_TIME_SCALE, undefined);
    assert.deepEqual(commands.at(-1)?.slice(1), [
      "scripts/test-coverage.ts",
      "--e2e",
      "--merge",
      `--expect-parts=${PARTS.length}`,
    ]);
  } finally {
    await dir.remove();
  }
});

test("a failed build runs no part against stale output", async () => {
  const dir = tempDir("coverage-parallel-");
  try {
    const fake = fakeStart({ fail: (c) => c.args.includes("build:web") });
    const lines: string[] = [];
    assert.equal(
      await runTogether({ root: dir.path, env: {}, start: fake.start, print: (l) => lines.push(l), staggerMs: 0 }),
      true,
    );
    assert.equal(fake.calls.length, 1);
    assert.match(lines.join("\n"), /no part runs against stale output/);
  } finally {
    await dir.remove();
  }
});

test("one failing part keeps the run red, shows its log's last lines and still merges the rest", async () => {
  const dir = tempDir("coverage-parallel-");
  try {
    const fake = fakeStart({ fail: (c) => c.args.includes("--shard=3/6") });
    const lines: string[] = [];
    assert.equal(
      await runTogether({ root: dir.path, env: {}, start: fake.start, print: (l) => lines.push(l), staggerMs: 0 }),
      true,
    );
    const out = lines.join("\n");
    assert.match(out, /✗ web-3-of-6/);
    assert.match(out, /output of .*--shard=3\/6/);
    assert.match(out, /Full output: coverage[/\\]all[/\\]logs[/\\]web-3-of-6\.log/);
    assert.ok(fake.calls.at(-1)?.args.includes("--merge"));
  } finally {
    await dir.remove();
  }
});

test("a part that outlives its limit is stopped and fails the run", async () => {
  const dir = tempDir("coverage-parallel-");
  try {
    const timers = manualTimers();
    const fake = fakeStart({ hold: true });
    const lines: string[] = [];
    const run = runTogether({
      root: dir.path,
      env: {},
      start: fake.start,
      print: (l) => lines.push(l),
      after: timers.after,
      parts: PARTS.slice(0, 2),
      partMs: 1000,
      jobs: 2,
      staggerMs: 0,
    });
    await waitFor(() => fake.waiting.length === 2, "both parts started");
    for (const finish of fake.waiting.splice(1)) finish();
    await waitFor(() => lines.some((l) => l.startsWith("✓ web-1-of-6")), "the quick part ended");
    timers.tick(1000);
    assert.equal(await run, true);
    assert.deepEqual(fake.stopped, ["scripts/test-coverage.ts --e2e --part=unit --together"]);
    assert.match(lines.join("\n"), /✗ unit .*out of time/);
    assert.match(lines.join("\n"), /✓ web-1-of-6/);
  } finally {
    await dir.remove();
  }
});

test("lanes start a stagger apart, so the panel parts' heavy setups do not all begin in the same second", async () => {
  const dir = tempDir("coverage-parallel-");
  try {
    const timers = manualTimers();
    const fake = fakeStart({ hold: true });
    const started = () => fake.calls.filter((c) => c.args.includes("--together")).length;
    const run = runTogether({
      root: dir.path,
      env: {},
      start: fake.start,
      print: () => {},
      after: timers.after,
      parts: PARTS.slice(0, 3),
      jobs: 3,
      staggerMs: 1000,
    });
    await waitFor(() => started() === 1, "the first lane started");
    timers.tick(999);
    assert.equal(started(), 1);
    timers.tick(1);
    await waitFor(() => started() === 2, "the second lane started a stagger later");
    timers.tick(1000);
    await waitFor(() => started() === 3, "the third lane started two staggers later");
    fake.release();
    assert.equal(await run, false);
  } finally {
    await dir.remove();
  }
});
