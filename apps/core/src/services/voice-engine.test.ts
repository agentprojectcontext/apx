import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { createVoiceEngine } from "./voice-engine.ts";

const quiet = { info() {}, warn() {}, error() {} };
type Spawn = typeof import("node:child_process").spawn;

/** A stand-in for `uv run engine.py …`: prints the given lines, then exits with `code`. */
function fakeUv(lines: string[], code: number, seen: string[][]) {
  return ((_bin: string, args: string[]) => {
    seen.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      kill() {},
    });
    setImmediate(() => {
      for (const l of lines) child.stdout.write(`${l}\n`);
      if (code) child.stderr.write("could not reach the model hub\n");
      child.stdout.end();
      child.stderr.end();
      child.exitCode = code;
      child.emit("exit", code);
      child.emit("close", code);
    });
    return child;
  }) as unknown as Spawn;
}

test("the voice runs on Apple silicon with enough memory, the larger models from 32 GB or when picked, and says what is missing", (t) => {
  const tmp = tempDir();
  t.after(() => tmp.remove());
  const at = (
    platform: NodeJS.Platform,
    arch: string,
    memoryGb: number,
    uv = "/opt/homebrew/bin/uv",
    quality: "auto" | "light" | "full" = "auto",
  ) =>
    createVoiceEngine({
      log: quiet,
      home: tmp.path,
      platform,
      arch,
      memoryGb,
      uv: () => uv || undefined,
      quality: () => quality,
    });
  const cases = [
    [at("linux", "x64", 64), { tier: "none", memory_gb: 64, missing: "platform" }],
    [at("darwin", "x64", 32), { tier: "none", memory_gb: 32, missing: "platform" }],
    [at("darwin", "arm64", 6), { tier: "none", memory_gb: 6, missing: "memory" }],
    [at("darwin", "arm64", 8), { tier: "light", memory_gb: 8 }],
    [at("darwin", "arm64", 24), { tier: "light", memory_gb: 24 }],
    [at("darwin", "arm64", 32), { tier: "full", memory_gb: 32 }],
    [at("darwin", "arm64", 24, undefined, "full"), { tier: "full", memory_gb: 24 }],
    [at("darwin", "arm64", 12, undefined, "full"), { tier: "light", memory_gb: 12 }],
    [at("darwin", "arm64", 64, undefined, "light"), { tier: "light", memory_gb: 64 }],
    [at("darwin", "arm64", 32, ""), { tier: "full", memory_gb: 32, missing: "uv" }],
  ] as const;
  for (const [engine, want] of cases) {
    assert.deepEqual(engine.machine(), want);
    assert.equal(engine.loading(), true, "nothing is started to find out");
    engine.close();
  }
});

test("installing downloads the models with their progress, and a call waits for it", async (t) => {
  const tmp = tempDir();
  t.after(() => tmp.remove());
  const seen: string[][] = [];
  const progress = ['{"received": 0, "total": 100}', '{"received": 60, "total": 100}', "not json"];
  const engine = createVoiceEngine({
    log: quiet,
    home: tmp.path,
    platform: "darwin",
    arch: "arm64",
    memoryGb: 24,
    uv: () => "/opt/homebrew/bin/uv",
    spawn: fakeUv(progress, 0, seen),
  });
  t.after(() => engine.close());

  assert.equal(engine.installed(), false);
  await engine.whenInstalled(AbortSignal.timeout(5000));
  assert.equal(engine.installed(), true);
  assert.equal(engine.install(), undefined, "nothing in progress once it is done");
  assert.ok(seen.some((a) => a.includes("--prefetch")));
  assert.equal(seen.filter((a) => a.includes("--prefetch")).length, 1, "downloaded once");
  const again = createVoiceEngine({ log: quiet, home: tmp.path, platform: "darwin", arch: "arm64", memoryGb: 24 });
  assert.equal(
    createVoiceEngine({
      log: quiet,
      home: tmp.path,
      platform: "darwin",
      arch: "arm64",
      memoryGb: 24,
      quality: () => "full",
    }).installed(),
    false,
    "the larger models are another download",
  );
  assert.equal(again.installed(), true, "known on disk at the next start, without asking the engine");
  again.close();
});

test("a download that fails says why, and a call waiting for it gives up", async (t) => {
  const tmp = tempDir();
  t.after(() => tmp.remove());
  const engine = createVoiceEngine({
    log: quiet,
    home: tmp.path,
    platform: "darwin",
    arch: "arm64",
    memoryGb: 24,
    uv: () => "/opt/homebrew/bin/uv",
    spawn: fakeUv(['{"received": 5, "total": 100}'], 1, []),
  });
  t.after(() => engine.close());
  engine.startInstall();
  await waitFor(async () => engine.install()?.state === "failed", "the download fails");
  assert.deepEqual(engine.install(), {
    state: "failed",
    received: 5,
    total: 100,
    error: "could not reach the model hub",
  });
  assert.equal(engine.installed(), false);
  await assert.rejects(engine.whenInstalled(AbortSignal.timeout(5000)), /could not reach the model hub/);
});

test("a machine that cannot run the voice refuses to install it", (t) => {
  const tmp = tempDir();
  t.after(() => tmp.remove());
  const engine = createVoiceEngine({ log: quiet, home: tmp.path, platform: "linux", arch: "x64", memoryGb: 64 });
  t.after(() => engine.close());
  assert.throws(() => engine.startInstall(), /cannot run on this computer/);
});

test("models installed before a change of models count as missing, so the new ones download before they are used", (t) => {
  const tmp = tempDir();
  t.after(() => tmp.remove());
  const at = () => createVoiceEngine({ log: quiet, home: tmp.path, platform: "darwin", arch: "arm64", memoryGb: 24 });
  const dir = path.join(tmp.path, "voice");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "installed-light.json"), JSON.stringify({ at: "2026-11-01T00:00:00.000Z" }));
  const old = at();
  assert.equal(old.installed(), false);
  old.close();
});
