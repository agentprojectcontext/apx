import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { COMPUTER_GRANT, type PendingInput } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createVmLifecycle } from "../environments/lifecycle.ts";
import type { LlmRequest } from "../providers/llm.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";

const GIB = 1024 ** 3;

/**
 * A guest that boots and stops at once (or once `boot` resolves); `free` is the host's free memory the start check
 * reads.
 */
function fakeComputer(home: string, free = { bytes: 12 * GIB }, o: { supported?: boolean; boot?: Promise<void> } = {}) {
  let running = false;
  const calls: string[] = [];
  const lifecycle = createVmLifecycle({
    supported: o.supported ?? true,
    installed: () => true,
    running: async () => running,
    prepare: async () => {
      calls.push("start");
      await o.boot;
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

test("on a host that runs it, an agent not allowed yet has the tool to ask; the owner cannot give its chat the computer", async () => {
  const home = tempDir("apx-vm-tool-").path;
  const seen: string[][] = [];
  const llm = scriptedLlm((req) => {
    seen.push(toolNames(req));
    return say("ok");
  });
  const env = await startCore({ home, llm, computer: fakeComputer(home).config });
  const elsewhere = await startCore({ llm, computer: fakeComputer(home, undefined, { supported: false }).config });
  try {
    await env.client.call("threads.send", { thread: "home", text: "Hello" });
    await env.settle("home");
    // Never set up: still offered, so asked to use it the agent starts it (and asks) instead of saying it cannot.
    assert.equal(seen[0]?.includes("computer"), true);
    await elsewhere.client.call("threads.send", { thread: "home", text: "Hello" });
    await elsewhere.settle("home");
    assert.equal(seen[1]?.includes("computer"), false, "a host that cannot run it offers no tool");
    await assert.rejects(env.client.call("environments.enable", { thread: "home", appearance: "light" }), /allow it/);
    await assert.rejects(env.client.call("environments.bind", { thread: "home" }), /may not use the computer/);
    const status = await env.client.call("environments.status", { thread: "home" });
    assert.equal(status.enabled, false);
    assert.equal(status.chat?.on, false);
  } finally {
    await env.core.close();
    env.cleanup();
    await elsewhere.core.close();
    elsewhere.cleanup();
  }
});

test("once set up, an agent asks with a card; allowed for good, it starts the shared computer, takes its own screen and leaves", async () => {
  const home = tempDir("apx-vm-tool-").path;
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
    await waitFor(async () => (await env.client.call("environments.status", {})).phase === "running", "owner start");
    await env.client.call("environments.stop", {});
    await waitFor(async () => (await env.client.call("environments.status", {})).phase === "stopped", "owner stop");

    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await env.client.call("threads.send", { thread: chat.id, text: "Try the site on Linux" });
    let input: PendingInput | undefined;
    await waitFor(async () => {
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
  const home = tempDir("apx-vm-tool-").path;
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
    const refused = results(llm.calls.at(-1) as LlmRequest)[0] ?? "";
    assert.match(refused, /not enough free memory on this computer/);
    // Told how to say it to the owner, with the way to fix it: never left to retry in a loop.
    assert.match(refused, /in their language.+\[Computer\]\(apx:computer\).+do not try again/);
    assert.deepEqual(vm.calls, []);
    // The owner starts it anyway: only the VM's own 4 GiB must be free, and 5 GiB are.
    await env.client.call("environments.enable", { thread: "home", appearance: "light", past_reserve: true });
    await waitFor(async () => (await env.client.call("environments.status", {})).phase === "running", "start");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("only the owner or the allowed agent's own run starts and stops it; taking the permission away ends its turns", async () => {
  const home = tempDir("apx-vm-tool-").path;
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ home, llm, computer: fakeComputer(home).config });
  try {
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.start", { thread: "home" }), { code: "unauthorized" });
    await assert.rejects(agent.call("environments.release", { thread: "home" }), { code: "unauthorized" });
    await assert.rejects(agent.call("environments.permit", { agent: "roby", on: true }), { code: "unauthorized" });
    // Starting past the host's reserve is the owner's alone.
    await assert.rejects(agent.call("environments.enable", { appearance: "light", past_reserve: true }), {
      code: "unauthorized",
    });
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
  const home = tempDir("apx-vm-tool-").path;
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

test("approving the computer card without a scope allows the agent for that chat, not for one call", async () => {
  const home = tempDir("apx-vm-tool-").path;
  const vm = fakeComputer(home);
  const llm = scriptedLlm((req) =>
    results(req).length ? say("Done") : callTool("start", "computer", { action: "start" }),
  );
  const env = await startCore({ home, llm, computer: vm.config });
  try {
    env.core.store.settings.set("computer_enabled", "true");
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await env.client.call("threads.send", { thread: chat.id, text: "Use the computer" });
    const input = await waitFor(
      async () => (await env.client.call("runs.pending", { thread: chat.id })).inputs[0],
      "the card",
    );
    await env.client.call("runs.respond", { input: input.id, decision: "approve" });
    await env.settle(chat.id);
    assert.match(results(llm.calls.at(-1) as LlmRequest)[0] ?? "", /Computer \(shared by the agents\)/);
    const grants = (await env.client.call("tools.approvals", { thread: chat.id })).approvals;
    assert.ok(grants.some((g) => g.key === COMPUTER_GRANT && g.scope === "session" && g.thread_id === chat.id));
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("a screen that does not start in time leaves the agent a clear 'still starting', not a tool timeout", async () => {
  const home = tempDir("apx-vm-tool-").path;
  const llm = scriptedLlm((req) =>
    results(req).length ? say("Waiting") : callTool("start", "computer", { action: "start" }),
  );
  const config = {
    ...fakeComputer(home).config,
    claimMs: 200,
    screens: { start: () => new Promise<void>(() => {}), stop: async () => {} },
  };
  const env = await startCore({ home, llm, computer: config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    // Up already, with no chat on it: the agent's own start is what asks for its screen.
    await env.client.call("environments.enable", { appearance: "light" });
    await waitFor(async () => (await env.client.call("environments.status", {})).phase === "running", "running");
    await env.client.call("threads.send", { thread: "home", text: "Start your computer" });
    await env.settle("home");
    assert.match(results(llm.calls.at(-1) as LlmRequest)[0] ?? "", /still starting: check again with status/);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("a computer that takes minutes to come up ends the turn, and its chat gets one turn the moment it is ready", async () => {
  const home = tempDir("apx-vm-tool-").path;
  let boot = () => {};
  const vm = fakeComputer(home, undefined, { boot: new Promise<void>((resolve) => (boot = resolve)) });
  const llm = scriptedLlm((req, { said }) => {
    if (said.includes("is ready")) return say("Lista, sigo con la tienda");
    return results(req).length ? say("Ahora te aviso") : callTool("start", "computer", { action: "start" });
  });
  const env = await startCore({ home, llm, computer: vm.config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("threads.send", { thread: "home", text: "Probá la tienda en la computadora" });
    await env.settle("home", 15_000);
    assert.match(
      results(llm.calls.at(-1) as LlmRequest)[0] ?? "",
      /You get a turn in this chat the moment it is ready/,
    );
    const calls = llm.calls.length;
    boot();
    const answered = async () => {
      const t = await env.client.call("threads.get", { thread: "home" });
      return t.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text.includes("Lista, sigo")));
    };
    await waitFor(answered, "the turn once the computer is ready");
    assert.equal(llm.calls.length, calls + 1, "one turn, no checking in between");
    const { runs } = await env.client.call("threads.get", { thread: "home" });
    assert.ok(runs.some((r) => r.trigger === "system"));
  } finally {
    boot();
    await env.core.close();
    env.cleanup();
  }
});

test("the computer's status says what it runs with now and, apart, what the owner set for its next start", async () => {
  const home = tempDir("apx-vm-tool-").path;
  const llm = scriptedLlm((req) =>
    results(req).length ? say("ok") : callTool("look", "computer", { action: "status" }),
  );
  const config = { ...fakeComputer(home).config, applied: () => ({ memory_gib: 6, cpus: 4, disk_gib: 32 }) };
  const env = await startCore({ home, llm, computer: config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.configure", { memory_gib: 4, cpus: 2 });
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    await waitFor(async () => (await env.client.call("environments.status", {})).phase === "running", "running");
    await env.client.call("threads.send", { thread: "home", text: "¿Con cuánto corre la computadora?" });
    await env.settle("home");
    assert.match(
      results(llm.calls.at(-1) as LlmRequest)[0] ?? "",
      /running with 6 GiB memory, 4 CPUs, 32 GiB disk; set to 4 GiB memory, 2 CPUs, 32 GiB disk from its next start/,
    );
    await env.client.call("environments.stop", {});
    await waitFor(async () => (await env.client.call("environments.status", {})).phase === "stopped", "stopped");
    const off = await env.client.call("environments.status", {});
    assert.equal(off.running_resources, undefined, "off, it runs with nothing");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("on the computer, the owner's own agents' results run in its chat; a contact's message is refused in words", async () => {
  const home = tempDir("apx-vm-tool-").path;
  const llm = scriptedLlm(() => say("Te cuento lo que hizo Scout"));
  const env = await startCore({ home, llm, computer: fakeComputer(home).config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    await waitFor(async () => (await env.client.call("environments.status", {})).phase === "running", "running");
    const { engine, store } = env.core;
    // A task Roby gave Scout is closed: its report comes back to Roby's chat, which works on the computer.
    engine.admit({
      thread_id: "home",
      agent_id: "roby",
      trigger: "a2a_result",
      origin: {
        kind: "task_result",
        task_id: "task_1",
        title: "Acme report",
        state: "done",
        agent_id: "scout",
        name: "Scout",
      },
      text: "Done",
    });
    const reported = await env.settle("home");
    assert.equal(reported.runs.at(-1)?.state, "completed");

    const runs = async () => (await env.client.call("threads.get", { thread: "home" })).runs;
    const before = (await runs()).length;
    engine.admit({
      thread_id: "home",
      agent_id: "roby",
      trigger: "channel",
      origin: {
        kind: "hours_began",
        channel: "telegram",
        conversation: "c1",
        person_id: "p1",
        name: "Northwind",
        since: "",
      },
      text: "",
    });
    const failed = await waitFor(async () => {
      const now = await runs();
      return now.length > before && now.every((r) => r.ended_at) ? now : undefined;
    }, "the contact's turn");
    assert.equal(failed.find((r) => r.trigger === "channel")?.state, "failed");
    const notice = store.messages
      .list("home")
      .flatMap((m) => m.parts)
      .findLast((p) => p.type === "notice");
    assert.equal(notice?.type === "notice" && notice.code, "computer.notOwners");
    assert.equal(notice?.type === "notice" && notice.vars?.agent, "Roby");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("the owner starts the computer, the agent only looks: once it is up the agent is on its screen and carries on", async () => {
  const home = tempDir("apx-vm-tool-").path;
  let boot = () => {};
  const vm = fakeComputer(home, undefined, { boot: new Promise<void>((resolve) => (boot = resolve)) });
  let screenInReadyTurn: number | undefined;
  const llm = scriptedLlm(async (req, { said }) => {
    if (said.includes("is ready")) {
      screenInReadyTurn = (await env.client.call("environments.status", { thread: "home" })).screens?.find(
        (s) => s.agent === "roby" && s.run,
      )?.screen;
      return say("Ya estoy en mi pantalla, sigo con la tienda.");
    }
    return results(req).length ? say("Está arrancando, te aviso.") : callTool("look", "computer", { action: "status" });
  });
  const env = await startCore({ home, llm, computer: vm.config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    // The owner turns it on for this chat from its panel; it takes a while to come up.
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    await env.client.call("threads.send", { thread: "home", text: "Usá la computadora para probar la tienda" });
    await env.settle("home", 15_000);
    assert.match(results(llm.calls.at(-1) as LlmRequest)[0] ?? "", /you get a turn here the moment it is ready/);
    boot();
    await waitFor(async () => {
      const t = await env.client.call("threads.get", { thread: "home" });
      return t.messages.some((m) =>
        m.parts.some((p) => p.type === "text" && p.text.includes("Ya estoy en mi pantalla")),
      );
    }, "the agent's turn once the computer is up");
    assert.equal(screenInReadyTurn, 1, "its own screen, taken for that turn");
  } finally {
    boot();
    await env.core.close();
    env.cleanup();
  }
});

test("the computer already coming up for no chat: the agent's start waits on it and it carries on on its screen", async () => {
  const home = tempDir("apx-vm-tool-").path;
  let boot = () => {};
  const vm = fakeComputer(home, undefined, { boot: new Promise<void>((resolve) => (boot = resolve)) });
  const llm = scriptedLlm((req, { said }) => {
    if (said.includes("is ready")) return say("Lista, sigo.");
    return results(req).length ? say("Ahora te aviso.") : callTool("start", "computer", { action: "start" });
  });
  const env = await startCore({ home, llm, computer: vm.config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    // Started from the Computers view, for no chat in particular.
    await env.client.call("environments.enable", { appearance: "light" });
    await env.client.call("threads.send", { thread: "home", text: "Probá la tienda en la computadora" });
    await env.settle("home", 15_000);
    assert.match(
      results(llm.calls.at(-1) as LlmRequest)[0] ?? "",
      /You get a turn in this chat the moment it is ready/,
    );
    boot();
    await waitFor(async () => {
      const t = await env.client.call("threads.get", { thread: "home" });
      return t.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text.includes("Lista, sigo")));
    }, "the agent's turn once the computer is up");
    assert.equal((await env.client.call("environments.status", { thread: "home" })).chat?.screen, 1);
  } finally {
    boot();
    await env.core.close();
    env.cleanup();
  }
});

test("the owner stops the computer while the agent waits for it: the agent is not woken to hear it", async () => {
  const home = tempDir("apx-vm-tool-").path;
  let boot = () => {};
  const vm = fakeComputer(home, undefined, { boot: new Promise<void>((resolve) => (boot = resolve)) });
  const llm = scriptedLlm((req) =>
    results(req).length ? say("Te aviso.") : callTool("look", "computer", { action: "status" }),
  );
  const env = await startCore({ home, llm, computer: vm.config });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.enable", { thread: "home", appearance: "light" });
    await env.client.call("threads.send", { thread: "home", text: "Usá la computadora" });
    await env.settle("home", 15_000);
    assert.equal(env.core.computer?.waiting(), 1, "waiting on it");
    const stopped = env.client.call("environments.stop", {});
    boot();
    await stopped;
    assert.equal(env.core.computer?.waiting(), 0, "the wait ended with the owner's stop");
  } finally {
    boot();
    await env.core.close();
    env.cleanup();
  }
});
