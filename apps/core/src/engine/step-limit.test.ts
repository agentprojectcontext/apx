// A turn on our own loop that uses every step it has completes with a report, never as a finished one: the run says
// so, its chat says so, and an agent that delegated it reads it as progress, not as the result.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Part } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const looper = { name: "Looper", instructions: "Search until it is all found." };
const quick = { name: "Quick", instructions: "Answer at once." };

// A model that never stops working while it has tools: every call asks for one more search.
const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  const busy = () =>
    req.tools.length
      ? callTool(`c${req.messages.length}`, "memory_search", { query: `q${req.messages.length}` })
      : say("Out of steps: searched a part, the rest is left.");
  if (system.startsWith("You are Looper")) {
    if (said.includes("slowly") && !afterTool) await new Promise((r) => setTimeout(r, 200));
    return busy();
  }
  if (system.startsWith("You are Quick")) return say("All found.");
  if (said.includes("<delegation_result")) return say("The looper is back.");
  if (said.includes("search everything")) return busy();
  if (said.includes("ask the looper slowly") && !afterTool)
    return callTool("d2", "delegate", { worker: looper, task: "search slowly", wait_s: 0 });
  if (said.includes("ask the looper") && !afterTool)
    return callTool("d1", "delegate", { worker: looper, task: "search it all" });
  if (said.includes("ask quick") && !afterTool) return callTool("d3", "delegate", { worker: quick, task: "find it" });
  return say(afterTool ? "Done." : "Hello.");
});

let env: Awaited<ReturnType<typeof startCore>>;
const card = (parts: Part[] | undefined) =>
  parts?.find((p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread");
/** What the delegate tool returned to the caller, in its model calls. */
const toolResult = (callId: string) =>
  String(
    llm.calls.flatMap((c) => c.messages).find((m) => m.role === "tool" && m.tool_call_id === callId)?.content ?? "",
  );

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function send(text: string) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: text });
  await env.client.call("threads.send", { thread: t.id, text });
  return { id: t.id, ...(await env.settle(t.id, 15_000)) };
}

test("a turn that ran out of steps is stored as such, and its chat says it is not a final answer", async () => {
  const t = await send("search everything");
  const run = t.runs[0];
  assert.equal(run?.state, "completed");
  assert.equal(run?.end_reason, "step_limit");
  const parts = t.messages.at(-1)?.parts ?? [];
  assert.ok(
    parts.some((p) => p.type === "text" && /rest is left/.test(p.text)),
    "the model's account stays",
  );
  const notice = parts.find((p) => p.type === "notice" && p.code === "run.stepLimit");
  assert.equal(notice?.type === "notice" && notice.level, "warn");
  // The same run read by id says so too.
  const { runs } = await env.client.call("runs.list", { agent: "roby", limit: 50 });
  assert.equal(runs.find((r) => r.id === run?.id)?.end_reason, "step_limit");
});

test("a turn that answered is a normal end", async () => {
  const t = await send("hello there");
  assert.equal(t.runs[0]?.end_reason, "normal");
  assert.ok(!t.messages.at(-1)?.parts.some((p) => p.type === "notice" && p.code === "run.stepLimit"));
});

test("a caller waiting on a delegate that ran out of steps reads progress, not a result", async () => {
  const t = await send("ask the looper");
  const reply = toolResult("d1");
  assert.match(reply, /state="out_of_steps"/);
  assert.match(reply, /ran out of steps before finishing: this is a progress report, not its final result/);
  const c = card(t.messages.at(-1)?.parts);
  assert.equal(c?.state, "completed");
  assert.equal(c?.end_reason, "step_limit");
});

test("a delegate's late result carries its end reason, and the caller's framing says it is not the result", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "late" });
  await env.client.call("threads.send", { thread: t.id, text: "ask the looper slowly" });
  const until = Date.now() + 15_000;
  let got = await env.client.call("threads.get", { thread: t.id });
  while (Date.now() < until && !texts(got.messages).some((x) => x.includes("looper is back"))) {
    await new Promise((r) => setTimeout(r, 40));
    got = await env.client.call("threads.get", { thread: t.id });
  }
  const woke = env.core.store.runs.list(t.id).find((r) => r.input?.origin.kind === "delegation_result");
  const origin = woke?.input?.origin;
  assert.equal(origin?.kind === "delegation_result" && origin.end_reason, "step_limit");
  const framed = llm.calls
    .flatMap((c) => c.messages)
    .find((m) => m.role === "user" && String(m.content).includes("<delegation_result"));
  assert.match(String(framed?.content), /state="out_of_steps"/);
  assert.match(String(framed?.content), /progress report, not its final result/);
});

test("a delegate that finished reads as completed, with no step-limit note", async () => {
  await send("ask quick");
  const reply = toolResult("d3");
  assert.match(reply, /state="completed"/);
  assert.doesNotMatch(reply, /ran out of steps/);
});
