import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";

// Each owner message names the tool call the scripted model makes; the tool's result comes back as the answer.
const CALLS: Record<string, [string, object]> = {
  "how far can you go alone?": ["agent_limits", {}],
  "triple the limits": ["agent_limits", { runs: 90, tokens: 4_500_000 }],
  "go on": ["agent_limits", { go_on: "reset" }],
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const call = CALLS[said];
  return call ? callTool("c1", call[0], call[1]) : say("SKIP");
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const lastSeen = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);

async function ask(text: string, decision?: "approve" | "deny"): Promise<string> {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Limits" });
  // Agents already work together here: the limits apply, so the tool is offered.
  const sub = { kind: "a2a" as const, title: "Helper", agent_ids: ["scout", "roby"], parent_id: thread.id };
  env.core.store.threads.create(sub);
  await env.client.call("threads.send", { thread: thread.id, text });
  if (decision) {
    const pending: Array<{ id: string; tool?: string | undefined }> = await inputsOrEnd(env.client, thread.id);
    assert.equal(pending[0]?.tool, "agent_limits");
    await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision });
  }
  await env.settle(thread.id);
  return lastSeen();
}

test("agent_limits shows the limits in force without asking, and says the cache does not count", async () => {
  const seen = await ask("how far can you go alone?");
  assert.match(seen, /limits: 30 turns, 1500k fresh tokens/);
  assert.match(seen, /cache does not count/);
  assert.match(seen, /not paused/);
});

test("agent_limits changes the limits only after the owner's OK", async () => {
  assert.match(await ask("triple the limits", "deny"), /owner declined/);
  assert.deepEqual(env.core.store.settings.read("agent_limits"), {});
  assert.match(await ask("triple the limits", "approve"), /limits now: 90 turns, 4500k fresh tokens/);
  assert.deepEqual(env.core.store.settings.read("agent_limits"), { runs: 90, tokens: 4_500_000 });
  env.core.store.settings.write("agent_limits", {});
});

test("agent_limits lets a conversation go on with the owner's OK", async () => {
  assert.match(await ask("go on", "approve"), /went on \(reset\); 0 held turns started/);
});

test("a chat where no agents work together is not offered agent_limits", async () => {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Plain" });
  await env.client.call("threads.send", { thread: thread.id, text: "hola" });
  await env.settle(thread.id);
  assert.ok(!llm.calls.at(-1)?.tools?.some((t) => t.function.name === "agent_limits"));
});
