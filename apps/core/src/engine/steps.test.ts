// How many model calls a run gets on our own loop: a chat turn the owner watches stops early, a routine no one
// watches gets more, and a routine's own limit wins over both.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MAX_STEPS } from "../harness/native.ts";
import { callTool, scriptedLlm, startCore } from "./testkit.ts";

// A model that never stops working: every call with tools asks for one more search.
const llm = scriptedLlm((req) =>
  req.tools.length
    ? callTool(`c${req.messages.length}`, "memory_search", { query: `q${req.messages.length}` })
    : { message: { role: "assistant", content: "Out of steps: here is what is left." } },
);
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** Model calls made with tools on, in one thread. */
const steps = (thread: string) => llm.calls.filter((c) => c.cacheKey === thread && c.tools.length).length;

async function runRoutine(id: string) {
  const started = await env.client.call("routines.run", { routine: id });
  await env.settle(started.thread_id, 15_000);
  return steps(started.thread_id);
}

test("a chat turn the owner watches gets the same steps as background work", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "search everything" });
  await env.settle(t.id);
  assert.equal(steps(t.id), MAX_STEPS);
});

test("a routine gets the default steps, its own limit wins, and null puts the default back", async () => {
  const base = {
    name: "Long review",
    agent: "roby",
    schedule: { kind: "manual" as const },
    prompt: "Review every open issue.",
  };
  const r = await env.client.call("routines.set", base);
  assert.equal(r.max_steps, undefined);
  assert.equal(await runRoutine(r.id), MAX_STEPS);

  const own = await env.client.call("routines.set", { ...base, id: r.id, max_steps: 20 });
  assert.equal(own.max_steps, 20);
  assert.equal(await runRoutine(r.id), 20);

  const kept = await env.client.call("routines.set", { ...base, id: r.id, prompt: "Review the open issues." });
  assert.equal(kept.max_steps, 20, "absent keeps what the routine had");

  const cleared = await env.client.call("routines.set", { ...base, id: r.id, max_steps: null });
  assert.equal(cleared.max_steps, undefined);
});

test("a routine's limit is bounded", async () => {
  await assert.rejects(
    env.client.call("routines.set", {
      name: "Too long",
      agent: "roby",
      schedule: { kind: "manual" },
      prompt: "x",
      max_steps: 1000,
    }),
  );
});
