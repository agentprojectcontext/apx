import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { commandEnv } from "./env.ts";

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("the core leaves its own apx for agents' shells, first on their PATH, and it reaches this core", async () => {
  const bin = path.join(env.home, "bin");
  const apx = path.join(bin, process.platform === "win32" ? "apx.cmd" : "apx");
  assert.ok(fs.existsSync(apx), "the launcher is written at start");
  assert.doesNotMatch(fs.readFileSync(apx, "utf8"), /APX_TOKEN/, "it never carries the token");
  const shell = commandEnv();
  // Windows names it Path; the variable is the same in any case.
  const key = Object.keys(shell).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  assert.equal(shell[key]?.split(path.delimiter)[0], bin);
  // What an agent's `apx ping` does: the launcher, found on that PATH, talks to this core.
  // On Windows the launcher is apx.cmd, which only a shell runs, as an agent's shell does.
  const { stdout } = await promisify(execFile)("apx", ["ping"], { env: shell, shell: process.platform === "win32" });
  assert.match(stdout, /^pong/m);
});
