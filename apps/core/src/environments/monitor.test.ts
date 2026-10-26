import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { computerChat, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { RUNS_SCRIPTS, scaled, tempDir } from "../testkit/platform.ts";
import { createVmLifecycle } from "./lifecycle.ts";
import { managedVmConfig } from "./managed.ts";

const numbers = {
  running: true,
  name: "computer",
  cpus: 2,
  memory_assigned_mb: 4096,
  memory_used_mb: 1500,
  disk_mb: 3072,
};

test("system.usage carries the shared computer's numbers once the owner set it up, and no VM slot before", async () => {
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => true,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: "/unused", instance: "missing", lifecycle, usage: async () => numbers },
  });
  try {
    const chat = await computerChat(env);
    assert.equal((await env.client.call("system.usage", {})).vm, undefined, "a computer nobody set up has no slot");
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.enable", { thread: chat, appearance: "light" });
    assert.deepEqual((await env.client.call("system.usage", {})).vm, numbers);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("system.usage has no VM slot on a core with no computer configured", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    assert.equal((await env.client.call("system.usage", {})).vm, undefined);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("the monitor shares one VM probe between callers and reuses it for a few seconds", async () => {
  let probes = 0;
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: {
      limaHome: "/unused",
      instance: "missing",
      usage: async () => {
        probes++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return numbers;
      },
    },
  });
  try {
    env.core.store.settings.set("computer_enabled", "true");
    const vm = env.core.computer;
    const both = await Promise.all([vm.monitored(), vm.monitored()]);
    assert.deepEqual(both, [numbers, numbers]);
    await vm.monitored();
    assert.equal(probes, 1);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

// portable: stands in for the Mac-only driver with a script binary (RUNS_SCRIPTS).
if (RUNS_SCRIPTS)
  test("a guest that does not answer is given up within the monitor's wait, its probe killed", async () => {
    const dir = tempDir("apx-vm-probe-");
    const pids = path.join(dir.path, "pids");
    const binary = path.join(dir.path, "limactl.mjs");
    // A Lima that never answers: each call records its pid and hangs.
    fs.writeFileSync(
      binary,
      `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n');\nsetInterval(() => {}, 10000);\n`,
      { mode: 0o755 },
    );
    const limaHome = path.join(dir.path, "lima");
    fs.mkdirSync(path.join(limaHome, "computer"), { recursive: true });
    fs.writeFileSync(path.join(limaHome, "computer", "lima.yaml"), "memory: 4GiB\n");
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    try {
      const config = managedVmConfig(env.core.store, env.home, {
        limaHome,
        instance: "computer",
        executable: () => binary,
      });
      const started = performance.now();
      const usage = await config.usage?.();
      assert.ok(performance.now() - started < scaled(3000), "answered inside the monitor's 3 s wait");
      assert.equal(usage?.running, false);
      const alive = fs
        .readFileSync(pids, "utf8")
        .split("\n")
        .filter(Boolean)
        .filter((pid) => {
          try {
            process.kill(Number(pid), 0);
            return true;
          } catch {
            return false;
          }
        });
      assert.deepEqual(alive, [], "no probe left running");
    } finally {
      await env.core.close();
      await env.cleanup();
      await dir.remove();
    }
  });
