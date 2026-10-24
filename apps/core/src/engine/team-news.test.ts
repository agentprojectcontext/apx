import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("ok");
  if (said.includes("<team_news")) return say("April commented on a post; nothing needs you.");
  if (said.includes("urgent")) return callTool("n2", "notify_owner", { text: "The site is down", critical: true });
  if (said.includes("tell the owner")) return callTool("n1", "notify_owner", { text: "The deploy is done" });
  if (said.includes("check the posts")) return say("Commented on a post about verification.");
  return say("Your day looks clear.");
});
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
  await env.client.call("agents.create", { slug: "april", name: "April", role: "Community" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function runRoutine(id: string) {
  const started = await env.client.call("routines.run", { routine: id });
  await env.settle(started.thread_id);
  const end = Date.now() + 4000;
  let runs = (await env.client.call("routines.runs", { routine: id })).runs;
  while (runs[0]?.delivered === undefined && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 25));
    runs = (await env.client.call("routines.runs", { routine: id })).runs;
  }
  const { messages } = await env.client.call("threads.get", { thread: started.thread_id });
  const notices = messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "notice" ? [p.code] : [])));
  return { run: runs[0], notices };
}

const lastNotice = (kind: string) => env.core.store.nudges.list(50).find((n) => n.kind === kind);

test("another agent's news goes to the owner as before until a relay routine runs; then it waits for it", async () => {
  const april = await env.client.call("routines.set", {
    name: "april-check",
    agent: "april",
    schedule: { kind: "manual" },
    prompt: "check the posts",
  });
  await runRoutine(april.id);
  assert.equal(lastNotice("routine:april-check")?.state, "no_channel", "no relay routine: straight to the owner");

  const relay = await env.client.call("routines.set", {
    name: "Team news",
    agent: "roby",
    action: "relay",
    schedule: { kind: "manual" },
    prompt: "Tell the owner what the team had, or SKIP.",
  });
  await runRoutine(april.id);
  assert.equal(lastNotice("routine:april-check")?.state, "relay");
  // The super-agent's own routines still speak for themselves.
  const brief = await env.client.call("routines.set", {
    name: "Brief",
    agent: "roby",
    schedule: { kind: "manual" },
    prompt: "brief me",
  });
  await runRoutine(brief.id);
  assert.equal(lastNotice("routine:Brief")?.state, "no_channel");

  // A day's cap already spent: the team news still goes (only quiet hours hold it).
  const prefs = await env.client.call("notices.get", {});
  await env.client.call("notices.set", { ...prefs, budget_per_day: 1 });
  env.core.store.nudges.add({ kind: "routine:Other", text: "spent", state: "sent", exempt: false });
  const calls = llm.calls.length;
  const told = await runRoutine(relay.id);
  assert.equal(llm.calls.length, calls + 1);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /Tell the owner what the team had/);
  assert.match(
    input,
    /<team_news count="1" trust="untrusted">\n- April \(april-check\), [^\n]+:\nCommented on a post about verification\./,
  );
  assert.equal(told.run?.model_called, true);
  assert.equal(told.run?.delivered, true);
  assert.equal(lastNotice("routine:april-check")?.state, "merged", "told once");
  assert.equal(lastNotice("routine:Team news")?.text, "April commented on a post; nothing needs you.");
  assert.notEqual(lastNotice("routine:Team news")?.state, "dropped", "past the daily cap, it still goes");
  await env.client.call("notices.set", prefs);

  // Nothing waiting: no model call, nothing for the owner.
  const quiet = await runRoutine(relay.id);
  assert.equal(llm.calls.length, calls + 1, "no model call");
  assert.equal(quiet.run?.model_called, false);
  assert.equal(quiet.run?.delivered, false);
  assert.deepEqual(quiet.notices, ["routine.relay.quiet"]);
});

test("another agent's notify_owner waits for the team news; a critical one still goes now", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "april" });
  await env.client.call("threads.send", { thread: t.id, text: "when it ends, tell the owner" });
  await env.settle(t.id);
  assert.equal(lastNotice("agent:april")?.state, "relay");
  const tool = JSON.stringify((await env.client.call("threads.get", { thread: t.id })).messages);
  assert.match(tool, /handed to the super-agent/);

  await env.client.call("threads.send", { thread: t.id, text: "urgent" });
  await env.settle(t.id);
  const critical = env.core.store.nudges.list(5).find((n) => n.text === "The site is down");
  assert.equal(critical?.state, "no_channel", "a critical notice is not held for the team news");
});
