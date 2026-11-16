// A chat working its own plan does not stop at "analysis in, I'll go on": a result turn that only reported, with
// steps left and nothing running, gets one turn to do the next step (DECISIONS.md#d-232).
import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const ASK = "Fix the cart: analyze, implement, validate.";

async function coordinate(onResult: string) {
  // Scout answers once the asking turn is over, so its result comes back as a turn of its own.
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
    if (system.startsWith("You are Scout")) {
      await gate;
      return say("The total ignores quantities.");
    }
    const tools = req.messages.filter((m) => m.role === "tool").length;
    if (said.includes(ASK)) {
      if (tools === 0) return callTool("p0", "plan", { steps: "- [x] Analyze\n- [ ] Implement\n- [ ] Validate" });
      if (tools === 1)
        return callTool("d0", "delegate", { agent: "scout", task: "Analyze the cart total.", wait_s: 0 });
      return say("Scout is analyzing.");
    }
    if (said.includes("your plan in this chat has steps left")) {
      if (!afterTool) return callTool("p1", "plan", { steps: "- [x] Analyze\n- [x] Implement\n- [x] Validate" });
      return say("Implemented and validated.");
    }
    if (said.includes("result of a task you delegated")) return say(onResult);
    return say("ok");
  });
  const env = await startCore({ llm });
  const chat = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
  const sent = await env.client.call("threads.send", { thread: chat, text: ASK });
  await waitFor(() => Boolean(env.core.store.runs.get(sent.run.id)?.ended_at), "the asking turn ended", { ms: 20000 });
  release();
  const runs = () => env.core.store.runs.list(chat, 20);
  await waitFor(
    () => runs().some((r) => r.input?.origin.kind === "delegation_result" && r.ended_at),
    "the result turn ended",
    { ms: 20000 },
  );
  return { env, chat, runs };
}

test("a result turn that only reports leaves no plan half done: the chat goes on once", async () => {
  const { env, runs } = await coordinate("Analysis received. Implementation and validation remain; I will continue.");
  try {
    await waitFor(
      () => runs().some((r) => r.input?.origin.kind === "plan_continue" && r.ended_at),
      "the plan went on",
      { ms: 20000 },
    );
    const going = runs().filter((r) => r.input?.origin.kind === "plan_continue");
    assert.equal(going.length, 1);
    assert.deepEqual(
      env.core.store.runs.steps(going[0]?.id ?? "").map((s) => s.tool),
      ["plan"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a result turn that asks the owner waits for the answer", async () => {
  const { env, runs } = await coordinate("Analysis received: the total ignores quantities. Shall I implement it?");
  try {
    assert.equal(runs().filter((r) => r.input?.origin.kind === "plan_continue").length, 0);
    assert.equal(env.core.store.runs.nextQueued(runs()[0]?.thread_id ?? ""), undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
