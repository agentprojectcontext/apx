import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { manualTimers, tempDir, waitFor } from "../apps/core/src/testkit/platform.ts";
import { coverageCommand, runE2ESuites } from "./coverage-e2e.ts";

test("local coverage runs every web shard sequentially and desktop with shared counters", async () => {
  const dir = tempDir("coverage-plan-");
  try {
    const calls: string[][] = [];
    const counters: string[] = [];
    const snapshots: string[] = [];
    let running = false;
    let port = 17000;
    const failed = await runE2ESuites(
      { web: true, desktop: true },
      {
        root: dir.path,
        raw: path.join(dir.path, "v8"),
        snapshot: (directory) => snapshots.push(path.relative(dir.path, directory)),
        platform: "linux",
        env: { DISPLAY: ":1" },
        ports: async () => ({ E2E_PORT: String(port++) }),
        run: async (command, args, options) => {
          assert.equal(running, false);
          running = true;
          await Promise.resolve();
          calls.push([command, ...args]);
          counters.push(options.env.NODE_V8_COVERAGE ?? "missing");
          assert.equal(options.env.APX_TEST_COVERAGE, "1");
          assert.equal(options.env.APX_TEST_COVERAGE_DIR, options.env.NODE_V8_COVERAGE);
          running = false;
          return true;
        },
      },
    );
    assert.equal(failed, false);
    assert.deepEqual(calls, [
      ["pnpm", "build:web"],
      ...["1/3", "2/3", "3/3"].map((shard) => [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--project",
        "chromium",
        `--shard=${shard}`,
      ]),
      ["pnpm", "--filter", "@apx/desktop", "build"],
      ["pnpm", "exec", "playwright", "test", "--project", "desktop"],
    ]);
    assert.deepEqual(new Set(counters), new Set([path.join(dir.path, "v8")]));
    assert.deepEqual(
      snapshots,
      ["apps/web/dist", "packages/ui/dist", "apps/desktop/dist"].map((p) => p.split("/").join(path.sep)),
    );
  } finally {
    await dir.remove();
  }
});

test("an explicit CI shard is not expanded and a failed shard keeps the overall run red", async () => {
  const calls: string[][] = [];
  const failed = await runE2ESuites(
    { web: "2/3", desktop: false },
    {
      root: process.cwd(),
      raw: "coverage/v8",
      snapshot: () => {},
      ports: async () => ({}),
      platform: "win32",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return args[0] === "build:web";
      },
    },
  );
  assert.equal(failed, true);
  assert.deepEqual(calls, [
    ["pnpm.cmd", "build:web"],
    ["pnpm.cmd", "exec", "playwright", "test", "--project", "chromium", "--shard=2/3"],
  ]);
});

test("a failing local shard cannot be hidden by later passing shards", async () => {
  const shards: string[] = [];
  const failed = await runE2ESuites(
    { web: true, desktop: false },
    {
      root: process.cwd(),
      raw: "coverage/v8",
      snapshot: () => {},
      ports: async () => ({}),
      run: async (_command, args) => {
        const shard = args.find((arg) => arg.startsWith("--shard="));
        if (shard) shards.push(shard);
        return shard !== "--shard=1/3";
      },
    },
  );
  assert.equal(failed, true);
  assert.deepEqual(shards, ["--shard=1/3", "--shard=2/3", "--shard=3/3"]);
});

test("a failed build does not run tests against stale output", async () => {
  let calls = 0;
  const failed = await runE2ESuites(
    { web: true, desktop: true },
    {
      root: process.cwd(),
      raw: "coverage/v8",
      snapshot: () => assert.fail("no new build maps"),
      ports: async () => ({}),
      run: async () => {
        calls++;
        return false;
      },
    },
  );
  assert.equal(failed, true);
  assert.equal(calls, 1);
});

test("coverage process reports nonzero exits and missing executables as failures", async () => {
  const options = { cwd: process.cwd(), env: process.env };
  assert.equal(await coverageCommand(process.execPath, ["-e", "process.exitCode=0"], options), true);
  assert.equal(await coverageCommand(process.execPath, ["-e", "process.exitCode=1"], options), false);
  assert.equal(await coverageCommand(path.join(process.cwd(), "missing-coverage-executable"), [], options), false);
});

test("a coverage timeout closes a real descendant listener before resolving", async () => {
  const dir = tempDir("coverage-tree-");
  const timers = manualTimers();
  const ready = path.join(dir.path, "ready.json");
  const grandchild = `const net=require('node:net'),fs=require('node:fs');const s=net.createServer();s.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[1],JSON.stringify({port:s.address().port})));`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)},${JSON.stringify(ready)}],{stdio:'inherit'});setInterval(()=>{},1000);`;
  const running = coverageCommand(process.execPath, ["-e", parent], {
    cwd: dir.path,
    env: process.env,
    after: timers.after,
  });
  try {
    const { port } = await waitFor(() => {
      try {
        return JSON.parse(fs.readFileSync(ready, "utf8")) as { port: number };
      } catch {
        return undefined;
      }
    }, "descendant listening");
    const reachable = () =>
      new Promise<boolean>((resolve) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
    assert.equal(await reachable(), true);
    timers.tick(15 * 60_000);
    assert.equal(await running, false);
    assert.equal(await reachable(), false, "no child can occupy the next sandbox");
    assert.equal(timers.pending(), 0);
  } finally {
    timers.tick(15 * 60_000);
    await running;
    await dir.remove();
  }
});
