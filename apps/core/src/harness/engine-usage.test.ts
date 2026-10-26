import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { EngineStatus } from "@apx/protocol";
import { methodAccess, methods } from "@apx/protocol";
import { manualTimers, tempDir, waitFor } from "../testkit/platform.ts";
import { createEngineUsage, detectUsageEngines, readCodexUsage } from "./engine-usage.ts";
import { fakeProgram } from "./fake-program.test-support.ts";

async function fixture(mode: string, run: (bin: string, env: NodeJS.ProcessEnv, log: string) => Promise<void>) {
  await using dir = tempDir();
  const log = path.join(dir.path, "frames.jsonl");
  const program = fakeProgram(
    dir.path,
    "quota-fixture",
    `
    const fs = require("node:fs");
    const log = ${JSON.stringify(log)};
    fs.writeFileSync(log, JSON.stringify({pid: process.pid, args: argv}) + "\\n");
    const lines = require("node:readline").createInterface({input: process.stdin});
    lines.on("line", line => {
      fs.appendFileSync(log, line + "\\n");
      const frame = JSON.parse(line);
      if (frame.method === "initialize") {
        process.stdout.write(JSON.stringify({id:1,result:{}}) + "\\n");
      } else if (frame.method === "account/rateLimits/read") {
        const mode = ${JSON.stringify(mode)};
        if (mode === "hang") return;
        if (mode === "exit") { lines.close(); process.stdin.destroy(); return; }
        if (mode === "cap") { process.stderr.write("x".repeat(5000)); return; }
        if (mode === "malformed") { process.stdout.write("bad json\\n"); return; }
        if (mode === "error") { process.stdout.write(JSON.stringify({id:2,error:{message:"private data"}}) + "\\n"); return; }
        const rateLimits = mode === "empty" ? {} : {
          primary:{usedPercent:25,windowDurationMins:300,resetsAt:1800000000},
          secondary:{usedPercent:70,windowDurationMins:10080,resetsAt:null}
        };
        if (mode === "invalid") rateLimits.primary.usedPercent = 101;
        process.stdout.write(JSON.stringify({id:2,result:{rateLimits}}) + "\\n");
      }
    });
  `,
  );
  await run(program.bin, { ...process.env, ...program.env }, log);
  const { pid } = JSON.parse(fs.readFileSync(log, "utf8").split("\n")[0] ?? "{}");
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

test("Codex reads only supported account quota and closes its child before returning", async () => {
  await fixture("success", async (bin, env, log) => {
    assert.deepEqual(await readCodexUsage(bin, { env }), [
      { id: "primary", window_minutes: 300, used_percent: 25, resets_at: new Date(1800000000000).toISOString() },
      { id: "secondary", window_minutes: 10080, used_percent: 70 },
    ]);
    const frames = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(frames[0].args, ["app-server"]);
    assert.deepEqual(
      frames.slice(1).map((frame) => frame.method),
      ["initialize", "initialized", "account/rateLimits/read"],
    );
  });
});

for (const mode of ["error", "malformed", "empty", "invalid", "exit", "cap"]) {
  test(`Codex ${mode} returns no quota and cleans up`, async () => {
    await fixture(mode, async (bin, env) => {
      assert.equal(await readCodexUsage(bin, { env, maxBytes: 4096 }), undefined);
    });
  });
}

test("Codex deadline is bounded and kills a silent child", async () => {
  await fixture("hang", async (bin, env, log) => {
    const timers = manualTimers();
    const pending = readCodexUsage(bin, { env, runTimers: timers });
    await waitFor(
      () => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("account/rateLimits/read"),
      "quota request",
    );
    timers.tick(8_000);
    assert.equal(await pending, undefined);
    assert.equal(timers.pending(), 0);
  });
});

test("Codex spawn failure is unavailable", async () => {
  await using dir = tempDir();
  assert.equal(await readCodexUsage(path.join(dir.path, "missing")), undefined);
});

const status = (id: string, installed = true): EngineStatus => ({
  id,
  label: id,
  installed,
  logged_in: true,
  default: false,
});

test("availability probes only four CLI paths, including Antigravity's actual launcher", async () => {
  const commands: string[] = [];
  const engines = await detectUsageEngines(async (command) => {
    commands.push(command);
    return command === "agy" ? undefined : command;
  });
  assert.deepEqual(commands.sort(), ["agy", "claude", "codex", "opencode"]);
  assert.deepEqual(
    engines.map((engine) => [engine.id, engine.installed]),
    [
      ["claude", true],
      ["codex", true],
      ["opencode", true],
      ["antigravity", false],
    ],
  );
});

test("report reuses installed status, keeps unsupported quotas explicit, and excludes native metrics", async () => {
  const report = createEngineUsage({
    status: async () => [
      status("native"),
      status("claude"),
      status("codex"),
      status("antigravity", false),
      status("acp:opencode"),
      status("acp:custom"),
    ],
    claudeBinary: async () => "fixture",
    readClaude: async () => [{ id: "primary", window_minutes: 300, used_percent: 15 }],
    binary: async () => "fixture",
    read: async () => [{ id: "primary", window_minutes: 300, used_percent: 25 }],
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  const result = await report();
  assert.equal(result.checked_at, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(
    result.engines.map((engine) => [engine.id, engine.status, engine.reason]),
    [
      ["claude", "ok", undefined],
      ["codex", "ok", undefined],
      ["antigravity", "unavailable", "cli_not_found"],
      ["acp:opencode", "unavailable", "unsupported"],
      ["acp:custom", "unavailable", "unsupported"],
    ],
  );
  assert.equal(methods["engines.usage"].result.safeParse(result).success, true);
  assert.equal(methods["engines.usage"].effect, false);
  assert.equal(methodAccess("engines.usage"), "human");
});

test("disabled Claude is never probed and independent account reads start concurrently", async () => {
  let claudeCalls = 0;
  const disabled = createEngineUsage({
    status: async () => [status("claude")],
    enabled: () => false,
    claudeBinary: async () => {
      claudeCalls++;
      return "fixture";
    },
  });
  assert.deepEqual((await disabled()).engines, []);
  assert.equal(claudeCalls, 0);
  const started: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = (id: string) => async () => {
    started.push(id);
    await gate;
    return undefined;
  };
  const enabled = createEngineUsage({
    status: async () => [status("claude"), status("codex")],
    claudeBinary: async () => "fixture",
    binary: async () => "fixture",
    readClaude: read("claude"),
    read: read("codex"),
  });
  const pending = enabled();
  try {
    await waitFor(() => started.length === 2, "both account reads");
    assert.deepEqual(started.sort(), ["claude", "codex"]);
  } finally {
    release();
  }
  assert.deepEqual(
    (await pending).engines.map((engine) => engine.reason),
    ["not_available", "not_available"],
  );
});

test("quota requests in flight are shared and a later request can refresh", async () => {
  let calls = 0;
  const report = createEngineUsage({
    status: async () => {
      calls++;
      return [status("codex")];
    },
    binary: async () => undefined,
  });
  const a = report();
  assert.equal(a, report());
  const result = await a;
  assert.equal(result.engines[0]?.reason, "not_available");
  assert.equal(result.engines[0]?.status, "unavailable");
  await report();
  assert.equal(calls, 2);
});
