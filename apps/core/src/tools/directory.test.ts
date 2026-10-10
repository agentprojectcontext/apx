import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { afterTool }) =>
  afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("list", "routine_list", {}),
);
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("routine_list shows global and project routines with the id apx routines takes", async () => {
  const { project } = await env.client.call("projects.create", { name: "Acme" });
  const global = await env.client.call("routines.set", {
    name: "weather-acme",
    agent: "roby",
    schedule: { kind: "cron", cron: "0 8 * * *" },
    prompt: "Say the weather",
  });
  const scoped = await env.client.call("routines.set", {
    name: "acme-digest",
    agent: "roby",
    project: project.id,
    schedule: { kind: "every", minutes: 60 },
    prompt: "Sum up the day",
    enabled: false,
  });
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Routines" });
  await env.client.call("threads.send", { thread: thread.id, text: "what routines do I have?" });
  await env.settle(thread.id);
  const out = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(out, new RegExp(`- weather-acme \\[${global.id}\\] \\(agent roby, cron 0 8 \\* \\* \\*, on, next `));
  assert.match(out, new RegExp(`- acme-digest \\[${scoped.id}\\] \\(agent roby, project Acme, every 60 min, off\\)`));
});
