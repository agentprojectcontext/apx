import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  const steer = req.messages.find((m) => m.role === "user" && String(m.content).startsWith("[The owner adds"));
  if (steer) return say(`Steered: ${String(steer.content).split("\n")[1]}`);
  if (said.includes("work a bit") && !afterTool) return callTool("w1", "shell", { command: "sleep 0.4" });
  return say(afterTool ? "Finished without steering." : `Plain: ${said}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("steer puts the owner's text into the running turn at its next step", async () => {
  const t = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "steer" })).id;
  const first = await env.client.call("threads.send", { thread: t, text: "work a bit" });
  for (let i = 0; i < 100; i++) {
    const r = await env.client.call("runs.get", { run: first.run.id });
    if (r.state === "working" && r.harness === "native") break;
    await new Promise((res) => setTimeout(res, 10));
  }
  const s = await env.client.call("threads.send", { thread: t, text: "use metric units", mode: "steer" });
  assert.equal(s.steered, true);
  assert.equal(s.run.id, first.run.id);
  const { messages, runs } = await env.settle(t);
  assert.equal(runs.length, 1);
  assert.ok(texts(messages).includes("Steered: use metric units"));
  // The chat reads in the order things happened: what the agent says after taking the words sits below them.
  const said = (m: (typeof messages)[number]) =>
    m.parts.flatMap((p) => (p.type === "text" ? [p.text] : p.type === "tool" ? [`[${p.tool}]`] : [])).join(" ");
  assert.deepEqual(
    messages.map((m) => `${m.author.kind}: ${said(m)}`),
    ["user: work a bit", "agent: [shell]", "user: use metric units", "agent: Steered: use metric units"],
  );
  // The step keeps how long it took, for the folded "1 step · 0 s".
  const step = messages.flatMap((m) => m.parts).find((p) => p.type === "tool");
  assert.ok(step?.type === "tool" && typeof step.ms === "number" && step.ms >= 300);
  // Both parts belong to the one run, which points at the answer it ended with.
  const answers = messages.filter((m) => m.author.kind === "agent");
  assert.ok(answers.every((m) => m.run_id === first.run.id));
  assert.equal(env.core.store.runs.get(first.run.id)?.message_id, answers.at(-1)?.id);
});

test("with nothing running, steer simply queues a normal turn", async () => {
  const t = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "idle" })).id;
  const s = await env.client.call("threads.send", { thread: t, text: "hello", mode: "steer" });
  assert.equal(s.steered, undefined);
  const { messages } = await env.settle(t);
  assert.ok(texts(messages).includes("Plain: hello"));
});

test("usage by model: turns and tokens, and our own loop's turns counted as paid per token", async () => {
  const { models } = await env.client.call("usage.summary", {});
  const fake = models.find((m) => m.model === "fake/fake-1");
  assert.ok(fake && fake.runs >= 2);
  assert.equal(fake.billing, "metered");
});
