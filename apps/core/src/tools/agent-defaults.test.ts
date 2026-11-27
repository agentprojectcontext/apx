// New agents work in Auto and a fresh install's super-agent in Total; agents already there keep their mode
// (DECISIONS.md#d-279).
import assert from "node:assert/strict";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { modeOf, withProjectAutonomy } from "./policy.ts";

const llm = () =>
  scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    return said === "hire a helper" ? callTool("c1", "agent_set", { slug: "helper", role: "Helps" }) : say("ok");
  });

type Env = Awaited<ReturnType<typeof startCore>>;
/** The mode an agent works in, as a turn reads it: its own, else its project's, else the default. */
const working = (env: Env, id: string) => {
  const agent = env.core.store.agents.get(id);
  assert.ok(agent, id);
  return modeOf(withProjectAutonomy(env.core.store, agent));
};

test("a fresh install's super-agent is on Total; the team it starts with and agents added later are on Auto", async () => {
  const env = await startCore({ llm: llm(), superAgentAutonomy: "total" });
  try {
    assert.equal((await env.client.call("agents.get", { agent: "superagent" })).agent.autonomy, "total");
    assert.equal(working(env, "scout"), "auto");

    // From the panel or the CLI: no mode given, none stored, so it follows its project (Auto by default).
    const made = await env.client.call("agents.create", { slug: "writer", name: "Writer", role: "", prompt: "" });
    assert.equal(made.autonomy, undefined);
    assert.equal(working(env, made.id), "auto");

    // By the super-agent's tool, with no mode: the same.
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Team" });
    await env.client.call("threads.send", { thread: t.id, text: "hire a helper" });
    await env.settle(t.id);
    const helper = env.core.store.agents.list().find((a) => a.id === "helper" || a.slug === "helper");
    assert.ok(helper, "the tool made the agent");
    assert.equal(helper.autonomy, undefined);
    assert.equal(working(env, helper.id), "auto");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("an install that already has its super-agent keeps its mode when the core starts again", async () => {
  const home = tempDir("apx-open-agents-").path;
  // Started before: its super-agent was made with no mode of its own (Auto).
  const first = await startCore({ llm: llm(), home });
  await first.client.call("agents.update", { agent: "scout", autonomy: "manual" });
  await first.core.close();
  const env = await startCore({ llm: llm(), home, superAgentAutonomy: "total" });
  try {
    assert.equal((await env.client.call("agents.get", { agent: "superagent" })).agent.autonomy, undefined);
    assert.equal(working(env, "superagent"), "auto");
    assert.equal(working(env, "scout"), "manual");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
