import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";

// Each owner message names the tool call the scripted model makes; the tool's result comes back as the answer.
const CALLS: Record<string, [string, object]> = {
  "what routines do I have?": ["routine_list", {}],
  "show me weather-acme": ["routine_list", { routine: "weather-acme" }],
  "make a tea reminder": ["routine_set", { name: "tea", prompt: "Remind me to drink tea", every_min: 90 }],
  "make a coffee reminder": ["routine_set", { name: "coffee", prompt: "Remind me to drink coffee", every_min: 90 }],
  "make weather-acme shorter and run it": [
    "routine_set",
    { routine: "weather-acme", prompt: "Say the weather in one line", run_now: true },
  ],
  "turn off weather-acme": ["routine_set", { routine: "weather-acme", enabled: false }],
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
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Routines" });
  await env.client.call("threads.send", { thread: thread.id, text });
  if (decision) {
    const pending: Array<{ id: string; tool?: string | undefined }> = await inputsOrEnd(env.client, thread.id);
    assert.equal(pending[0]?.tool, "routine_set");
    await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision });
  }
  await env.settle(thread.id);
  return lastSeen();
}

const byName = async (name: string) =>
  (await env.client.call("routines.list", {})).routines.find((r) => r.name === name);

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
  const out = await ask("what routines do I have?");
  assert.match(out, new RegExp(`- weather-acme \\[${global.id}\\] \\(agent roby, cron 0 8 \\* \\* \\*, on, next `));
  assert.match(out, new RegExp(`- acme-digest \\[${scoped.id}\\] \\(agent roby, project Acme, every 60 min, off\\)`));
});

test("routine_list with a name shows that routine's whole prompt", async () => {
  assert.match(await ask("show me weather-acme"), /- weather-acme .*\nprompt:\nSay the weather$/);
});

test("routine_set creates a routine only once the owner says yes", async () => {
  assert.match(await ask("make a tea reminder", "deny"), /not run: the owner declined/);
  assert.equal(await byName("tea"), undefined);

  assert.match(
    await ask("make a coffee reminder", "approve"),
    /saved: - coffee \[rtn_\w+\] \(agent roby, every 90 min, on/,
  );
  const coffee = await byName("coffee");
  assert.equal(coffee?.prompt, "Remind me to drink coffee");
  assert.equal(coffee?.agent_id, "roby");
});

test("routine_set changes only what it is given, by name, and can run the routine now", async () => {
  const out = await ask("make weather-acme shorter and run it", "approve");
  assert.match(out, /saved: - weather-acme .*cron 0 8 \* \* \*, on/);
  assert.match(out, /running now in thread th_/);
  const r = await byName("weather-acme");
  assert.equal(r?.prompt, "Say the weather in one line");
  assert.deepEqual(r?.schedule, { kind: "cron", cron: "0 8 * * *" });
  for (let i = 0; i < 100 && !(await env.client.call("routines.runs", { routine: r?.id ?? "" })).runs.length; i++)
    await new Promise((res) => setTimeout(res, 20));
  assert.equal((await env.client.call("routines.runs", { routine: r?.id ?? "" })).runs.length, 1);

  await ask("turn off weather-acme", "approve");
  const off = await byName("weather-acme");
  assert.equal(off?.enabled, false);
  assert.equal(off?.prompt, "Say the weather in one line");
});
