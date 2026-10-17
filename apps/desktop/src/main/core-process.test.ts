import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startEmbeddedCore } from "./core-process.ts";

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Child did not reach the expected state");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function fixture(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-embedded-"));
  const main = path.join(dir, "apx", "apps", "core", "src", "main.ts");
  fs.mkdirSync(path.dirname(main), { recursive: true });
  fs.writeFileSync(main, source);
  return {
    dir,
    opts: {
      resources: dir,
      logFile: path.join(dir, "core.log"),
      cacheDir: path.join(dir, "cache"),
      home: dir,
      port: 17440,
      restartDelayMs: 300,
    },
  };
}

const record = `
  import fs from 'node:fs';
  import path from 'node:path';
  fs.appendFileSync(path.join(process.env.APX_HOME, 'starts'), JSON.stringify({ home: process.env.APX_HOME, port: process.env.APX_PORT, app: process.env.APX_APP, host: process.env.APX_HOST, token: process.env.APX_TOKEN }) + '\\n');
`;

test("an embedded child gets its explicit local target; stop is idempotent and waits for exit", {
  timeout: 10_000,
}, async () => {
  const { dir, opts } = fixture(`${record}\nsetInterval(() => {}, 1000);`);
  const oldHost = process.env.APX_HOST;
  const oldToken = process.env.APX_TOKEN;
  process.env.APX_HOST = "0.0.0.0";
  process.env.APX_TOKEN = "ambient-test-token";
  const core = startEmbeddedCore(opts);
  if (oldHost === undefined) delete process.env.APX_HOST;
  else process.env.APX_HOST = oldHost;
  if (oldToken === undefined) delete process.env.APX_TOKEN;
  else process.env.APX_TOKEN = oldToken;
  try {
    const file = path.join(dir, "starts");
    await until(() => fs.existsSync(file));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      home: dir,
      port: "17440",
      app: "",
      host: "127.0.0.1",
    });
    await Promise.all([core.stop(), core.stop()]);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 1);
  } finally {
    await core.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stopping during backoff cancels a queued restart", { timeout: 10_000 }, async () => {
  const { dir, opts } = fixture(`${record}\nprocess.exit(1);`);
  const core = startEmbeddedCore(opts);
  try {
    await until(() => fs.readFileSync(opts.logFile, "utf8").includes("core exited"));
    await core.stop();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fs.readFileSync(path.join(dir, "starts"), "utf8").trim().split("\n").length, 1);
  } finally {
    await core.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
