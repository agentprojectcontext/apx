import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import WebSocket from "ws";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createVmPrototype } from "../environments/prototype.ts";

test("VM prototype is disabled by default over HTTP and WS; agent clients cannot acquire a screen", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const http = await env.client.call("environments.status", {});
    const socket = await env.client.connect();
    try {
      assert.deepEqual(await socket.call("environments.status", {}), http);
    } finally {
      socket.close();
    }
    assert.equal(http.enabled, false);
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.display", { thread: "home" }), { code: "unauthorized" });
    assert.equal(fs.existsSync(path.join(env.home, "computer")), false);
    await assert.rejects(env.client.call("environments.display", { thread: "home" }), /no.*VM/i);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("VM binding refuses unknown chats and cross-chat commands; host terminal never opens for a bound chat", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-test-"));
  const env = await startCore({
    home,
    llm: scriptedLlm(() => say("ok")),
    vmPrototype: { limaHome: path.join(home, "no-vms"), instance: "missing", model: "fake/default" },
  });
  try {
    await assert.rejects(env.client.call("environments.bind", { thread: "unknown" }), /owner/i);
    await env.client.call("environments.bind", { thread: "home" });
    await env.client.call("agents.update", { agent: "roby", model_choice: { model: "fake/agent", router: false } });
    assert.equal((await env.client.call("environments.status", {})).model, "fake/agent");
    await env.client.call("threads.model", { thread: "home", model_choice: { model: "fake/chat", router: false } });
    assert.equal((await env.client.call("environments.status", {})).model, "fake/chat");
    const other = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await assert.rejects(env.client.call("environments.bind", { thread: other.id }), /another chat/i);
    await assert.rejects(
      env.client.call("environments.command", { thread: other.id, command: "pwd" }),
      /no prototype/i,
    );
    await assert.rejects(env.client.call("terminal.open", { thread: "home", cols: 80, rows: 24 }), /VM terminal/i);
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.command", { thread: "home", command: "pwd" }), /bound native run/i);
    assert.deepEqual((await env.client.call("terminal.list", { thread: "home" })).terminals, []);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("native VM turns expose guest shell and browser tools and never fall back to host when Lima is unavailable", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-test-"));
  const marker = path.join(home, "must-not-exist");
  const llm = scriptedLlm((req, { afterTool }) => {
    assert.deepEqual(
      req.tools.map((tool) => tool.function.name).sort(),
      [
        "shell",
        "browser_open",
        "browser_navigate",
        "browser_snapshot",
        "browser_text",
        "browser_click",
        "browser_type",
      ].sort(),
    );
    return afterTool ? say("The VM is unavailable") : callTool("vm-call", "shell", { command: `touch '${marker}'` });
  });
  const env = await startCore({ home, llm, vmPrototype: { limaHome: path.join(home, "no-vms"), instance: "missing" } });
  try {
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    await env.client.call("environments.bind", { thread: "home" });
    await env.client.call("threads.send", { thread: "home", text: "Create a file in the VM" });
    const result = await env.settle("home");
    assert.equal(fs.existsSync(marker), false);
    const parts = result.messages.flatMap((message) => message.parts);
    assert.ok(
      parts.some(
        (part) => part.type === "tool" && part.status === "error" && /VM command failed/.test(part.detail ?? ""),
      ),
    );
    assert.ok(llm.calls.length >= 2);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("display tickets are single-use, bounded and revoked at shutdown without spawning a guest", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const vm = createVmPrototype(env.core.store, { limaHome: path.join(env.home, "no-vms"), instance: "missing" });
  try {
    vm.bind("home");
    const first = vm.display("home");
    assert.equal(typeof vm.connectDisplay(first.ticket), "function");
    assert.throws(() => vm.connectDisplay(first.ticket), /expired/i);
    const pending = Array.from({ length: 6 }, () => vm.display("home"));
    assert.throws(() => vm.display("home"), /too many/i);
    vm.close();
    assert.throws(() => vm.connectDisplay(pending[0]?.ticket ?? ""), /expired/i);
  } finally {
    vm.close();
    await env.core.close();
    env.cleanup();
  }
});

test("a failed guest browser never reaches a connected host browser node", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-browser-"));
  const llm = scriptedLlm((_req, { afterTool }) =>
    afterTool ? say("Guest browser unavailable") : callTool("open", "browser_open", { url: "https://example.com" }),
  );
  const env = await startCore({ home, llm, vmPrototype: { limaHome: path.join(home, "no-vms"), instance: "missing" } });
  const desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  const hostCalls: string[] = [];
  desktop.onRequest(async (method) => {
    hostCalls.push(method);
    throw new Error("host browser must not be called by a VM chat");
  });
  try {
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    await env.client.call("environments.bind", { thread: "home" });
    await env.client.call("threads.send", { thread: "home", text: "Open a page inside the VM" });
    const result = await env.settle("home");
    const browser = result.messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === "tool" && part.tool === "browser_open");
    assert.equal(browser?.type === "tool" && browser.status, "error");
    assert.deepEqual(hostCalls, []);
    assert.equal(llm.calls.length, 2);
  } finally {
    desktop.close();
    await env.core.close();
    env.cleanup();
  }
});

test("restarting a VM-bound chat without its backend refuses a turn before any model or host tool runs", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vm-restart-"));
  const first = await startCore({
    home,
    llm: scriptedLlm(() => say("ok")),
    vmPrototype: { limaHome: path.join(home, "no-vms"), instance: "missing" },
  });
  await first.client.call("environments.bind", { thread: "home" });
  await first.core.close();
  const llm = scriptedLlm(() => {
    throw new Error("a VM-bound chat must not call a model without its backend");
  });
  const second = await startCore({ home, llm });
  try {
    await second.client.call("threads.send", { thread: "home", text: "Run a command" });
    const result = await second.settle("home");
    assert.equal(result.runs[0]?.state, "failed");
    assert.equal(second.core.store.threads.get("home")?.state, "failed");
    assert.ok(
      result.messages.some((message) =>
        message.parts.some((part) => part.type === "notice" && part.code === "computer.unavailable"),
      ),
    );
    assert.equal(llm.calls.length, 0);
  } finally {
    await second.core.close();
    second.cleanup();
  }
});

test("only the owner controls lifecycle; stop revokes tickets, cancels the native turn and blocks host fallback", async () => {
  let running = true;
  let signal: AbortSignal | undefined;
  const modes: string[] = [];
  const { createVmLifecycle } = await import("../environments/lifecycle.ts");
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
    prepare: async (mode) => {
      modes.push(mode);
      running = true;
    },
    stop: async () => {
      running = false;
    },
    appearance: async (mode) => {
      modes.push(mode);
    },
  });
  const llm = scriptedLlm(async (req) => {
    signal = req.signal;
    await new Promise<void>((resolve) => {
      if (req.signal?.aborted) resolve();
      else req.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return say("Stopped");
  });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-computer-control-"));
  const env = await startCore({
    home,
    llm,
    vmPrototype: { limaHome: path.join(home, "no-vms"), instance: "missing", lifecycle },
  });
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  const socket = await env.client.connect();
  try {
    await env.client.call("environments.bind", { thread: "home" });
    await assert.rejects(agent.call("environments.enable", { thread: "home", appearance: "light" }), {
      code: "unauthorized",
    });
    await assert.rejects(agent.call("environments.stop", { thread: "home" }), { code: "unauthorized" });
    await assert.rejects(agent.call("environments.appearance", { thread: "home", appearance: "dark" }), {
      code: "unauthorized",
    });
    const ticket = await env.client.call("environments.display", { thread: "home" });
    const other = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await assert.rejects(socket.call("environments.stop", { thread: other.id }), /no.*VM/);
    assert.equal(running, true);
    await env.client.call("threads.send", { thread: "home", text: "Work inside the computer" });
    const deadline = Date.now() + 2000;
    while (!signal) {
      assert.ok(Date.now() < deadline, "native turn did not start");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await socket.call("environments.stop", { thread: "home" });
    await env.settle("home");
    assert.equal(signal.aborted, true);
    assert.equal(running, false);
    assert.equal(env.core.store.runs.list("home")[0]?.state, "canceled");
    await assert.rejects(
      env.client.call("environments.command", { thread: "home", command: "pwd" }),
      /stopped|not ready/,
    );
    await assert.rejects(
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${env.core.url.replace("http", "ws")}/vm-display?ticket=${ticket.ticket}`, {
          origin: env.core.url,
        });
        ws.once("open", () => {
          ws.close();
          resolve();
        });
        ws.once("unexpected-response", (_request, response) => {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
        });
        ws.once("error", reject);
      }),
      /403/,
    );
    const count = llm.calls.length;
    await env.client.call("threads.send", { thread: "home", text: "Try another command" });
    const result = await env.settle("home");
    assert.equal(llm.calls.length, count);
    assert.ok(result.runs.some((run) => run.state === "failed"));
    await socket.call("environments.enable", { thread: "home", appearance: "dark" });
    const readyDeadline = Date.now() + 2000;
    while (!(await env.client.call("environments.status", {})).ready) {
      assert.ok(Date.now() < readyDeadline);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal((await socket.call("environments.status", {})).thread, "home");
    assert.deepEqual(modes, ["dark"]);
  } finally {
    socket.close();
    await env.core.close();
    env.cleanup();
  }
});

test("shutdown terminates an in-flight guest command's local SSH process", async () => {
  const { createVmLifecycle } = await import("../environments/lifecycle.ts");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-computer-command-"));
  const pidFile = path.join(home, "ssh.pid");
  const binary = path.join(home, "guest.mjs");
  fs.writeFileSync(
    binary,
    `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 10000);\n`,
    { mode: 0o755 },
  );
  let running = true;
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
    prepare: async () => {},
    stop: async () => {
      running = false;
    },
    appearance: async () => {},
  });
  const env = await startCore({
    home,
    llm: scriptedLlm(() => say("ok")),
    vmPrototype: {
      limaHome: path.join(home, "no-vms"),
      instance: "missing",
      executable: () => binary,
      lifecycle,
    },
  });
  let pid: number | undefined;
  try {
    await env.client.call("environments.bind", { thread: "home" });
    await env.client.call("environments.control", { thread: "home", mode: "human" });
    const command = env.client.call("environments.command", { thread: "home", command: "long guest work" });
    const rejected = assert.rejects(command, /VM command failed/);
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(pidFile)) {
      assert.ok(Date.now() < deadline, "guest SSH process did not start");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    pid = Number(fs.readFileSync(pidFile, "utf8"));
    await env.client.call("environments.stop", { thread: "home" });
    await rejected;
    assert.throws(() => process.kill(pid ?? 0, 0), { code: "ESRCH" });
    assert.equal(running, false);
  } finally {
    if (pid) {
      try {
        process.kill(pid);
      } catch {}
    }
    await env.core.close();
    env.cleanup();
  }
});

test("taking manual control cancels the active native turn, persists an interruption and refuses agent work until handback", async () => {
  let started: () => void = () => {};
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const llm = scriptedLlm(async (request) => {
    started();
    await new Promise<void>((resolve) => request.signal?.addEventListener("abort", () => resolve(), { once: true }));
    return say("Stopped");
  });
  const env = await startCore({ llm, vmPrototype: { limaHome: "/unused", instance: "missing" } });
  try {
    await env.client.call("environments.bind", { thread: "home" });
    await assert.rejects(env.client.call("environments.command", { thread: "home", command: "pwd" }), /Take control/);
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.control", { thread: "home", mode: "human" }), {
      code: "unauthorized",
    });
    await env.client.call("threads.send", { thread: "home", text: "Work in the VM" });
    await active;
    await env.client.call("environments.control", { thread: "home", mode: "human" });
    const result = await env.settle("home");
    assert.equal(result.runs[0]?.state, "canceled");
    assert.ok(
      result.messages.some((m) => m.parts.some((p) => p.type === "notice" && p.code === "computer.interrupted")),
    );
    assert.equal((await env.client.call("environments.status", {})).control, "human");
    const count = llm.calls.length;
    await env.client.call("threads.send", { thread: "home", text: "Try while owner controls" });
    await env.settle("home");
    assert.equal(llm.calls.length, count);
    assert.equal(env.core.store.threads.get("home")?.state, "failed");
    await env.client.call("environments.control", { thread: "home", mode: "agent" });
    assert.equal((await env.client.call("environments.status", {})).control, "agent");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("task conversations cannot redirect a VM-bound request into an unbound worker chat", async () => {
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    vmPrototype: { limaHome: "/unused", instance: "missing" },
  });
  try {
    const task = await env.client.call("tasks.create", { title: "Acme work", assignee: "roby" });
    await assert.rejects(env.client.call("environments.bind", { thread: task.thread_id }), /owner.*native chat/);
    assert.equal((await env.client.call("environments.status", {})).thread, undefined);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("a stopped computer releases its deleted chat and can bind another without losing the guest disk", async () => {
  const { createVmLifecycle } = await import("../environments/lifecycle.ts");
  let running = true;
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => running,
    prepare: async () => {},
    stop: async () => {
      running = false;
    },
    appearance: async () => {},
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    vmPrototype: { limaHome: "/unused", instance: "missing", lifecycle },
  });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("environments.bind", { thread: chat.id });
    await assert.rejects(env.client.call("threads.delete", { thread: chat.id }), /stop Computer/);
    assert.ok(env.core.store.threads.get(chat.id));
    await env.client.call("environments.stop", { thread: chat.id });
    const deadline = Date.now() + 2000;
    while ((await env.client.call("environments.status", {})).phase !== "stopped") {
      assert.ok(Date.now() < deadline);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await env.client.call("threads.delete", { thread: chat.id });
    assert.equal((await env.client.call("environments.status", {})).thread, undefined);
    await env.client.call("environments.bind", { thread: "home" });
    assert.equal((await env.client.call("environments.status", {})).thread, "home");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("VM availability does not advertise browser tools to an ordinary chat without a browser node", async () => {
  const llm = scriptedLlm((request) => {
    assert.equal(
      request.tools.some((tool) => tool.function.name.startsWith("browser_")),
      false,
    );
    return say("ok");
  });
  const env = await startCore({ llm });
  try {
    await env.client.call("threads.send", { thread: "home", text: "Hello" });
    await env.settle("home");
    assert.equal(llm.calls.length, 1);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
