import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { manualTimers, tempDir, waitFor } from "../testkit/platform.ts";
import { parseClaudeUsage, readClaudeUsage } from "./claude-usage.ts";
import { fakeProgram } from "./fake-program.test-support.ts";

const launch: NonNullable<Parameters<typeof readClaudeUsage>[1]>["launch"] = (command, args, cwd, env) =>
  spawn(command, ["fixture", ...args], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

const quota = {
  rate_limits: {
    limits: [
      { kind: "session", percent: 15, resets_at: "2026-10-26T13:49:59.857235+00:00" },
      { kind: "weekly_all", percent: 87, resets_at: null },
      { kind: "weekly_scoped", percent: 0, resets_at: null },
    ],
  },
};
const result = {
  type: "result",
  subtype: "success",
  num_turns: 0,
  total_cost_usd: 0,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
};
const output = (report: unknown = quota, terminal: unknown = result) =>
  [{ type: "system", subtype: "init" }, { type: "assistant", usage_report: report }, terminal]
    .map((f) => JSON.stringify(f))
    .join("\n");

test("Claude account limits exclude scoped model quotas and normalize reset times", () => {
  assert.deepEqual(parseClaudeUsage(output()), [
    { id: "primary", used_percent: 15, window_minutes: 300, resets_at: "2026-10-26T13:49:59.857Z" },
    { id: "secondary", used_percent: 87, window_minutes: 10080 },
  ]);
});

test("Claude rejects text estimates, invalid limits, missing reports, and model turns", () => {
  for (const value of [
    "Current session: 15% used",
    "bad json",
    JSON.stringify(result),
    output({ rate_limits: { limits: [{ kind: "session", percent: 101, resets_at: null }] } }),
    output({ rate_limits: { limits: [{ kind: "session", percent: 10, resets_at: "tomorrow" }] } }),
    output(quota, { ...result, num_turns: 1 }),
    output(quota, { ...result, usage: { ...result.usage, input_tokens: 1 } }),
    output(quota, { ...result, subtype: "error_max_turns" }),
    output(quota, { ...result, total_cost_usd: 0.01 }),
    output({ rate_limits: { limits: [quota.rate_limits.limits[0], quota.rate_limits.limits[0]] } }),
  ])
    assert.equal(parseClaudeUsage(value), undefined);
});

async function fixture(mode: string, run: (bin: string, env: NodeJS.ProcessEnv, log: string) => Promise<void>) {
  await using dir = tempDir();
  const log = path.join(dir.path, "calls.jsonl");
  const program = fakeProgram(
    dir.path,
    "usage-fixture",
    `
    argv.shift();
    const fs = require("node:fs");
    const mode = ${JSON.stringify(mode)};
    const log = ${JSON.stringify(log)};
    fs.appendFileSync(log, JSON.stringify({ pid: process.pid, args: argv, cwd: process.cwd() }) + "\\n");
    if (argv[0] === "--version") {
      console.log(mode === "old" ? "2.1.272 (Claude Code)" : "2.1.285 (Claude Code)");
    } else if (mode === "descendant") {
      const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" }, windowsHide: true,
      });
      fs.appendFileSync(log, JSON.stringify({ pid: child.pid, descendant: true, cwd: process.cwd() }) + "\\n");
      setInterval(() => {}, 1000);
    } else if (mode === "hang") {
      setInterval(() => {}, 1000);
    } else if (mode === "cap") {
      console.error("x".repeat(5000));
    } else if (mode === "malformed") {
      console.log("invalid");
    } else {
      console.log(${JSON.stringify(output())});
    }
  `,
  );
  await run(program.bin, { ...process.env, ...program.env }, log);
  const calls = fs
    .readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const call of calls) {
    assert.throws(() => process.kill(call.pid, 0), { code: "ESRCH" });
    assert.equal(fs.existsSync(call.cwd), false);
  }
}

test("Claude delegates auth to an isolated, nonpersistent CLI command with zero model turns", async () => {
  await fixture("success", async (bin, env, log) => {
    assert.equal((await readClaudeUsage(bin, { launch, env }))?.[0]?.used_percent, 15);
    const calls = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ["--version"],
        [
          "-p",
          "/usage",
          "--safe-mode",
          "--no-session-persistence",
          "--max-turns",
          "0",
          "--output-format",
          "stream-json",
          "--verbose",
          "--tools",
          "",
          "--strict-mcp-config",
          "--settings",
          '{"disableAllHooks":true,"remoteControlAtStartup":false}',
        ],
      ],
    );
  });
});
for (const mode of ["old", "cap", "malformed"]) {
  test(`Claude ${mode} fails closed and cleans up`, async () => {
    await fixture(mode, async (bin, env, log) => {
      assert.equal(await readClaudeUsage(bin, { launch, env, maxBytes: 4096 }), undefined);
      if (mode === "old") assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1);
    });
  });
}
test("Claude silent child is terminated by an injected deadline", async () => {
  await fixture("hang", async (bin, env, log) => {
    const timers = manualTimers();
    const pending = readClaudeUsage(bin, { launch, env, runTimers: timers });
    await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes('"/usage"'), "usage command");
    timers.tick(8_000);
    assert.equal(await pending, undefined);
    assert.equal(timers.pending(), 0);
  });
});
test("Claude deadline closes inherited pipes and kills descendants before folder cleanup", async () => {
  await fixture("descendant", async (bin, env, log) => {
    const timers = manualTimers();
    const pending = readClaudeUsage(bin, { launch, env, runTimers: timers });
    await waitFor(
      () => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes('"descendant":true'),
      "descendant holds pipes",
    );
    timers.tick(8_000);
    assert.equal(await pending, undefined);
    assert.equal(timers.pending(), 0);
  });
});

test("Claude missing binary is unavailable", async () => {
  await using dir = tempDir();
  assert.equal(await readClaudeUsage(path.join(dir.path, "missing")), undefined);
});
