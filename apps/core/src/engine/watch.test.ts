import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { freshSignals, type Signal, watchSignals } from "../domain/signals.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("The invoice to Northwind is late: send it today?"));
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function runWatch(id: string) {
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

test("a watch calls its agent only with signals it has not told yet, as data; with nothing new it stays quiet", async () => {
  await env.client.call("tasks.create", { title: "Send the invoice to Northwind", due_at: "2026-01-05" });
  await env.client.call("tasks.create", { title: "Water the plants" });
  const r = await env.client.call("routines.set", {
    name: "Watch",
    agent: "roby",
    action: "watch",
    schedule: { kind: "cron", cron: "0 */2 * * *" },
    prompt: "Tell me only what matters now.",
  });

  const calls = llm.calls.length;
  const first = await runWatch(r.id);
  assert.equal(llm.calls.length, calls + 1);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /Tell me only what matters now\./);
  assert.match(
    input,
    /<signals count="1" trust="untrusted">\n- \[high\] Overdue by \d+ days: Send the invoice to Northwind/,
  );
  assert.doesNotMatch(input, /Water the plants/, "a task with no due date is no signal");
  assert.equal(first.run?.model_called, true);
  assert.equal(first.run?.delivered, true);

  // The same late task, again: already told today, so no model and nothing for the owner.
  const second = await runWatch(r.id);
  assert.equal(llm.calls.length, calls + 1, "no model call");
  assert.equal(second.run?.model_called, false);
  assert.equal(second.run?.delivered, false);
  assert.deepEqual(second.notices, ["routine.watch.quiet"]);
});

test("in the owner's quiet hours a watch waits without the model; the next run after them sees what is new", async () => {
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = new Date();
  const prefs = await env.client.call("notices.get", {});
  await env.client.call("notices.set", {
    ...prefs,
    quiet_from: hm(new Date(now.getTime() - 3_600_000)),
    quiet_to: hm(new Date(now.getTime() + 3_600_000)),
  });
  await env.client.call("tasks.create", { title: "Renew the Acme domain", due_at: "2026-01-06" });
  const r = await env.client.call("routines.set", {
    name: "Night watch",
    agent: "roby",
    action: "watch",
    schedule: { kind: "cron", cron: "0 */2 * * *" },
    prompt: "Only what matters.",
  });
  const calls = llm.calls.length;
  const quiet = await runWatch(r.id);
  assert.equal(llm.calls.length, calls, "no model call in quiet hours");
  assert.equal(quiet.run?.model_called, false);

  await env.client.call("notices.set", prefs);
  await runWatch(r.id);
  assert.equal(llm.calls.length, calls + 1);
  assert.match(
    String(llm.calls.at(-1)?.messages.at(-1)?.content),
    /Renew the Acme domain/,
    "the signal was kept for later",
  );
});

test("a signal already told comes back after a day; old records are dropped", () => {
  const s: Signal = { key: "overdue_task:t1", kind: "overdue_task", severity: "normal", subject: "x" };
  const t0 = new Date("2026-10-01T09:00:00Z");
  const a = freshSignals([s], {}, t0);
  assert.equal(a.fresh.length, 1);
  assert.equal(freshSignals([s], a.seen, new Date("2026-10-01T20:00:00Z")).fresh.length, 0);
  assert.equal(freshSignals([s], a.seen, new Date("2026-10-02T09:00:00Z")).fresh.length, 1);
  assert.deepEqual(freshSignals([], { old: "2026-09-01T00:00:00Z" }, t0).seen, {});
});

test("commitments: one falling due soon is high, one already late is critical and comes first", async () => {
  const { store } = env.core;
  const ana = store.persons.create({ name: "Ana", role: "contact" });
  const now = new Date();
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
  const add = (title: string, due_at: string) =>
    env.client.call("tasks.create", { title, due_at, kind: "commitment", person: ana.id });
  await add("Call back about the quote", at(1));
  await add("Return the drill", at(-1));
  await add("Far away", at(240));
  const signals = watchSignals(store, { now }).filter((s) => s.kind.includes("commitment"));
  assert.deepEqual(
    signals.map((s) => [s.severity, s.subject.replace(/ \d{4}-\S+:/, ":")]),
    [
      ["critical", "Commitment late: Return the drill (owed to Ana)"],
      ["high", "Commitment due: Call back about the quote (owed to Ana)"],
    ],
  );
});
