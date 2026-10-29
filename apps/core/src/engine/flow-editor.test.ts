import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import type { FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "hook", kind: "webhook", label: "New lead" }],
  edges: [],
  layout: [{ node: "hook", x: 0, y: 0 }],
};
/** What the model read last as the owner's turn. */
const lastInput = () => String(llm.calls.at(-1)?.messages.findLast((m) => m.role === "user")?.content);

test("a chat bound to the Flow editor tells which Flow in the turn, and the owner's message keeps only their words", async () => {
  const project = (await env.client.call("projects.create", { name: "Acme" })).project.id;
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.flow_editor", { thread: thread.id, editor: { project } });
  await env.client.call("threads.send", { thread: thread.id, text: "make this flow" });
  await env.settle(thread.id);
  assert.match(lastInput(), /\[flow editor\] The owner is starting a new flow in the project "Acme" \(id p_/);

  const made = await env.client.call("flows.create", { project, name: "Lead intake", graph });
  await env.client.call("threads.flow_editor", { thread: thread.id, editor: { project, flow: made.flow.id } });
  await env.client.call("threads.send", { thread: thread.id, text: "add a step" });
  await env.settle(thread.id);
  assert.match(
    lastInput(),
    new RegExp(`\\[flow editor\\] The owner has the flow "Lead intake" \\(id ${made.flow.id}\\) .*draft at version 1`),
  );
  assert.ok(lastInput().trimEnd().endsWith("add a step"), "the owner's words close the turn");
  const { messages } = await env.client.call("threads.get", { thread: thread.id });
  const said = messages.filter((m) => m.author.kind === "user").map((m) => JSON.stringify(m.parts));
  assert.ok(
    said.every((p) => !p.includes("flow editor")),
    "the owner's bubbles show only what they wrote",
  );

  await env.client.call("threads.flow_editor", { thread: thread.id, editor: null });
  await env.client.call("threads.send", { thread: thread.id, text: "thanks" });
  await env.settle(thread.id);
  assert.doesNotMatch(lastInput(), /\[flow editor\]/);
});

test("only the owner binds a chat, to a Flow of the project it names", async () => {
  const acme = (await env.client.call("projects.create", { name: "Acme two" })).project.id;
  const northwind = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
  const theirs = await env.client.call("flows.create", { project: northwind, name: "Theirs", graph });
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: acme });
  await assert.rejects(
    env.client.call("threads.flow_editor", { thread: thread.id, editor: { project: acme, flow: theirs.flow.id } }),
    /not found/i,
  );
  const shell = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(shell.call("threads.flow_editor", { thread: thread.id, editor: { project: acme } }));
});
