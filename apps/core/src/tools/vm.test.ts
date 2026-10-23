import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { COMPUTER_GRANT, type PendingInput } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createVmLifecycle } from "../environments/lifecycle.ts";
import type { LlmRequest } from "../providers/llm.ts";

const GIB = 1024 ** 3;

/** A guest that boots and stops at once; `free` is the host's free memory the start check reads. */
function fakeComputer(home: string, free = { bytes: 12 * GIB }) {
  let running = false;
  const calls: string[] = [];
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
    prepare: async () => {
      calls.push("start");
      running = true;
    },
    stop: async () => {
      calls.push("stop");
      running = false;
    },
    appearance: async () => {},
  });
  return {
    calls,
    config: { limaHome: path.join(home, "no-vms"), instance: "missing", lifecycle, freeMemory: async () => free.bytes },
  };
}

const toolNames = (req: LlmRequest) => req.tools.map((t) => t.function.name);
const results = (req: LlmRequest) => req.messages.filter((m) => m.role === "tool").map((m) => String(m.content));

async function until(check: () => Promise<boolean>, what: string) {
  const deadline = Date.now() + 4000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, what);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("an agent the owner did not allow sees no computer tool, and its chat cannot be given the computer", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-tool-"));
  const seen: string[][] = [];
  const llm = scriptedLlm((req) => {
    seen.push(toolNames(req));
    return say("ok");
  });
  const env = await startCore({ home, llm, computer: fakeComputer(home).config });
  try {
    await env.client.call("threads.send", { thread: "home", text: "Hello" });
    await env.settle("home");
    assert.equal(seen[0]?.includes("computer"), false);
    await assert.rejects(env.client.call("environments.enable", { thread: "home", appearance: "light" }), /allow it/);
    await assert.rejects(env.client.call("environments.bind", { thread: "home" }), /may not use the computer/);
    const status = await env.client.call("environments.status", { thread: "home" });
    assert.equal(status.enabled, false);
    assert.equal(status.chat?.on, false);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("once set up, an agent asks with a card; allowed for good, it starts the shared computer, takes its own screen and leaves", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-tool-"));
  const vm = fakeComputer(home);
  const seen: string[][] = [];
  const llm = scriptedLlm((req) => {
    seen.push(toolNames(req));
    const done = results(req).length;
    if (done === 0) return callTool("start", "computer", { action: "start" });
    if (done === 1) return callTool("stop", "computer", { action: "stop" });
    return say("Done with the computer");
  });
  const env = await startCore({ home, llm, computer: vm.config });
  try {
    // The owner set the computer up once, for the secretary in Home, and shut it down.
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    await until(async () => (await env.client.call("environments.status", {})).phase === "running", "owner start");
    await env.client.call("environments.stop", {});
    await until(async () => (await env.client.call("environments.status", {})).phase === "stopped", "owner stop");

    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await env.client.call("threads.send", { thread: chat.id, text: "Try the site on Linux" });
    let input: PendingInput | undefined;
    await until(async () => {
      input = (await env.client.call("runs.pending", { thread: chat.id })).inputs[0];
      return Boolean(input);
    }, "a card asking for the computer");
    assert.equal(input?.tool, "computer");
    assert.deepEqual(input?.approval_scopes, ["session", "always"]);
    assert.match(
      input?.prompt ?? "",
      /asks to use the shared Linux computer \(4 GiB memory, 2 CPUs\), with its own user/,
    );
    await env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve", scope: "always" });
    const result = await env.settle(chat.id);

    assert.ok(seen[0]?.includes("computer"), "offered to ask once the owner set it up");
    assert.match(results(llm.calls.at(-1) as LlmRequest)[0] ?? "", /running; you hold your screen :101/);
    assert.match(results(llm.calls.at(-1) as LlmRequest)[1] ?? "", /Left the computer/);
    assert.equal(result.runs[0]?.state, "completed");
    const status = await env.client.call("environments.status", { thread: chat.id });
    assert.equal(status.chat?.on, false, "back on this Mac");
    assert.equal(status.chat?.screen, 1, "its own screen, kept for next time");
    assert.equal(status.phase, "running", "still up for the other agents until the watchdog finds it idle");
    assert.deepEqual(vm.calls, ["start", "stop", "start"]);
    const grants = (await env.client.call("tools.approvals", {})).approvals;
    assert.ok(grants.some((g) => g.key === COMPUTER_GRANT && g.agent_id === "scout" && g.scope === "always"));

    // Its next turn is a turn on this Mac again: host tools, and the computer tool to go back.
    await env.client.call("threads.send", { thread: chat.id, text: "Again" });
    await env.settle(chat.id);
    assert.ok(seen.at(-1)?.includes("computer"));
    assert.ok(seen.at(-1)?.some((n) => n !== "shell" && n !== "computer" && !n.startsWith("browser_")));
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("starting refuses when free memory cannot hold the VM and its reserve, and says why", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-tool-"));
  const free = { bytes: 5 * GIB };
  const vm = fakeComputer(home, free);
  const llm = scriptedLlm((req) =>
    results(req).length ? say("No room") : callTool("start", "computer", { action: "start" }),
  );
  const env = await startCore({ home, llm, computer: vm.config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await assert.rejects(
      env.client.call("environments.enable", { thread: "home", appearance: "light" }),
      /5 GiB free, the VM needs 4 GiB plus 2 GiB/,
    );
    // Refused, the chat stays on this Mac.
    assert.equal((await env.client.call("environments.status", { thread: "home" })).chat?.on, false);
    await env.client.call("environments.bind", { thread: "home" });
    await env.client.call("threads.send", { thread: "home", text: "Start your computer" });
    await env.settle("home");
    assert.match(results(llm.calls.at(-1) as LlmRequest)[0] ?? "", /not enough free memory on this computer/);
    assert.deepEqual(vm.calls, []);
    free.bytes = 7 * GIB;
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    await until(async () => (await env.client.call("environments.status", {})).phase === "running", "start");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("only the owner or the allowed agent's own run starts and stops it; taking the permission away ends its turns", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-tool-"));
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ home, llm, computer: fakeComputer(home).config });
  try {
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.start", { thread: "home" }), { code: "unauthorized" });
    await assert.rejects(agent.call("environments.release", { thread: "home" }), { code: "unauthorized" });
    await assert.rejects(agent.call("environments.permit", { agent: "roby", on: true }), { code: "unauthorized" });
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: "home" });
    await env.client.call("environments.permit", { agent: "roby", on: false });
    await env.client.call("threads.send", { thread: "home", text: "Use the computer" });
    const result = await env.settle("home");
    assert.equal(llm.calls.length, 0);
    assert.equal(result.runs[0]?.state, "failed");
    assert.match(result.runs[0]?.error ?? "", /may not use the computer/);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("the owner's resources are held to the host's limits, and the disk only grows", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-tool-"));
  const config = { ...fakeComputer(home).config, applied: () => ({ memory_gib: 4, cpus: 2, disk_gib: 32 }) };
  const env = await startCore({ home, llm: scriptedLlm(() => say("ok")), computer: config });
  try {
    const status = await env.client.call("environments.status", {});
    assert.deepEqual(status.resources, { memory_gib: 4, cpus: 2, disk_gib: 32 });
    assert.deepEqual(status.limits?.memory_gib, { min: 2, max: 12 });
    await assert.rejects(env.client.call("environments.configure", { memory_gib: 16 }), /between 2 and 12/);
    await assert.rejects(env.client.call("environments.configure", { disk_gib: 24 }), /only grows: pick 32 GiB/);
    const set = await env.client.call("environments.configure", { memory_gib: 8, cpus: 4, idle_minutes: 0 });
    assert.deepEqual(set, { resources: { memory_gib: 8, cpus: 4, disk_gib: 32 }, idle_minutes: 0 });
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
