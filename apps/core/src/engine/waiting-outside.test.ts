// An agent whose engine only reads words between turns, such as Codex (DECISIONS.md#d-186, #d-189, #d-196): "Send now",
// and plain Enter, stop the turn at work, as the composer's stop does, and the owner's message runs at once, ahead of
// anything else in line.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import type { Harness } from "../harness/index.ts";
import { type TempDir, tempDir, waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** An outside engine: a turn asking for "work" goes on until it is stopped; any other answers with what it read. */
let started = 0;
const codex: Harness = {
  id: "codex",
  run: (io) =>
    new Promise((resolve, reject) => {
      const text = String(io.input.content);
      started++;
      if (!text.includes("work")) return resolve({ text: `Heard: ${text}`, model: "codex/model" });
      io.signal.addEventListener("abort", () => reject(io.signal.reason), { once: true });
    }),
};

let env: Awaited<ReturnType<typeof startCore>>;
let repo: TempDir;
let project = "";
before(async () => {
  // Our own loop's model call: "think" goes on until the turn is stopped, so only Enter's steer can reach it.
  const llm = scriptedLlm((req, { said }) =>
    said.includes("think")
      ? new Promise<never>((_, reject) => {
          req.signal?.addEventListener("abort", () => reject(req.signal?.reason), { once: true });
        })
      : say(`Plain: ${said}`),
  );
  env = await startCore({ llm, harnesses: { codex } });
  repo = tempDir("apx-outside-");
  project = (await env.client.call("projects.register", { path: repo.path, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await repo.remove();
});

const said = (m: Message) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ");

test("send now stops an outside engine's turn and runs the message at once, ahead of the rest of the line", async () => {
  const thread = (
    await env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project,
      engine: "codex",
    })
  ).id;
  const first = await env.client.call("threads.send", { thread, text: "work for long" });
  await waitFor(() => started === 1, "the turn at work");
  // Put in line (Ctrl/⌘+Enter): an outside engine cannot take it mid-turn, so it waits for the turn to end.
  const a = await env.client.call("threads.send", { thread, text: "alpha", mode: "queue" });
  const b = await env.client.call("threads.send", { thread, text: "bravo", mode: "queue" });
  assert.deepEqual(env.core.store.messages.get(b.message.id)?.waiting, { until: "turn", run: b.run.id });

  assert.deepEqual(await env.client.call("runs.send_now", { message: b.message.id }), { now: true });
  const { messages, runs } = await env.settle(thread);

  assert.equal(runs.find((r) => r.id === first.run.id)?.state, "canceled");
  assert.equal(runs.find((r) => r.id === b.run.id)?.state, "completed");
  assert.equal(runs.find((r) => r.id === a.run.id)?.state, "completed");
  const answers = messages.filter((m) => m.author.kind === "agent").map(said);
  assert.deepEqual(answers.slice(-2), ["Heard: bravo", "Heard: alpha"]);
  assert.ok(messages.every((m) => !m.waiting));
});

const outsideThread = async () =>
  (
    await env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project,
      engine: "codex",
    })
  ).id;

test("Enter while an outside engine works stops its turn and runs the message at once; Ctrl/⌘+Enter still waits", async () => {
  const thread = await outsideThread();
  const before = started;
  const first = await env.client.call("threads.send", { thread, text: "work for long" });
  await waitFor(() => started === before + 1, "the turn at work");
  // In line stays in line.
  const queued = await env.client.call("threads.send", { thread, text: "alpha", mode: "queue" });
  assert.deepEqual(env.core.store.messages.get(queued.message.id)?.waiting, { until: "turn", run: queued.run.id });
  assert.equal(env.core.store.runs.get(first.run.id)?.state, "working");

  const entered = await env.client.call("threads.send", { thread, text: "bravo", mode: "steer" });
  assert.notEqual(entered.steered, true);
  const { messages, runs } = await env.settle(thread);

  assert.equal(runs.find((r) => r.id === first.run.id)?.state, "canceled");
  assert.equal(runs.find((r) => r.id === entered.run.id)?.state, "completed");
  assert.equal(runs.find((r) => r.id === queued.run.id)?.state, "completed");
  const answers = messages.filter((m) => m.author.kind === "agent").map(said);
  assert.deepEqual(answers.slice(-2), ["Heard: bravo", "Heard: alpha"]);
  assert.ok(messages.every((m) => !m.waiting));
});

test("Enter with files while an outside engine works runs the message at once, as Send now does", async () => {
  const thread = await outsideThread();
  const before = started;
  const first = await env.client.call("threads.send", { thread, text: "work for long" });
  await waitFor(() => started === before + 1, "the turn at work");
  const { media } = await env.client.call("media.upload", {
    thread,
    name: "notes.md",
    mime: "text/markdown",
    data: Buffer.from("# Plan").toString("base64"),
  });
  const entered = await env.client.call("threads.send", {
    thread,
    text: "bravo",
    mode: "steer",
    attachments: [media.id],
  });
  const { runs } = await env.settle(thread);
  assert.equal(runs.find((r) => r.id === first.run.id)?.state, "canceled");
  assert.equal(runs.find((r) => r.id === entered.run.id)?.state, "completed");
});

test("Enter with no turn at work just runs, and a native agent's turn still takes it at its next step", async () => {
  const outside = await outsideThread();
  const before = started;
  await env.client.call("threads.send", { thread: outside, text: "hello", mode: "steer" });
  await env.settle(outside);
  assert.equal(started, before + 1);

  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "native" }))
    .id;
  const first = await env.client.call("threads.send", { thread, text: "think hard" });
  await waitFor(() => env.core.store.runs.get(first.run.id)?.state === "working", "the native turn");
  const entered = await env.client.call("threads.send", { thread, text: "use metric", mode: "steer" });
  assert.equal(entered.steered, true);
  assert.deepEqual(env.core.store.messages.get(entered.message.id)?.waiting, { until: "step" });
  assert.equal(env.core.store.runs.get(first.run.id)?.state, "working");
  await env.client.call("threads.cancel", { thread });
});
