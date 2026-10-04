import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { watchSignals } from "../domain/signals.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const get = () => env.client.call("secretary.get", {});
const set = async (patch: Record<string, unknown>) =>
  env.client.call("secretary.set", { ...(await get()).profile, ...patch });

test("off by default; turning it on seeds open, close and watch on the super-agent", async () => {
  const before = await get();
  assert.equal(before.profile.on, false);
  assert.deepEqual(before.routines, []);

  const { routines } = await set({ on: true });
  const by = (o: string) => routines.find((r) => r.origin === `secretary:${o}`);
  assert.deepEqual(by("day-open")?.schedule, { kind: "cron", cron: "30 8 * * 1-5" });
  assert.equal(by("day-open")?.anchor, true, "the day's open always arrives");
  assert.equal(by("day-close")?.anchor, true);
  assert.deepEqual(by("watch")?.schedule, { kind: "every", minutes: 120 });
  assert.equal(by("watch")?.action, "watch");
  assert.equal(by("watch")?.anchor, false, "the watch goes through the budget");
  for (const r of routines) {
    assert.equal(r.agent_id, "roby");
    assert.equal(r.enabled, true);
    assert.ok(r.next_run_at);
  }
});

test("a new schedule moves its routine; a prompt the owner edited stays, and Restore puts the default back", async () => {
  const open = (await get()).routines.find((r) => r.origin === "secretary:day-open");
  assert.ok(open);
  await env.client.call("routines.set", {
    id: open.id,
    name: open.name,
    agent: open.agent_id,
    schedule: open.schedule,
    prompt: "My own morning brief",
    enabled: true,
  });
  const { routines } = await set({ day_open: "0 7 * * *", calendar_command: "echo agenda" });
  const moved = routines.find((r) => r.origin === "secretary:day-open");
  assert.deepEqual(moved?.schedule, { kind: "cron", cron: "0 7 * * *" });
  assert.equal(moved?.prompt, "My own morning brief", "the owner's words stay");
  assert.equal(moved?.pre_command, "echo agenda", "the calendar comes in before the brief");
  const restored = await env.client.call("secretary.restore", { routine: open.id });
  assert.match(restored.prompt, /^Open the owner's day in ONE message/);
  await assert.rejects(set({ day_open: "whenever" }));
});

test("the super-agent's prompt says its role while the profile is on", async () => {
  const system = async () => {
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: t.id, text: "hola" });
    await env.settle(t.id);
    return String(llm.calls.at(-1)?.messages[0]?.content);
  };
  assert.match(await system(), /## Your role: chief of staff/);
  await set({ formality: "formal" });
  assert.match(await system(), /formally \(usted\)/);
  const { routines } = await set({ on: false });
  assert.ok(routines.length === 3 && routines.every((r) => !r.enabled), "off turns its routines off, keeps them");
  assert.doesNotMatch(await system(), /chief of staff/);
});

test("its thresholds feed the watch: a commitment is raised as early as the owner set", async () => {
  const ana = await env.client.call("contacts.set", { name: "Ana", role: "contact" });
  const inThreeDays = new Date(Date.now() + 72 * 3600_000).toISOString();
  await env.client.call("tasks.create", { title: "Send the deck", person: ana.id, due_at: inThreeDays });
  const raised = () =>
    watchSignals(env.core.store, { now: new Date() }).some(
      (s) => s.kind === "commitment_due" && /Send the deck/.test(s.subject),
    );
  assert.equal(raised(), false, "48 h ahead by default");
  await set({ commitment_lead_hours: 96 });
  assert.equal(raised(), true);
});

test("an imported v1 routine of the same job is adopted, not doubled", async () => {
  const fresh = await startCore({ llm });
  try {
    const v1 = await fresh.client.call("routines.set", {
      name: "secretary-day-close",
      agent: "roby",
      schedule: { kind: "manual" },
      prompt: "v1's close",
      enabled: false,
    });
    const profile = (await fresh.client.call("secretary.get", {})).profile;
    const { routines } = await fresh.client.call("secretary.set", { ...profile, on: true });
    const close = routines.filter((r) => r.origin === "secretary:day-close");
    assert.equal(close.length, 1);
    assert.equal(close[0]?.id, v1.id, "v1's own routine became the profile's");
    assert.equal(close[0]?.prompt, "v1's close");
    assert.equal(routines.length, 3);
  } finally {
    await fresh.core.close();
    fresh.cleanup();
  }
});
