import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { CoreEvent, Message, Run } from "@apx/protocol";
import { chat, latestConversation } from "./chat.ts";
import { printed, recordingClient } from "./testing.ts";

// Mock owner clients must not inherit the test runner's agent identity; the guard case sets its own.
const inheritedAgent = process.env.APX_AGENT;
beforeEach(() => {
  delete process.env.APX_AGENT;
});
afterEach(() => {
  if (inheritedAgent === undefined) delete process.env.APX_AGENT;
  else process.env.APX_AGENT = inheritedAgent;
});

function fixture(answers: Record<string, unknown>) {
  const recorded = recordingClient(answers);
  const closed = Promise.withResolvers<void>();
  let closes = 0;
  let listener: ((event: { payload: unknown }) => void) | undefined;
  const socket = {
    call: recorded.client.call.bind(recorded.client),
    closed: closed.promise,
    onEvent(fn: typeof listener) {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    close() {
      closes++;
      closed.resolve();
    },
  };
  Object.assign(recorded.client, { connect: async () => socket });
  return {
    ...recorded,
    emit: (payload: unknown) => listener?.({ payload: CoreEvent.parse(payload) }),
    disconnect: closed.resolve,
    get closes() {
      return closes;
    },
  };
}

test("--agent writes in the agent's latest conversation, never in a routine run, a task or a code session", () => {
  const threads = [
    { id: "run", kind: "routine", agent_ids: ["scout"] },
    { id: "task", kind: "task", agent_ids: ["scout"] },
    { id: "code", kind: "code", agent_ids: ["scout"] },
    { id: "talk", kind: "agent", agent_ids: ["scout"] },
    { id: "other", kind: "agent", agent_ids: ["vera"] },
  ];
  assert.equal(latestConversation(threads, "scout"), "talk");
  assert.equal(latestConversation(threads.slice(0, 3), "scout"), undefined);
});

test("chat sends Home and explicit chats with queue, steer or interrupt intent and closes detached sockets", async () => {
  for (const [options, thread, mode] of [
    [{}, "home", "queue"],
    [{ thread: "explicit", steer: true }, "explicit", "steer"],
    [{ thread: "explicit", interrupt: true, steer: true }, "explicit", "interrupt"],
  ] as const) {
    const f = fixture({ "threads.send": { run: { id: "run-1" } } });
    assert.equal(
      await printed(() => chat(f.client, "Hello", { ...options, detach: true })),
      `sent · run run-1 · thread ${thread}`,
    );
    assert.deepEqual(f.calls, [["threads.send", { thread, text: "Hello", mode }]]);
    assert.equal(f.closes, 1);
  }
});

test("chat selects the named agent's newest owner conversation and creates a fresh chat when requested", async () => {
  for (const fresh of [false, true]) {
    const f = fixture({
      "agents.list": { agents: [{ id: "vera", name: "Vera", kind: "agent" }] },
      "threads.list": {
        threads: [
          { id: "routine", kind: "routine", agent_ids: ["vera"] },
          { id: "previous", kind: "loose", agent_ids: ["vera"] },
        ],
      },
      "threads.create": { id: "new-chat" },
      "threads.send": { run: { id: "run-1" }, steered: true },
    });
    const expected = fresh ? "new-chat" : "previous";
    assert.equal(
      await printed(() => chat(f.client, "Follow-up", { agent: "VERA", new: fresh })),
      `steered into the running turn run-1 · thread ${expected}`,
    );
    assert.deepEqual(
      f.calls.map(([method]) => method),
      ["agents.list", fresh ? "threads.create" : "threads.list", "threads.send"],
    );
    assert.equal(f.closes, 1);
  }
});

test("chat rejects empty text and unknown agents before opening a socket", async () => {
  const f = fixture({ "agents.list": { agents: [] } });
  await assert.rejects(chat(f.client, "", {}), /usage: apx chat/);
  await assert.rejects(chat(f.client, "Hello", { agent: "missing" }), /unknown agent missing/);
  assert.equal(f.closes, 0);
  assert.deepEqual(f.calls, [["agents.list", {}]]);
});

test("chat closes the socket when a send fails", async () => {
  const f = fixture({ "threads.send": new Error("Send refused") });
  await assert.rejects(chat(f.client, "Hello", {}), /Send refused/);
  assert.equal(f.closes, 1);
});

test("chat rejects a disconnected live turn rather than waiting forever", { timeout: 1000 }, async () => {
  const f = fixture({ "threads.send": { run: { id: "run-1" } } });
  const pending = chat(f.client, "Hello", {});
  const rejected = assert.rejects(pending, /socket closed before the run ended/);
  await setImmediate();
  f.disconnect();
  await rejected;
  assert.equal(f.closes, 1);
});

test("chat streams useful parts once, ignores other runs and prints the completed answer", {
  timeout: 3000,
}, async () => {
  const at = "2026-01-01T00:00:00Z";
  const message = Message.parse({
    id: "message-1",
    seq: 1,
    thread_id: "home",
    run_id: "run-1",
    author: { kind: "agent", id: "roby" },
    created_at: at,
    model: "fake/fast",
    parts: [
      { type: "tool", call_id: "call-1", tool: "read_file", title: "Read guide", status: "ok" },
      { type: "notice", level: "info", code: "test", text: "Progress", detail: "First\nSecond" },
      { type: "surface", surface_id: "surface-1", version: 2, title: "Report" },
      {
        type: "subthread",
        thread_id: "child",
        agent_id: "vera",
        title: "Research",
        state: "completed",
        summary: "Sources found",
      },
      { type: "browser", tab: "tab-1", url: "https://example.com", title: "Example", state: "done" },
      { type: "changes", cwd: "/work", files: [{ path: "guide.md", status: "M", added: 2, removed: 1 }], more: 3 },
      { type: "text", text: "Final answer" },
    ],
  });
  const f = fixture({ "threads.send": { run: { id: "run-1" } }, "threads.get": { messages: [message] } });
  const output = printed(() => chat(f.client, "Hello", {}));
  await setImmediate();
  f.emit({ type: "message.created", message: { ...message, run_id: "unrelated" } });
  f.emit({ type: "message.created", message });
  f.emit({ type: "message.updated", message });
  f.emit({
    type: "run.updated",
    run: Run.parse({
      id: "run-1",
      thread_id: "home",
      agent_id: "roby",
      state: "completed",
      end_reason: "step_limit",
      started_at: at,
      ended_at: at,
    }),
  });
  const text = await output;
  assert.equal(text.match(/✓ Read guide/g)?.length, 1);
  assert.match(text, /! Progress\n {4}First\n {4}Second/);
  assert.match(text, /widget: Report \(v2\)/);
  assert.match(text, /completed · Research — Sources found/);
  assert.match(text, /browser done: https:\/\/example.com/);
  assert.match(text, /± 1\+3 uncommitted in \/work: M guide.md \+2\/-1/);
  assert.match(text, /Final answer\n— completed \(out of steps\) · fake\/fast · thread home$/);
  assert.deepEqual(
    f.calls.map(([method]) => method),
    ["threads.send", "threads.get"],
  );
  assert.equal(f.closes, 1);
});

test("code chat selects the closest registered project and preserves working directory and write policy", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-code-chat-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = path.join(dir, "app");
  const cwd = path.join(project, "src");
  fs.mkdirSync(cwd, { recursive: true });
  const f = fixture({
    "projects.list": {
      projects: [
        { id: "parent", path: dir },
        { id: "project", path: project },
      ],
    },
    "agents.list": { agents: [{ id: "roby", kind: "secretary", name: "Roby" }] },
    "threads.create": { id: "code-chat", cwd: "src", write: "read-only" },
    "threads.send": { run: { id: "run-1" } },
  });
  const text = await printed(() => chat(f.client, "Inspect", { code: true, cwd, write: "read-only", detach: true }));
  assert.match(text, /code thread code-chat · src · write: read-only/);
  assert.deepEqual(f.calls[2], [
    "threads.create",
    { kind: "code", agent_id: "roby", project_id: "project", cwd: "src", write: "read-only" },
  ]);
  assert.deepEqual(f.calls[3], ["threads.send", { thread: "code-chat", text: "Inspect", mode: "queue" }]);
  assert.equal(f.closes, 1);
});

test("inside an agent's command, chat refuses to speak as the owner and points to delegate", async () => {
  const { client, calls } = fixture({});
  process.env.APX_AGENT = "builder";
  try {
    await assert.rejects(chat(client, "please review", { agent: "noor" }), /use your delegate tool/);
  } finally {
    delete process.env.APX_AGENT;
  }
  assert.deepEqual(calls, [], "nothing was sent");
});
