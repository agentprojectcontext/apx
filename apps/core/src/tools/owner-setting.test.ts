import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { agentSetTools, SUPER_AGENT_TOOLS } from "./agent-set.ts";
import { directoryTools } from "./directory.ts";
import { settingsTools } from "./settings.ts";

let sister = "";

// The super-agent's answer to "tell her who she is" is always this call, whoever asked it.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  return said.includes("tell her who she is")
    ? callTool("c1", "apx_settings", { method: "contacts.set", params: { id: sister, note: "My sister" } })
    : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  sister = (await env.client.call("contacts.set", { name: "Northwind Sister" })).id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
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
