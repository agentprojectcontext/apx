import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const worker = { name: "Researcher", instructions: "Dig through sources; list each with its link." };

const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  if (system.startsWith("You are Researcher")) {
    if (said.includes("slowly")) await new Promise((r) => setTimeout(r, 300));
    return say("## Report\n- Found 2 sources.\n- One is stale.");
  }
  if (said.includes("<delegation_result")) return say("The researcher is back: 2 sources.");
  if (said.includes("use a worker") && !afterTool)
    return callTool("w1", "delegate", { worker: { ...worker, tools: ["recall"] }, task: "look into A2A" });
  if (said.includes("worker slowly") && !afterTool)
    return callTool("w2", "delegate", { worker, task: "look slowly", wait_s: 0 });
  if (said.includes("continue it") && !afterTool)
    return callTool("w3", "delegate", { session: "researcher", task: "and one more" });
  if (said.includes("delegate to me") && !afterTool) return callTool("w4", "delegate", { agent: "roby", task: "x" });
  if (said.includes("ambiguous delegation") && !afterTool)
    return callTool("w5", "delegate", { agent: "roby", worker, task: "x" });
  return say(afterTool ? `Done: ${String(req.messages.at(-1)?.content).slice(0, 60)}` : "ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
const card = (parts: Part[] | undefined) =>
  parts?.find((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("a worker runs as the caller under the instructions it wrote, with only the tools it named and no delegate", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w" });
  await env.client.call("threads.send", { thread: t.id, text: "use a worker" });
  const { messages } = await env.settle(t.id);
  const c = card(messages.at(-1)?.parts);
  assert.ok(c);
  assert.equal(c.worker, "Researcher");
  assert.equal(c.agent_id, "roby");
  assert.equal(c.state, "completed");
  assert.match(c.summary ?? "", /## Report[\s\S]*One is stale/, "the whole report, not a clipped line");
  assert.equal(typeof c.ms, "number");

  const call = llm.calls.find((x) => String(x.messages[0]?.content).startsWith("You are Researcher"));
  assert.ok(call);
  const system = String(call.messages[0]?.content);
  assert.match(system, /a worker Roby started/);
  assert.match(system, /Dig through sources/);
  assert.doesNotMatch(system, /Your personality|## Your owner/);
  assert.deepEqual(
    (call.tools ?? []).map((x) => x.function.name),
    ["recall"],
  );
  // Roby read the report as another agent's data.
  assert.ok(
    llm.calls.some((x) =>
      x.messages.some((m) => m.role === "tool" && String(m.content).includes('<agent_reply from="Researcher"')),
    ),
  );
});

test("a worker's session goes on with the same instructions", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w2" });
  await env.client.call("threads.send", { thread: t.id, text: "use a worker" });
  await env.settle(t.id);
  const from = llm.calls.length;
  await env.client.call("threads.send", { thread: t.id, text: "continue it" });
  const { messages } = await env.settle(t.id);
  assert.equal(card(messages.at(-1)?.parts)?.worker, "Researcher");
  assert.ok(
    llm.calls.slice(from).some((x) => /Dig through sources/.test(String(x.messages[0]?.content))),
    "the continued turn kept the worker's prompt",
  );
});

test("a late worker result shows its report above the caller's new answer", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w3" });
  await env.client.call("threads.send", { thread: t.id, text: "worker slowly" });
  const until = Date.now() + 5000;
  let got = await env.client.call("threads.get", { thread: t.id });
  while (Date.now() < until && !texts(got.messages).some((x) => x.includes("researcher is back"))) {
    await new Promise((r) => setTimeout(r, 40));
    got = await env.client.call("threads.get", { thread: t.id });
  }
  const woken = got.messages.at(-1);
  assert.ok(texts(woken ? [woken] : []).some((x) => x.includes("researcher is back")));
  const report = card(woken?.parts);
  assert.ok(report, "the woken answer carries the report card");
  assert.equal(woken?.parts[0]?.type, "subthread", "the report comes first");
  assert.match(report.summary ?? "", /2 sources/);
  assert.equal(report.state, "completed");
});

test("an agent still cannot delegate to itself", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "w4" });
  await env.client.call("threads.send", { thread: t.id, text: "delegate to me" });
  const { messages } = await env.settle(t.id);
  assert.match(texts(messages).at(-1) ?? "", /cannot delegate to yourself/);
});

test("an ambiguous delegation is an invalid call, not a successful tool card", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "ambiguous delegation" });
  const { messages } = await env.settle(t.id);
  const tool = messages.at(-1)?.parts.find((p) => p.type === "tool");
  assert.equal(tool?.type === "tool" && tool.status, "error");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /give agent or worker, not both/);
  assert.equal(env.core.store.threads.sessions(t.id).length, 0);
});
