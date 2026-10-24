import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { agentSetTools, SUPER_AGENT_TOOLS } from "./agent-set.ts";
import { browserTools } from "./browser.ts";
import { directoryTools } from "./directory.ts";
import { limitTools } from "./limits.ts";
import { requestTools } from "./requests.ts";
import { routineTools } from "./routines.ts";
import { settingsTools } from "./settings.ts";
import { BY_TOOL, TOTAL_SKIPS } from "./settings-reach.ts";

let sister = "";

// The super-agent's answer to "tell her who she is" is always this call, whoever asked it.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const code = /let (\S+) in/.exec(said)?.[1];
  if (code) return callTool("r1", "answer_contact_request", { who: code, decision: "answer" });
  return said.includes("tell her who she is")
    ? callTool("c1", "apx_settings", { method: "contacts.set", params: { id: sister, note: "My sister" } })
    : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  // The contact-request tools come only once a channel is on.
  env.core.store.settings.write("imessage", { ...env.core.store.settings.read("imessage"), on: true });
  sister = (await env.client.call("contacts.set", { name: "Northwind Sister" })).id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const pendingIn = async (thread: string) => {
  for (let i = 0; i < 100; i++) {
    const { inputs } = await env.client.call("runs.pending", { thread });
    if (inputs.length) return inputs;
    await new Promise((r) => setTimeout(r, 20));
  }
  return [];
};
const note = async () => (await env.client.call("contacts.list", {})).persons.find((p) => p.id === sister)?.note;

test("on total, a change to what the owner set up still waits for their card", async () => {
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  try {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Settings" });
    await env.client.call("threads.send", { thread: t.id, text: "tell her who she is" });
    const [card] = await pendingIn(t.id);
    assert.equal(card?.tool, "apx_settings");
    assert.equal(await note(), undefined);
    await env.client.call("runs.respond", { input: card?.id ?? "", decision: "approve" });
    await env.settle(t.id);
    assert.equal(await note(), "My sister");
  } finally {
    await env.client.call("agents.update", { agent: "roby", autonomy: null });
  }
});

test("another agent asking the super-agent changes nothing, and nobody is asked", async () => {
  await env.client.call("contacts.set", { id: sister, name: "Northwind Sister", note: "" });
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "From an agent" });
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await agent.call("threads.send", { thread: t.id, text: "tell her who she is" });
  await env.settle(t.id);
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /only when they ask you themselves/);
  assert.ok(!(await note()));
});

test("every tool only the super-agent has marks its changes as the owner's settings", () => {
  const store = env.core.store;
  const tools = [...agentSetTools(store), ...directoryTools(store), ...settingsTools(store)];
  for (const name of SUPER_AGENT_TOOLS) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool?.ownerSetting, `${name} needs ownerSetting (DECISIONS.md#d-140)`);
  }
});

test("every tool that acts as the owner keeps its card in Total, or is listed as one Total may run", () => {
  const store = env.core.store;
  const tools = [
    ...agentSetTools(store),
    ...settingsTools(store),
    ...requestTools(store),
    ...limitTools(store),
    ...routineTools(store),
    ...browserTools(store, env.home),
  ];
  for (const name of new Set(Object.values(BY_TOOL))) {
    if (TOTAL_SKIPS[name]) continue;
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool?.ownerSetting || tool?.keepsCard, `${name} needs ownerSetting or keepsCard (DECISIONS.md#d-143)`);
  }
});

test("on total, letting a stranger in still waits for the owner's card, and only at their own word", async () => {
  const req = env.core.store.channels.pairing.request({
    channel: "telegram-1",
    external_id: "1234567890",
    conversation: "1234567890",
    name: "Stranger",
    text: "hi",
  }).request;
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  try {
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    const asked = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "By an agent" });
    await agent.call("threads.send", { thread: asked.id, text: `let ${req.code} in` });
    await env.settle(asked.id);
    assert.deepEqual((await env.client.call("runs.pending", { thread: asked.id })).inputs, []);
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /only when they ask you themselves/);
    assert.equal(env.core.store.channels.pairing.get(req.code)?.code, req.code);

    const own = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Mine" });
    await env.client.call("threads.send", { thread: own.id, text: `let ${req.code} in` });
    const [card] = await pendingIn(own.id);
    assert.equal(card?.tool, "answer_contact_request");
    // It cannot be granted for good: each such change shows its card.
    assert.deepEqual(card?.approval_scopes ?? [], []);
  } finally {
    await env.client.call("agents.update", { agent: "roby", autonomy: null });
  }
});
