import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { acquireDaemonLock } from "./daemon-lock.ts";
import { removeDir } from "./testkit/platform.ts";

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "apx-daemon-lock-"));

test("a home has one owner, including aliases, while another home remains independent", () => {
  const root = temp();
  try {
    const a = acquireDaemonLock(path.join(root, "a"));
    const b = acquireDaemonLock(path.join(root, "b"));
    try {
      assert.throws(() => acquireDaemonLock(path.join(root, "a", ".")), /already owns/);
      if (process.platform !== "win32") {
        fs.symlinkSync(path.join(root, "a"), path.join(root, "alias"));
        assert.throws(() => acquireDaemonLock(path.join(root, "alias")), /already owns/);
      }
    } finally {
      a.release();
      a.release();
      b.release();
    }
    acquireDaemonLock(path.join(root, "a")).release();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the operating system releases ownership after a daemon crashes", { timeout: 10_000 }, async () => {
  const home = temp();
  const module = new URL("./daemon-lock.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { acquireDaemonLock } from ${JSON.stringify(module)};
    const lock = acquireDaemonLock(${JSON.stringify(home)});
    process.once('exit', () => lock.release());
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await once(child.stdout, "data");
    assert.throws(() => acquireDaemonLock(home), /already owns/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    acquireDaemonLock(home).release();
  } finally {
    child.kill();
    await removeDir(home);
  }
});
