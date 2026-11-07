// "Send now" while an agent waits inside its turn for a teammate it asked: the wait is let go, so the teammate's answer
// still reaches the agent (a new turn) even when it lands while the turn goes on. See DECISIONS.md#d-186
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

/** Gates the test opens; each also ends when its call is stopped. Never decided by time. */
const gates = new Map<string, () => void>();
const gate = (key: string, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    gates.set(key, resolve);
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
const open = (key: string) => gates.get(key)?.();

const hold = defineTool({
  name: "hold",
  description: "test tool that waits until released",
  args: z.object({}),
  effect: "none",
  confirm: "never",
  deadlineMs: 60_000,
  title: () => "Holding",
  run: async (_args, ctx) => {
    await gate("caller", ctx.signal);
    return "held";
  },
});

const OWNER_ADDS = "[The owner adds";
/** What the caller's model read back from its cut delegate call. */
let cutText = "";
const woken: string[] = [];
const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  if (system.startsWith("You are Scout")) {
    await gate("scout", req.signal);
    return say("Scout's findings on alpha.");
  }
  if (said.includes("<delegation_result")) {
    woken.push(said);
    return say("Noted the findings.");
  }
  if (said.startsWith(OWNER_ADDS)) {
    if (!cutText) {
      cutText = String(req.messages.findLast((m) => m.role === "tool")?.content ?? "");
      // Keeps the turn going past the teammate's answer.
      return callTool("h1", "hold", {});
    }
    if (afterTool) return say("Done with beta.");
  }
  if (said.startsWith("ask scout"))
    return callTool("d1", "delegate", { agent: "scout", task: "look into alpha", wait_s: 120 });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm, extraTools: [hold] });
});
after(async () => {
  for (const go of gates.values()) go();
  await env.core.close();
  await env.cleanup();
});

test("send now during a delegate's wait lets the wait go: a later answer comes back as a new turn", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "audit" }))
    .id;
  const sent = await env.client.call("threads.send", { thread, text: "ask scout about alpha" });
  await waitFor(() => gates.has("scout"), "scout at work while the caller waits for it");

  const s = await env.client.call("threads.send", { thread, text: "meanwhile check beta", mode: "steer" });
  assert.deepEqual(await env.client.call("runs.send_now", { message: s.message.id }), { now: true });
  await waitFor(() => gates.has("caller"), "the caller's turn going on with the owner's words");
  assert.match(cutText, /stopped part way/);
  assert.match(cutText, /answer comes back in a new turn/, "the model is told the teammate still answers");
  assert.match(cutText, /do not delegate it again/);

  // Scout answers while the caller's turn is still at work.
  open("scout");
  const results = () =>
    env.core.store.runs
      .list(thread, 20)
      .filter((r) => r.trigger === "a2a_result" && r.input?.origin?.kind === "delegation_result");
  await waitFor(() => results().length === 1, "scout's answer delivered to the caller");
  assert.equal(env.core.store.runs.get(sent.run.id)?.state, "working", "it arrived while the turn went on");

  open("caller");
  await waitFor(() => results()[0]?.state === "completed", "the result turn");
  assert.equal(env.core.store.runs.get(sent.run.id)?.state, "completed");
  assert.equal(woken.length, 1);
  assert.match(woken[0] ?? "", /Scout's findings on alpha/);
});
