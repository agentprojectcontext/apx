import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import WebSocket from "ws";
import { testConfig } from "../config.ts";
import { callTool, computerChat, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createComputer } from "../environments/computer.ts";
import { DISPLAY_CAP } from "../environments/guest-operations.ts";
import { createVmLifecycle } from "../environments/lifecycle.ts";
import { createCore } from "../server.ts";
import { RUNS_SCRIPTS, removeDir, tempDir, waitFor } from "../testkit/platform.ts";

/** A guest that is up, or not, as the test says; preparing it only flips it on. */
function fakeLifecycle(state = { running: true }, modes: string[] = []) {
  return createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => state.running,
    prepare: async (mode) => {
      modes.push(mode);
      state.running = true;
    },
    stop: async () => {
      state.running = false;
    },
    appearance: async (mode) => {
      modes.push(mode);
    },
  });
}

/** The core's own tools a chat on the computer keeps beside the guest's (DECISIONS.md#d-154). */
const KEPT = [
  "delegate",
  "forget",
  "list_agents",
  "list_sessions",
  "read_output",
  "recall",
  "remember",
  "task_close",
  "task_comment",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
  "web_read",
  "web_search",
];

test("the computer is off by default over HTTP and WS; agent clients cannot acquire a screen", async () => {
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
    assert.deepEqual(http.screens, []);
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.display", { screen: 1 }), { code: "unauthorized" });
    assert.equal(fs.existsSync(path.join(env.home, "computer")), false);
    await assert.rejects(env.client.call("environments.display", { screen: 1 }), /not running/);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("chats go on the computer only for allowed agents; outside clients run nothing and the host terminal stays shut", async () => {
  const home = tempDir("apx-vm-test-").path;
  const env = await startCore({
    home,
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: path.join(home, "no-vms"), instance: "missing" },
  });
  try {
    const chat = await computerChat(env);
    await assert.rejects(env.client.call("environments.bind", { thread: "unknown" }), /owner/i);
    await assert.rejects(env.client.call("environments.bind", { thread: chat }), /may not use the computer/i);
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    // The computer is shared: another allowed agent's chat goes on it too.
    const other = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    await env.client.call("environments.permit", { agent: "scout", on: true });
    await env.client.call("environments.bind", { thread: other.id });
    const status = await env.client.call("environments.status", { thread: other.id });
    assert.deepEqual(status.chat, { thread: other.id, on: true, agent: "scout", agent_name: "Scout", permitted: true });
    // Each agent's card reads whether it may use the computer from here.
    assert.deepEqual([...(status.allowed ?? [])].sort(), ["roby", "scout"]);
    assert.equal(status.allowed_agents, 2);
    await assert.rejects(env.client.call("terminal.open", { thread: chat, cols: 80, rows: 24 }), /VM terminal/i);
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.command", { thread: chat, command: "pwd" }), /bound native run/i);
    assert.deepEqual((await env.client.call("terminal.list", { thread: chat })).terminals, []);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("native VM turns expose guest shell and browser tools and never fall back to host when Lima is unavailable", async () => {
  const home = tempDir("apx-vm-test-").path;
  const marker = path.join(home, "must-not-exist");
  const llm = scriptedLlm((req, { afterTool }) => {
    assert.deepEqual(
      req.tools.map((tool) => tool.function.name).sort(),
      [
        "shell",
        "computer",
        "browser_open",
        "browser_snapshot",
        "browser_text",
        "browser_click",
        "browser_type",
        ...KEPT,
      ].sort(),
    );
    return afterTool ? say("The VM is unavailable") : callTool("vm-call", "shell", { command: `touch '${marker}'` });
  });
  const env = await startCore({ home, llm, computer: { limaHome: path.join(home, "no-vms"), instance: "missing" } });
  try {
    const chat = await computerChat(env);
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    await env.client.call("threads.send", { thread: chat, text: "Create a file in the VM" });
    const result = await env.settle(chat);
    assert.equal(fs.existsSync(marker), false);
    const parts = result.messages.flatMap((message) => message.parts);
    assert.ok(
      parts.some(
        (part) => part.type === "tool" && part.status === "error" && /VM command failed/.test(part.detail ?? ""),
      ),
    );
    assert.ok(llm.calls.length >= 2);
    assert.deepEqual(env.core.store.settings.read("computer_claims"), [], "its screen is let go when the run ends");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("display tickets are single-use, bounded and revoked at shutdown without spawning a guest", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const vm = createComputer(env.core.store, { limaHome: path.join(env.home, "no-vms"), instance: "missing" });
  try {
    // Only an agent screen that is up can be watched.
    assert.throws(() => vm.display(1), /not running/i);
    await vm.ledger.claim("roby", "home", "run_test");
    const first = vm.display(1);
    assert.equal(typeof vm.connectDisplay(first.ticket).open, "function");
    assert.throws(() => vm.connectDisplay(first.ticket), /expired/i);
    assert.throws(() => vm.display(4), /not running/i);
    // A viewer asked for again (a reconnect, a re-render) replaces the one asked for before: never the cap.
    const pending = Array.from({ length: 30 }, () => vm.display(1));
    assert.throws(() => vm.connectDisplay(pending[0]?.ticket ?? ""), /expired/i, "the oldest gave way");
    await vm.close();
    assert.throws(() => vm.connectDisplay(pending.at(-1)?.ticket ?? ""), /expired/i);
  } finally {
    await vm.close();
    await env.core.close();
    env.cleanup();
  }
});

test("a failed guest browser never reaches a connected host browser node", async () => {
  const home = tempDir("apx-vm-browser-").path;
  const llm = scriptedLlm((_req, { afterTool }) =>
    afterTool ? say("Guest browser unavailable") : callTool("open", "browser_open", { url: "https://example.com" }),
  );
  const env = await startCore({ home, llm, computer: { limaHome: path.join(home, "no-vms"), instance: "missing" } });
  const desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  const hostCalls: string[] = [];
  desktop.onRequest(async (method) => {
    hostCalls.push(method);
    throw new Error("host browser must not be called by a VM chat");
  });
  try {
    const chat = await computerChat(env);
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    await env.client.call("threads.send", { thread: chat, text: "Open a page inside the VM" });
    const result = await env.settle(chat);
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

test("a chat on the computer keeps make_image, which takes only earlier drawings as references there", async () => {
  const home = tempDir("apx-vm-test-").path;
  const offered: string[][] = [];
  const llm = scriptedLlm((req, { afterTool }) => {
    offered.push(req.tools.map((tool) => tool.function.name));
    return afterTool
      ? say("done")
      : callTool("img", "make_image", { prompt: "a tower with drones", references: ["/etc/hosts"] });
  });
  const env = await startCore({ home, llm, computer: { limaHome: path.join(home, "no-vms"), instance: "missing" } });
  try {
    const chat = await computerChat(env);
    await env.client.call("services.set", {
      id: "img",
      service: {
        kind: "image",
        dialect: "openai-images",
        label: "Images",
        base_url: "http://127.0.0.1:9",
        enabled: true,
        needs_key: false,
      },
    });
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    await env.client.call("threads.send", { thread: chat, text: "Draw a tower with drones" });
    const result = await env.settle(chat);
    assert.ok(offered[0]?.includes("make_image"), String(offered[0]));
    assert.ok(!offered[0]?.includes("send_file"), "host file tools stay out");
    const parts = result.messages.flatMap((message) => message.parts);
    assert.ok(
      parts.some((part) => part.type === "tool" && part.status === "error" && /med_ ids/.test(part.detail ?? "")),
    );
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("a VM-bound chat restarted on a core whose computer is not set up offers only guest tools, never the host's", async () => {
  const home = tempDir("apx-vm-restart-").path;
  const first = await startCore({
    home,
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: path.join(home, "no-vms"), instance: "missing" },
  });
  const chat = await computerChat(first);
  await first.client.call("environments.permit", { agent: "roby", on: true });
  await first.client.call("environments.bind", { thread: chat });
  await first.core.close();
  const offered: string[] = [];
  const llm = scriptedLlm((req) => {
    offered.push(...req.tools.map((tool) => tool.function.name));
    return say("The computer is not set up here");
  });
  const second = await startCore({ home, llm });
  try {
    await second.client.call("threads.send", { thread: chat, text: "Run a command" });
    await second.settle(chat);
    assert.ok(offered.length > 0);
    assert.deepEqual(
      offered.filter(
        (name) => name !== "shell" && name !== "computer" && !name.startsWith("browser_") && !KEPT.includes(name),
      ),
      [],
    );
  } finally {
    await second.core.close();
    second.cleanup();
  }
});

test("only the owner shuts the shared computer down; it cancels the turns holding screens and blocks host fallback", async () => {
  const state = { running: true };
  const modes: string[] = [];
  let signal: AbortSignal | undefined;
  const offered: string[][] = [];
  const llm = scriptedLlm(async (req) => {
    if (signal) {
      offered.push(req.tools.map((tool) => tool.function.name).sort());
      return say("The computer is off");
    }
    signal = req.signal;
    await new Promise<void>((resolve) => {
      if (req.signal?.aborted) resolve();
      else req.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return say("Stopped");
  });
  const home = tempDir("apx-computer-control-").path;
  const env = await startCore({
    home,
    llm,
    computer: { limaHome: path.join(home, "no-vms"), instance: "missing", lifecycle: fakeLifecycle(state, modes) },
  });
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  const socket = await env.client.connect();
  try {
    const chat = await computerChat(env);
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    await assert.rejects(agent.call("environments.enable", { thread: chat, appearance: "light" }), {
      code: "unauthorized",
    });
    await assert.rejects(agent.call("environments.stop", {}), { code: "unauthorized" });
    await assert.rejects(agent.call("environments.appearance", { appearance: "dark" }), { code: "unauthorized" });
    await env.client.call("environments.status", {});
    await env.client.call("threads.send", { thread: chat, text: "Work inside the computer" });
    const deadline = Date.now() + 2000;
    while (!signal) {
      assert.ok(Date.now() < deadline, "native turn did not start");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const held = (await env.client.call("environments.status", {})).screens?.find((s) => s.agent === "roby");
    assert.equal(held?.thread, chat);
    const ticket = await env.client.call("environments.display", { screen: 1 });
    await socket.call("environments.stop", {});
    await env.settle(chat);
    assert.equal(signal.aborted, true);
    assert.equal(state.running, false);
    assert.equal(env.core.store.runs.list(chat)[0]?.state, "canceled");
    assert.equal((await env.client.call("environments.status", {})).last_stop?.reason, "owner");
    await assert.rejects(
      env.client.call("environments.command", { thread: chat, command: "pwd", screen: 1 }),
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
    // Stopped, the chat keeps to the computer: the agent may start it again, and still has no host tool.
    await env.client.call("threads.send", { thread: chat, text: "Try another command" });
    await env.settle(chat);
    assert.deepEqual(
      offered.at(-1),
      [
        "browser_click",
        "browser_open",
        "browser_snapshot",
        "browser_text",
        "browser_type",
        "computer",
        "shell",
        ...KEPT,
      ].sort(),
    );
    await socket.call("environments.enable", { thread: chat, appearance: "dark" });
    const readyDeadline = Date.now() + 2000;
    while (!(await env.client.call("environments.status", {})).ready) {
      assert.ok(Date.now() < readyDeadline);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal((await socket.call("environments.status", { thread: chat })).chat?.on, true);
    assert.deepEqual(modes, ["dark"]);
  } finally {
    socket.close();
    await env.core.close();
    env.cleanup();
  }
});

// portable: stands in for the Mac-only driver with a script binary (RUNS_SCRIPTS).
if (RUNS_SCRIPTS)
  test("shutdown terminates an in-flight guest command's local SSH process", async () => {
    const home = tempDir("apx-computer-command-").path;
    const pidFile = path.join(home, "ssh.pid");
    const binary = path.join(home, "guest.mjs");
    fs.writeFileSync(
      binary,
      `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 10000);\n`,
      { mode: 0o755 },
    );
    const state = { running: true };
    const env = await startCore({
      home,
      llm: scriptedLlm(() => say("ok")),
      computer: {
        limaHome: path.join(home, "no-vms"),
        instance: "missing",
        executable: () => binary,
        lifecycle: fakeLifecycle(state),
      },
    });
    let pid: number | undefined;
    try {
      const chat = await computerChat(env);
      await env.client.call("environments.status", {});
      // The owner takes an agent's screen that is up, and types there.
      await env.core.computer.ledger.claim("roby", chat, "run_test");
      await env.client.call("environments.control", { screen: 1, mode: "human" });
      const command = env.client.call("environments.command", { thread: chat, command: "long guest work", screen: 1 });
      const rejected = assert.rejects(command, /VM command failed/);
      const deadline = Date.now() + 3000;
      while (!fs.existsSync(pidFile)) {
        assert.ok(Date.now() < deadline, "guest SSH process did not start");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      pid = Number(fs.readFileSync(pidFile, "utf8"));
      await env.client.call("environments.stop", {});
      await rejected;
      assert.throws(() => process.kill(pid ?? 0, 0), { code: "ESRCH" });
      assert.equal(state.running, false);
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

test("taking an agent's screen cancels the run holding it, persists an interruption and keeps it until handback", async () => {
  let started: () => void = () => {};
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const llm = scriptedLlm(async (request) => {
    started();
    await new Promise<void>((resolve) => request.signal?.addEventListener("abort", () => resolve(), { once: true }));
    return say("Stopped");
  });
  const env = await startCore({ llm, computer: { limaHome: "/unused", instance: "missing" } });
  try {
    const chat = await computerChat(env);
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat });
    await assert.rejects(
      env.client.call("environments.command", { thread: chat, command: "pwd", screen: 1 }),
      /Take control/,
    );
    await assert.rejects(
      env.client.call("environments.command", { thread: chat, command: "pwd" }),
      /name the agent screen/,
    );
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(agent.call("environments.control", { screen: 1, mode: "human" }), { code: "unauthorized" });
    await env.client.call("threads.send", { thread: chat, text: "Work in the VM" });
    await active;
    await env.client.call("environments.control", { screen: 1, mode: "human" });
    const result = await env.settle(chat);
    assert.equal(result.runs[0]?.state, "canceled");
    assert.ok(
      result.messages.some((m) => m.parts.some((p) => p.type === "notice" && p.code === "computer.interrupted")),
    );
    const screen = async () => (await env.client.call("environments.status", {})).screens?.find((s) => s.screen === 1);
    assert.equal((await screen())?.control, "human");
    const count = llm.calls.length;
    await env.client.call("threads.send", { thread: chat, text: "Try while owner controls" });
    await env.settle(chat);
    assert.equal(llm.calls.length, count);
    assert.equal(env.core.store.threads.get(chat)?.state, "failed");
    await env.client.call("environments.control", { screen: 1, mode: "agent" });
    assert.equal((await screen())?.control, "agent");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("task conversations cannot redirect a VM-bound request into an unbound worker chat", async () => {
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: "/unused", instance: "missing" },
  });
  try {
    await env.client.call("environments.permit", { agent: "roby", on: true });
    const task = await env.client.call("tasks.create", { title: "Acme work", assignee: "roby" });
    await assert.rejects(env.client.call("environments.bind", { thread: task.thread_id }), /owner.*native chat/);
    const status = await env.client.call("environments.status", { thread: task.thread_id });
    assert.equal(status.chat, undefined, "a chat the computer does not serve has no place on it");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("a chat on the computer is deleted only while none of its runs holds a screen, and leaves the computer's chats", async () => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const llm = scriptedLlm(async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return say("Done");
  });
  const env = await startCore({ llm, computer: { limaHome: "/unused", instance: "missing" } });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("environments.permit", { agent: "roby", on: true });
    await env.client.call("environments.bind", { thread: chat.id });
    await env.client.call("threads.send", { thread: chat.id, text: "Work" });
    await active;
    await assert.rejects(env.client.call("threads.delete", { thread: chat.id }), /stop/);
    release();
    await env.settle(chat.id);
    await env.client.call("threads.delete", { thread: chat.id });
    assert.deepEqual(env.core.store.settings.read("computer_chats"), []);
  } finally {
    release();
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

// portable: stands in for the Mac-only driver with a script binary (RUNS_SCRIPTS).
if (RUNS_SCRIPTS)
  test("revoking a device invalidates pending display tickets, closes its live display and refuses existing RPC sockets", async () => {
    const home = tempDir("apx-display-revoke-").path;
    const binary = path.join(home, "display.mjs");
    fs.writeFileSync(binary, `#!${process.execPath}\nsetInterval(() => {}, 10000);\n`, { mode: 0o755 });
    const token = "test-core-display-token";
    const core = await createCore(
      { ...testConfig({ home }), token },
      {
        quiet: true,
        llm: scriptedLlm(() => say("ok")),
        computer: {
          limaHome: path.join(home, "unused"),
          instance: "missing",
          executable: () => binary,
          lifecycle: fakeLifecycle(),
        },
        imessage: null,
      },
    );
    const owner = new ApxClient({ url: core.url, token });
    let display: WebSocket | undefined;
    let socket: Awaited<ReturnType<ApxClient["connect"]>> | undefined;
    try {
      await owner.call("environments.status", {});
      await core.computer.ledger.claim("roby", "home", "run_test");
      const { code } = await owner.call("devices.pair_start", {});
      const paired = await new ApxClient({ url: core.url }).call("devices.pair", { code, name: "Test display" });
      const client = new ApxClient({ url: core.url, token: paired.token });
      socket = await client.connect();
      const live = await client.call("environments.display", { screen: 1 });
      const pending = await socket.call("environments.display", { screen: 1 });
      display = new WebSocket(`${core.url.replace("http:", "ws:")}/vm-display?ticket=${live.ticket}`, {
        headers: { Origin: core.url },
      });
      await once(display, "open");
      const closed = once(display, "close");
      await owner.call("devices.revoke", { id: paired.device.id });
      await Promise.race([
        closed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("revoked display remained open")), 2000).unref(),
        ),
      ]);
      await assert.rejects(client.call("environments.display", { screen: 1 }), { code: "unauthorized" });
      await assert.rejects(socket.call("environments.display", { screen: 1 }));
      const rejected = new WebSocket(`${core.url.replace("http:", "ws:")}/vm-display?ticket=${pending.ticket}`, {
        headers: { Origin: core.url },
      });
      try {
        await assert.rejects(once(rejected, "open"), /403/);
      } finally {
        rejected.terminate();
      }
      assert.ok((await owner.call("environments.display", { screen: 1 })).ticket);
    } finally {
      display?.terminate();
      socket?.close();
      await core.close();
      await removeDir(home);
    }
  });

// portable: stands in for the Mac-only driver with a script binary (RUNS_SCRIPTS).
if (RUNS_SCRIPTS)
  test("a viewer that reconnects again and again never hits the cap: the same device's oldest one gives way", async () => {
    const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
    const dir = tempDir("apx-vm-viewer-").path;
    // A viewer that stays open until it is ended, as a desktop's does.
    const viewer = path.join(dir, "viewer.sh");
    fs.writeFileSync(viewer, "#!/bin/sh\nexec sleep 60\n", { mode: 0o755 });
    const vm = createComputer(env.core.store, {
      limaHome: path.join(env.home, "no-vms"),
      instance: "missing",
      executable: () => viewer,
    });
    const children: ChildProcess[] = [];
    try {
      await vm.ledger.claim("roby", "home", "run_test");
      for (let i = 0; i < DISPLAY_CAP * 3; i++) {
        const { ticket } = vm.display(1);
        children.push(vm.connectDisplay(ticket).open());
      }
      await waitFor(() => children.filter((c) => c.exitCode === null && c.signalCode === null).length <= DISPLAY_CAP);
      assert.equal(children.at(-1)?.exitCode, null, "the newest one is the one shown");
    } finally {
      await vm.close();
      for (const child of children) child.kill("SIGKILL");
      await env.core.close();
      env.cleanup();
      await removeDir(dir);
    }
  });
