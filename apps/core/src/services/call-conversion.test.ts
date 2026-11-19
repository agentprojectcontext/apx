import assert from "node:assert/strict";
import { type SpawnOptions, spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { toPcm24k } from "./audio.ts";

const fake = path.join(import.meta.dirname, "fake-call-ffmpeg.test-support.mjs");

test("call conversion stops excessive output and waits for the child to exit", async () => {
  let closed = false;
  const run = ((_cmd: string, args: readonly string[], options: SpawnOptions) => {
    const child = spawn(process.execPath, [fake, ...args], options);
    child.once("close", () => {
      closed = true;
    });
    return child;
  }) as typeof spawn;
  await assert.rejects(toPcm24k(Buffer.from("large"), "ffmpeg", run), /too large/);
  assert.equal(closed, true);
});

test("hanging up kills an active converter before its deadline and waits for exit", async () => {
  let closed = false;
  const controller = new AbortController();
  const run = ((_cmd: string, args: readonly string[], options: SpawnOptions) => {
    const child = spawn(process.execPath, [fake, ...args], options);
    assert.ok(child.stdout);
    child.stdout.once("data", () => controller.abort());
    child.once("close", () => {
      closed = true;
    });
    return child;
  }) as typeof spawn;
  await assert.rejects(toPcm24k(Buffer.from("wait"), "ffmpeg", run, controller.signal), /cancelled/);
  assert.equal(closed, true);
});

test("oversized encoded audio never starts a converter", async () => {
  let started = false;
  const run = (() => {
    started = true;
    throw new Error("unexpected conversion");
  }) as typeof spawn;
  await assert.rejects(toPcm24k(Buffer.alloc(8 * 1024 * 1024 + 1), "ffmpeg", run), /too large/);
  assert.equal(started, false);
});
