import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { eventQuiet } from "./events.ts";

const declaration = {
  id: "northwind",
  name: "Northwind",
  version: "1.0.0",
  events: [{ name: "completed", description: "A cycle completed" }],
};

async function fixture(extra: Record<string, unknown> = {}) {
  const source = tempDir();
  fs.writeFileSync(path.join(source.path, "apx-extension.json"), JSON.stringify({ ...declaration, ...extra }));
  let at = new Date("2030-01-02T12:00:00Z");
  const llm = scriptedLlm(() => say("Observed completion"));
  const env = await startCore({ llm, clock: () => at, token: "test-extension-events" });
  const tick = () => {
    at = new Date(at.getTime() + 16000);
    env.core.scheduler.tick();
  };
  await env.client.call("extensions.install", { path: source.path });
  await env.client.call("extensions.enable", { id: "northwind", enabled: true });
  const configure = (enabled = true, more: Record<string, unknown> = {}) =>
    env.client.call("extensions.events_set", {
      id: "northwind",
      config: { enabled, thread: "home", ...more },
    });
  const emit = (id = "cycle-one", event = "completed") =>
    env.client.call("extensions.events_emit", {
      extension: "northwind",
      input: { id, event, data: { program: "Rinse", finished: true } },
    });
  return {
    ...env,
    source,
    llm,
    tick,
    advance(ms: number) {
      at = new Date(at.getTime() + ms);
    },
    configure,
    emit,
    async close() {
      await env.core.close();
      await env.cleanup();
      await source.remove();
    },
  };
}

test("events require opt-in; real protocol deduplication admits once as untrusted outside data", async () => {
  const env = await fixture();
  try {
    await assert.rejects(env.emit(), /off|approval/);
    await env.configure();
    await assert.rejects(env.emit("unknown", "other"), /Unknown/);
    const [first, duplicate] = await Promise.all([env.emit(), env.emit()]);
    assert.equal(first.receipt, duplicate.receipt);
    assert.notEqual(first.duplicate, duplicate.duplicate);
    env.tick();
    await waitFor(() => env.core.store.extensionEvents.get(first.receipt)?.state === "admitted", "event admission");
    await env.settle("home");
    assert.equal(env.core.store.runs.list("home").length, 1);
    const run = env.core.store.runs.list("home")[0];
    assert.equal(run?.input?.origin.kind, "agent");
    if (run?.input?.origin.kind === "agent") assert.equal(run.input.origin.id, "client:extension:northwind");
    assert.match(JSON.stringify(env.llm.calls), /untrusted|outside|external/i);
    await env.emit();
    env.tick();
    assert.equal(env.core.store.runs.list("home").length, 1);
    await env.configure(false);
    await assert.rejects(env.emit("new"), /off|approval/);
  } finally {
    await env.close();
  }
});

test("quiet hours retain receipts; disabling cancels pending and re-enabling never replays a canceled id", async () => {
  const env = await fixture();
  try {
    await env.configure(true, { quiet_start: 660, quiet_end: 840, time_zone: "UTC" });
    const first = await env.emit();
    env.tick();
    assert.equal(env.core.store.extensionEvents.get(first.receipt)?.state, "pending");
    assert.equal(env.core.store.runs.list("home").length, 0);
    await env.configure(false);
    assert.equal(env.core.store.extensionEvents.get(first.receipt)?.state, "canceled");
    await env.configure();
    assert.equal((await env.emit()).duplicate, true);
    env.tick();
    assert.equal(env.core.store.runs.list("home").length, 0);
    await assert.rejects(env.configure(true, { time_zone: "Not/AZone" }), /time zone/);
    await assert.rejects(env.configure(true, { thread: "missing" }), /personal chat/);
  } finally {
    await env.close();
  }
});

test("update invalidates opt-in; undeclared monitors and duplicate event declarations cannot install", async () => {
  const env = await fixture();
  try {
    await env.configure();
    const event = await env.emit();
    fs.writeFileSync(
      path.join(env.source.path, "apx-extension.json"),
      JSON.stringify({ ...declaration, version: "1.1.0" }),
    );
    await env.client.call("extensions.install", { path: env.source.path });
    await env.client.call("extensions.enable", { id: "northwind", enabled: true });
    await assert.rejects(env.emit("later"), /off|approval/);
    env.tick();
    assert.equal(env.core.store.extensionEvents.get(event.receipt)?.state, "canceled");
    fs.writeFileSync(
      path.join(env.source.path, "apx-extension.json"),
      JSON.stringify({ ...declaration, events: [declaration.events[0], declaration.events[0]] }),
    );
    await assert.rejects(env.client.call("extensions.inspect", { path: env.source.path }), /unique/);
    fs.writeFileSync(
      path.join(env.source.path, "apx-extension.json"),
      JSON.stringify({ ...declaration, monitor: { server: "status", tool: "poll", every_seconds: 30 } }),
    );
    await assert.rejects(env.client.call("extensions.inspect", { path: env.source.path }), /own MCP server/);
  } finally {
    await env.close();
  }
});

