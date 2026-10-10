import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

// Each owner message names the tool call the scripted model makes; the tool's result comes back as the answer.
const CALLS: Record<string, [string, object]> = {
  "show me Acme Writer": ["agent_set", { agent: "Acme Writer" }],
  "hire a researcher": ["agent_set", { slug: "researcher", name: "Researcher", role: "Finds sources" }],
  "hire a sentry": ["agent_set", { slug: "sentry", name: "Sentry" }],
  "rename the writer": ["agent_set", { agent: "acme-writer", name: "Northwind Writer", prompt: "Write short." }],
  "let the writer go": ["agent_set", { agent: "acme-writer", archive: true }],
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const call = CALLS[said];
  return call ? callTool("c1", call[0], call[1]) : say("ok");
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  await env.client.call("agents.create", {
    slug: "acme-writer",
    name: "Acme Writer",
    role: "Writes copy",
    prompt: "Write long.",
  });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

async function ask(text: string, agent = "roby", decision?: "approve" | "deny"): Promise<string> {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: agent, title: "Team" });
  await env.client.call("threads.send", { thread: thread.id, text });
  if (decision) {
    let pending: Array<{ id: string; tool?: string | undefined }> = [];
    for (let i = 0; i < 100 && !pending.length; i++) {
      pending = (await env.client.call("runs.pending", { thread: thread.id })).inputs;
      if (!pending.length) await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(pending[0]?.tool, "agent_set");
    await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision });
  }
  await env.settle(thread.id);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
}

const agent = async (id: string) => (await env.client.call("agents.list", {})).agents.find((a) => a.id === id);

test("only the super-agent is offered agent_set", async () => {
  const offered = async (agent: string) => {
    await ask("hello", agent);
    return llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
  };
  assert.ok((await offered("roby")).includes("agent_set"));
  assert.ok(!(await offered("acme-writer")).includes("agent_set"));
});

test("reading an agent's definition and prompt needs no OK", async () => {
  assert.match(
    await ask("show me Acme Writer"),
    /^Acme Writer \(id: acme-writer\)\nrole: Writes copy\nprompt:\nWrite long\.$/,
  );
});

test("an agent is created, changed and archived only once the owner says yes", async () => {
  assert.match(await ask("hire a sentry", "roby", "deny"), /not run: the owner declined/);
  assert.equal(await agent("sentry"), undefined);

  assert.match(await ask("hire a researcher", "roby", "approve"), /created: Researcher \(id: researcher\)/);
  assert.equal((await agent("researcher"))?.role, "Finds sources");

  assert.match(await ask("rename the writer", "roby", "approve"), /saved: Northwind Writer \(id: acme-writer/);
  const writer = await env.client.call("agents.get", { agent: "acme-writer" });
  assert.equal(writer.agent.name, "Northwind Writer");
  assert.equal(writer.agent.role, "Writes copy", "what was not given stays");
  assert.equal(writer.prompt, "Write short.");

  assert.match(await ask("let the writer go", "roby", "approve"), /archived Northwind Writer/);
  assert.equal(await agent("acme-writer"), undefined);
});
