import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createModelInstaller, installHint, type Machine, modelFile, recommend } from "./local-whisper.ts";

const m = (over: Partial<Machine>): Machine => ({
  platform: "linux",
  arch: "x64",
  cores: 4,
  memory_gb: 8,
  accel: "cpu",
  ffmpeg: true,
  ...over,
});

test("the model fits the machine: the big one only on a Mac's GPU, smaller ones on a CPU", () => {
  assert.equal(
    recommend(m({ platform: "darwin", arch: "arm64", accel: "metal", cores: 10, memory_gb: 16 })),
    "large-v3-turbo-q5_0",
  );
  assert.equal(recommend(m({ cores: 16, memory_gb: 32 })), "small", "a strong CPU");
  assert.equal(recommend(m({ cores: 2, memory_gb: 4 })), "base", "a small VPS");
  assert.equal(recommend(m({ platform: "win32", cores: 8, memory_gb: 4 })), "base", "little memory");
  assert.match(installHint("darwin"), /brew install whisper-cpp/);
  assert.match(installHint("win32"), /whisper-server\.exe/);
});

test("installing downloads the model in the background with its progress, then sets it up; a cut download is dropped", async () => {
  const body = Buffer.alloc(200_000, 7);
  let cut = false;
  const srv = http.createServer((req, res) => {
    if (req.url !== "/ggml-base.bin") return res.writeHead(404).end();
    res.writeHead(200, { "content-length": String(body.length) });
    // A connection that drops half way, as a flaky network does.
    if (cut) return res.write(body.subarray(0, 1000));
    res.end(body);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-models-"));
  const ready: string[] = [];
  const installer = createModelInstaller({
    dir,
    base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    onReady: (id, file) => ready.push(`${id}:${file}`),
    stallMs: 300,
  });
  cut = true;
  installer.install("base");
  await waitFor(() => installer.progress()?.error, "the stalled download cut");
  assert.match(installer.progress()?.error ?? "", /stalled/, "a connection that stops sending is cut");
  assert.ok(!fs.existsSync(modelFile(dir, "base")) && !fs.existsSync(`${modelFile(dir, "base")}.part`));
  cut = false;
  installer.install("base");
  assert.equal(installer.progress()?.model, "base");
  await waitFor(() => ready.length, "the model ready");
  assert.deepEqual(ready, [`base:${modelFile(dir, "base")}`]);
  assert.equal(fs.statSync(modelFile(dir, "base")).size, body.length);
  assert.equal(installer.progress(), undefined);
  installer.install("base");
  assert.equal(ready.length, 2, "a model already on disk is only set up again");
  assert.throws(() => installer.install("huge"), /unknown model/);
  srv.closeAllConnections();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