test("agent clients cannot configure or invent events, and authentication is still required", async () => {
  const env = await fixture();
  try {
    const ctx = {
      transport: "internal" as const,
      role: "operator" as const,
      actor: "agent" as const,
      session: undefined,
      log: { info() {}, warn() {}, error() {} },
    };
    const result = await env.core.dispatch(
      "extensions.events_emit",
      { extension: "northwind", input: { id: "one", event: "completed", data: {} } },
      ctx,
      "agent-attempt",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /reserved/);
    const stranger = new ApxClient({ url: env.core.url, token: "wrong" });
    await assert.rejects(stranger.call("extensions.events_get", { id: "northwind" }));
  } finally {
    await env.close();
  }
});

test("a real MCP monitor polls every five minutes without model turns and deduplicates completion", async () => {
  await using logs = tempDir();
  const log = path.join(logs.path, "polls.log");
  const server = path.join(import.meta.dirname, "event-monitor.test-support.mjs");
  const env = await fixture({
    mcp: {
      state: {
        command: process.execPath,
        args: [server],
        env: { POLL_LOG: log, ACK_LOG: path.join(logs.path, "acks.log") },
      },
    },
    monitor: { server: "state", tool: "poll", every_seconds: 300 },
  });
  try {
    env.tick();
    assert.equal(fs.existsSync(log), false);
    assert.equal(env.llm.calls.length, 0);
    await env.configure();
    await assert.rejects(
      env.client.call("mcp.call", {
        scope: "global",
        server: "northwind-state",
        tool: "poll",
        arguments: { session: "ec_0123456789abcdef" },
      }),
      /reserved/,
    );
    assert.deepEqual((await env.client.call("mcp.tools", { scope: "global", server: "northwind-state" })).tools, []);
    assert.equal(fs.existsSync(log), false);
    env.tick();
    await waitFor(() => env.core.store.extensionEvents.count("northwind") === 1, "monitor receipt");
    env.tick();
    await env.settle("home");
    assert.equal(fs.readFileSync(log, "utf8"), "poll\n");
    assert.equal(env.core.store.runs.list("home").length, 1);
    env.advance(300000);
    env.tick();
    await waitFor(() => fs.readFileSync(log, "utf8").split("\n").length === 3, "second monitor poll");
    assert.deepEqual(
      fs
        .readFileSync(path.join(logs.path, "acks.log"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      [[], [{ event: "completed", id: "cycle-one" }]],
    );
    await env.configure(false);
    assert.equal(env.core.store.extensionEvents.count("northwind"), 1);
    assert.equal(env.core.store.runs.list("home").length, 1);
    env.advance(300000);
    env.tick();
    assert.equal(fs.readFileSync(log, "utf8"), "poll\npoll\n");
  } finally {
    await env.close();
  }
});

test("a monitor cannot automatically call a tool lacking read-only metadata", async () => {
  await using logs = tempDir();
  const log = path.join(logs.path, "polls.log");
  const server = path.join(import.meta.dirname, "event-monitor.test-support.mjs");
  const env = await fixture({
    mcp: { state: { command: process.execPath, args: [server], env: { POLL_LOG: log, READ_ONLY: "false" } } },
    monitor: { server: "state", tool: "poll", every_seconds: 300 },
  });
  try {
    await env.configure();
    env.tick();
    await waitFor(() => env.core.store.extensionEvents.config("northwind")?.error, "unsafe monitor refused");
    assert.equal(fs.existsSync(log), false);
    assert.equal(env.core.store.extensionEvents.count("northwind"), 0);
    assert.equal(env.core.store.runs.list("home").length, 0);
  } finally {
    await env.close();
  }
});

test("pending delivery survives a real core restart and does not create a second run on replay", async () => {
  const env = await fixture();
  let reopened: Awaited<ReturnType<typeof startCore>> | undefined;
  let firstClosed = false;
  try {
    await env.configure(true, { quiet_start: 660, quiet_end: 840 });
    const receipt = await env.emit();
    env.tick();
    assert.equal(env.core.store.extensionEvents.get(receipt.receipt)?.state, "pending");
    await env.core.close();
    firstClosed = true;
    reopened = await startCore({
      home: env.home,
      llm: scriptedLlm(() => say("Recovered observation")),
      clock: () => new Date("2030-01-02T15:00:00Z"),
      token: "test-extension-events",
    });
    await waitFor(
      () => reopened?.core.store.extensionEvents.get(receipt.receipt)?.state === "admitted",
      "restart admission",
    );
    await reopened.settle("home");
    assert.equal(reopened.core.store.runs.list("home").length, 1);
    const replay = await reopened.client.call("extensions.events_emit", {
      extension: "northwind",
      input: { id: "cycle-one", event: "completed", data: {} },
    });
    assert.equal(replay.receipt, receipt.receipt);
    assert.equal(replay.duplicate, true);
    assert.equal(reopened.core.store.runs.list("home").length, 1);
  } finally {
    if (reopened) await reopened.core.close();
    else if (!firstClosed) await env.core.close();
    await env.cleanup();
    await env.source.remove();
  }
});

test("event limits bound payloads and bursts; toggling the extension itself revokes opt-in atomically", async () => {
  const env = await fixture();
  try {
    await env.configure(true, { quiet_start: 660, quiet_end: 840 });
    for (let i = 0; i < 60; i++) await env.emit(`cycle-${i}`);
    await assert.rejects(env.emit("over-limit"), /rate limit/);
    assert.equal((await env.emit("cycle-0")).duplicate, true);
    const bad = await env.core.dispatch(
      "extensions.events_emit",
      { extension: "northwind", input: { id: "large", event: "completed", data: { text: "x".repeat(1001) } } },
      {
        transport: "internal",
        role: "operator",
        actor: "human",
        session: undefined,
        log: { info() {}, warn() {}, error() {} },
      },
      "large-input",
    );
    assert.equal(bad.ok, false);
    await env.client.call("extensions.enable", { id: "northwind", enabled: false });
    await env.client.call("extensions.enable", { id: "northwind", enabled: true });
    assert.equal(env.core.store.extensionEvents.pendingCount("northwind"), 0);
    await assert.rejects(env.emit("after-toggle"), /off|approval/);
    assert.equal(env.core.store.runs.list("home").length, 0);
  } finally {
    await env.close();
  }
});

test("contradictory destructive metadata never authorizes a monitor, even with local bookkeeping", async () => {
  for (const local_state of [false, true]) {
    await using logs = tempDir();
    const log = path.join(logs.path, "polls.log");
    const server = path.join(import.meta.dirname, "event-monitor.test-support.mjs");
    const env = await fixture({
      mcp: { state: { command: process.execPath, args: [server], env: { POLL_LOG: log, DESTRUCTIVE: "true" } } },
      monitor: { server: "state", tool: "poll", every_seconds: 300, local_state },
    });
    try {
      await env.configure();
      env.tick();
      await waitFor(() => env.core.store.extensionEvents.config("northwind")?.error, "destructive observer refused");
      assert.equal(fs.existsSync(log), false);
      assert.equal(env.core.store.extensionEvents.count("northwind"), 0);
    } finally {
      await env.close();
    }
  }
});

test("bounded terminal history recovers capacity after its deduplication window without evicting pending receipts", async () => {
  const env = await fixture();
  try {
    await env.configure();
    const repo = env.core.store.extensionEvents;
    const config = repo.config("northwind");
    assert.ok(config);
    env.core.store.tx(() => {
      for (let i = 0; i < 10000; i++)
        repo.add(
          "northwind",
          config.generation,
          config.revision,
          "home",
          { event: "completed", id: `old-${i}`, data: {} },
          "2030-01-02T12:00:00.000Z",
        );
    });
    repo.cancel("northwind");
    assert.equal((await env.emit("old-0")).duplicate, true);
    await assert.rejects(env.emit("next"), /storage is full/);
    env.advance(86400001);
    const current = await env.emit("next");
    assert.equal(current.duplicate, false);
    assert.equal(repo.count("northwind"), 1);
    repo.compact("2030-01-05T00:00:00.000Z");
    assert.equal(repo.get(current.receipt)?.state, "pending");
    assert.equal((await env.emit("next")).duplicate, true);
  } finally {
    await env.close();
  }
});

test("changing extension options or credentials revokes notices and cancels pending delivery", async () => {
  const env = await fixture({
    manifest: 2,
    secrets: [{ name: "account_key", label: "Account key" }],
    settings: [{ name: "account", label: "Account", type: "string", default: "first" }],
  });
  try {
    await env.configure();
    const first = await env.emit();
    await env.client.call("extensions.settings", { id: "northwind", values: { account: "second" } });
    assert.equal(env.core.store.extensionEvents.get(first.receipt)?.state, "canceled");
    await assert.rejects(env.emit("after-options"), /off|approval/);
    await env.configure();
    const second = await env.emit("before-credentials");
    await env.client.call("extensions.set_secret", { id: "northwind", name: "account_key", value: "test-value" });
    assert.equal(env.core.store.extensionEvents.get(second.receipt)?.state, "canceled");
    await assert.rejects(env.emit("after-credentials"), /off|approval/);
    assert.equal(env.core.store.runs.list("home").length, 0);
  } finally {
    await env.close();
  }
});

test("quiet windows respect overnight endpoints and the configured time zone", () => {
  const config = { enabled: true, thread: "home", quiet_start: 1320, quiet_end: 480, time_zone: "America/New_York" };
  assert.equal(eventQuiet(config, new Date("2030-01-02T04:00:00Z")), true);
  assert.equal(eventQuiet(config, new Date("2030-01-02T13:00:00Z")), false);
  assert.equal(eventQuiet({ ...config, quiet_start: 0, quiet_end: 0 }, new Date("2030-01-02T04:00:00Z")), false);
});
