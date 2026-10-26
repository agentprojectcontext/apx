import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  await env.client.call("agents.create", { slug: "clerk", name: "Clerk" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** What the model got for one owner message to the clerk: the turn's input and the system prompt. */
async function seen(text: string): Promise<{ input: string; system: string }> {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "clerk", title: "Mode" });
  await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id);
  const call = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes(text));
  return {
    input: String(call?.messages.at(-1)?.content),
    system: String(call?.messages.find((m) => m.role === "system")?.content),
  };
}

test("an agent's system prompt says what its mode lets it do and that APX asks the owner; each turn names the mode", async () => {
  const auto = await seen("what may you do?");
  assert.match(auto.input, /^\[context: [^\]]* · mode: Auto\]/);
  assert.doesNotMatch(auto.input, /\[mode\]/, "the mode's text is said once, in the cached system prompt");
  assert.match(
    auto.system,
    /^## Permission mode: Auto\n- Auto: read anything; edit files and run commands in your work folder, the owner.s other projects/m,
  );
  assert.match(auto.system, /APX asks them: make the call, never ask_owner for permission/);
  assert.match(auto.system, /A choice only the owner can make .*: ask_owner with the action you propose/);

  await env.client.call("agents.update", { agent: "clerk", autonomy: "plan" });
  const plan = await seen("and now?");
  assert.match(plan.input, / · mode: Plan\]/);
  assert.match(plan.system, /^- Plan: read and propose/m);
});

test("the agent is told to save confirmed approaches in its own words, and remember says how a note is written", async () => {
  const { system } = await seen("hello");
  assert.match(system, /save reusable preferences, decisions and confirmed approaches with remember\./);
  const call = llm.calls.findLast((c) => String(c.messages.at(-1)?.content).includes("hello"));
  const remember = JSON.stringify(call?.tools?.find((t) => JSON.stringify(t).includes('"remember"')));
  assert.match(remember, /a Why only if stated, a How to apply only if supported/);
  assert.match(remember, /in your own words/);
});
