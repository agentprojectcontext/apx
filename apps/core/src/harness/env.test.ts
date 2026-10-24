import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { removeDir } from "../testkit/platform.ts";
import { commandEnv } from "./env.ts";

const run = promisify(execFile);

test("an agent's command is told nobody answers prompts, and the owner's own values win", (t) => {
  const own = process.env.GIT_PAGER;
  process.env.GIT_PAGER = "less";
  t.after(() => {
    if (own === undefined) delete process.env.GIT_PAGER;
    else process.env.GIT_PAGER = own;
  });
  const env = commandEnv();
  assert.equal(env.pnpm_config_ci, "true");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.npm_config_yes, "true");
  assert.equal(env.GIT_PAGER, "less");
  assert.equal(env.CI, process.env.CI, "CI is left as the core found it");
});

test("pnpm run by an agent reinstalls a changed node_modules instead of aborting for a missing terminal", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-env-"));
  t.after(() => removeDir(dir));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "package.json"), JSON.stringify({ name: "lib", version: "1.0.0" }));
  const manifest = (deps: Record<string, string>) =>
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "app", version: "1.0.0", dependencies: deps }),
    );
  const env = commandEnv();
  const pnpm = (store: string) =>
    run("pnpm", ["install", "--store-dir", path.join(dir, store)], {
      cwd: dir,
      env,
      timeout: 60_000,
      shell: process.platform === "win32",
    });
  manifest({ lib: "file:./lib" });
  await pnpm("store-a");
  // Another store makes pnpm purge node_modules, which it asks first; a new dependency needs the lockfile to change.
  manifest({ lib: "file:./lib", other: "file:./lib" });
  await pnpm("store-b");
  assert.ok(fs.existsSync(path.join(dir, "node_modules", "other")));
});
