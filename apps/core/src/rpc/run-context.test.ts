import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { RUN_CONTEXTS_KEPT } from "../domain/run-contexts.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const sum = (parts: Array<{ chars: number }>) => parts.reduce((n, p) => n + p.chars, 0);

test("the owner sees what the model received on a run: the same system prompt, input and tools, with parts that add up", async () => {
  await env.client.call("agents.update", { agent: "roby", prompt: "Answer in haiku when asked for poems." });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "hola" });
  const { runs } = await env.settle(t.id);
  const sent = llm.calls.at(-1);
  const got = await env.client.call("runs.context", { run: runs[0]?.id ?? "" });
  assert.equal(got.system, String(sent?.messages[0]?.content));
  assert.equal(got.input, String(sent?.messages.at(-1)?.content));
  assert.deepEqual(
    got.tools,
    (sent?.tools ?? []).map((x) => x.function.name),
  );
  assert.equal(sum(got.sizes.system), got.system.length);
  assert.equal(sum(got.sizes.input), got.input.length);
  assert.equal(got.sizes.tools, JSON.stringify(sent?.tools).length);
  assert.equal(got.sizes.system.find((p) => p.name === "instructions")?.chars, 37);
  assert.deepEqual(
    got.sizes.input.map((p) => p.name).filter((n) => n === "context" || n === "message"),
    ["context", "message"],
  );
  assert.equal(got.sizes.input.at(-1)?.chars, "hola".length);
});

test("only the latest runs keep what they received", async () => {
  const store = env.core.store;
  const ids = Array.from({ length: RUN_CONTEXTS_KEPT + 2 }, (_, i) => {
    const r = store.runs.create({
      thread_id: "home",
      agent_id: "roby",
      trigger: "user",
      input: { origin: { kind: "user" }, text: `n${i}` },
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });
    store.runContexts.add({
      run_id: r.id,
      system: "same system",
      input: `n${i}`,
      tools: [],
      sizes: { system: [{ name: "base", chars: 11 }], input: [], tools: 2, history: { items: 0, chars: 0 } },
    });
    return r.id;
  });
  assert.equal(store.runContexts.get(ids[0] ?? ""), undefined, "the oldest was dropped");
  assert.equal(store.runContexts.get(ids.at(-1) ?? "")?.system, "same system");
  await assert.rejects(env.client.call("runs.context", { run: ids[1] ?? "" }), /only the latest 50 runs keep it/);
});
