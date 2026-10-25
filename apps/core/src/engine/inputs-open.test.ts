import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { removeDir } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const WIDGET = { name: "w-late", title: "Late", html: "<b>late</b>" };

const llm = scriptedLlm(async (_req, { said, afterTool }) => {
  if (afterTool) return say("Turn done.");
  if (said.includes("it will run without asking")) return callTool("g1", "show_widget", WIDGET);
  if (said.includes("make the late widget")) return callTool("c1", "show_widget", WIDGET);
  if (said.includes("ask me later")) return callTool("q1", "ask_owner", { question: "Which color?" });
  if (said.includes("ask me if you like"))
    return callTool("q2", "ask_owner", { question: "Any preference?", can_continue: true });
  return say("Hi.");
});

let env: Awaited<ReturnType<typeof startCore>>;
let careful = "";
let root = "";

before(async () => {
  // The turn stops waiting almost at once, so what happens after the wait is what these tests see.
  env = await startCore({ llm, inputWaits: { turn: 150, external: 150 } });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-inputs-open-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "Northwind" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "careful.md"),
    "---\nname: Careful\nrole: tester\nautonomy: ask\n---\n\nYou check things.\n",
  );
  await env.client.call("projects.register", { path: root });
  const { agents } = await env.client.call("agents.list", {});
  careful = agents.find((x) => x.name === "Careful")?.id ?? "";
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(root);
});

const newThread = (agent: string) => env.client.call("threads.create", { kind: "agent", agent_id: agent });

test("an unanswered question stays open after the turn ends, and the late answer wakes the agent", async () => {
  const t = await newThread("roby");
  await env.client.call("threads.send", { thread: t.id, text: "ask me later" });
  const first = await env.settle(t.id);
  assert.equal(first.runs.at(-1)?.state, "completed");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /The question stays open/);
  const [input] = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.equal(input?.kind, "question");
  // The chat shows it still waits for the owner, though no turn runs.
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "input-required");

  await env.client.call("runs.respond", { input: input?.id ?? "", text: "blue" });
  const { runs } = await env.settle(t.id);
  assert.equal(runs.length, 2);
  assert.equal(runs.at(-1)?.state, "completed");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /Which color\?.*Their answer: blue/s);
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "idle");
});

test("stopping a chat that only waits on an open question closes it, so it stops waiting", async () => {
  const t = await newThread("roby");
  await env.client.call("threads.send", { thread: t.id, text: "ask me later" });
  await env.settle(t.id);
  const [input] = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "input-required");

  await env.client.call("threads.cancel", { thread: t.id });
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
  assert.notEqual((await env.client.call("threads.get", { thread: t.id })).thread.state, "input-required");
  await assert.rejects(env.client.call("runs.respond", { input: input?.id ?? "", text: "blue" }));
});

test("a question the agent can go on without closes when the turn stops waiting", async () => {
  const t = await newThread("roby");
  await env.client.call("threads.send", { thread: t.id, text: "ask me if you like" });
  await env.settle(t.id);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /did not answer in time\. Continue without it/);
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
});

test("an unanswered confirmation stays open; approving it later runs the call once in a new turn", async () => {
  const t = await newThread(careful);
  await env.client.call("threads.send", { thread: t.id, text: "make the late widget" });
  await env.settle(t.id);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /not run yet: the owner has not answered/);
  assert.ok(!(await env.client.call("surfaces.list", {})).surfaces.some((s) => s.name === "w-late"));
  const [input] = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.equal(input?.kind, "confirm");

  await env.client.call("runs.respond", { input: input?.id ?? "", decision: "approve" });
  const { messages, runs } = await env.settle(t.id);
  assert.equal(runs.length, 2);
  assert.ok((await env.client.call("surfaces.list", {})).surfaces.some((s) => s.name === "w-late"));
  assert.ok(texts(messages).includes("Turn done."));
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
});
