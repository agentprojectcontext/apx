import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { watchSignals } from "../domain/signals.ts";
import { removeDir } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;

before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const get = () => env.client.call("profiles.list", {});
const set = async (patch: Record<string, string | number>) => {
  const { active } = await get();
  return env.client.call("profiles.set", { id: "secretary", values: { ...active.values, ...patch } });
};

test("no profile by default; APX's own are listed; the secretary seeds open, close, watch and team news on the super-agent", async () => {
  const before = await get();
  assert.equal(before.active.id, null);
  assert.deepEqual(before.routines, []);
  assert.deepEqual(
    before.profiles.map((p) => [p.id, p.source]),
    [
      ["focus", "apx"],
      ["secretary", "apx"],
    ],
  );

  const { routines, active } = await set({});
  assert.equal(active.values.day_open, "30 8 * * 1-5", "its defaults are kept as values");
  const by = (o: string) => routines.find((r) => r.origin === `secretary:${o}`);
  assert.deepEqual(by("day-open")?.schedule, { kind: "cron", cron: "30 8 * * 1-5" });
  assert.equal(by("day-open")?.anchor, true, "the day's open always arrives");
  assert.equal(by("day-close")?.anchor, true);
  // The day's open and close span every project and come with the profile's thresholds filled in.
  assert.match(by("day-close")?.prompt ?? "", /across every project.*quiet for more than 7 days/s);
  assert.match(by("day-close")?.prompt ?? "", /no activity for 48 hours/);
  assert.doesNotMatch(by("day-open")?.prompt ?? "", /\{\{/);
  assert.deepEqual(by("watch")?.schedule, { kind: "every", minutes: 120 });
  assert.equal(by("watch")?.action, "watch");
  assert.equal(by("watch")?.anchor, false, "the watch goes through the budget");
  assert.deepEqual(by("team-news")?.schedule, { kind: "every", minutes: 240 });
  assert.equal(by("team-news")?.action, "relay", "the other agents' news, told by the super-agent");
  assert.equal(by("team-news")?.anchor, false);
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
  assert.deepEqual((await get()).changed, [open.id], "only the edited one can be restored");
  const { routines } = await set({ day_open: "0 7 * * *", calendar_command: "echo agenda" });
  const moved = routines.find((r) => r.origin === "secretary:day-open");
  assert.deepEqual(moved?.schedule, { kind: "cron", cron: "0 7 * * *" });
  assert.equal(moved?.prompt, "My own morning brief", "the owner's words stay");
  assert.equal(moved?.pre_command, "echo agenda", "the calendar comes in before the brief");
  const restored = await env.client.call("profiles.restore", { routine: open.id });
  assert.match(restored.prompt, /^Open the owner's day in ONE message, across every project/);
  assert.doesNotMatch(restored.prompt, /\{\{/, "restored with the profile's values filled in");
  assert.deepEqual((await get()).changed, [], "nothing left to restore");
  await assert.rejects(set({ day_open: "whenever" }));
  const mail = (await set({ mail_every_min: 10 })).routines.find((r) => r.origin === "secretary:mail");
  assert.equal(mail?.action, "mail", "the secretary reads new mail");
  assert.deepEqual(mail?.schedule, { kind: "cron", cron: "*/10 * * * *" }, "as often as the owner chose");
  const fast = (await set({ mail_every_min: 0 })).routines.find((r) => r.origin === "secretary:mail");
  assert.deepEqual(fast?.schedule, { kind: "cron", cron: "*/2 * * * *" }, "never more often than every 2 minutes");
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
  await env.client.call("profiles.set", { id: null, values: {} });
  const kept = env.core.store.routines.list().filter((r) => r.origin?.startsWith("secretary:"));
  assert.ok(kept.length === 5 && kept.every((r) => !r.enabled), "none turns its routines off and keeps them");
  assert.doesNotMatch(await system(), /chief of staff/);
  await set({});
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
    const { routines } = await fresh.client.call("profiles.set", { id: "secretary", values: {} });
    const close = routines.filter((r) => r.origin === "secretary:day-close");
    assert.equal(close.length, 1);
    assert.equal(close[0]?.id, v1.id, "v1's own routine became the profile's");
    assert.match(close[0]?.prompt ?? "", /Close the owner's day/, "with v2's prompt: v1's named v1's tools");
    assert.equal(routines.length, 5);
  } finally {
    await fresh.core.close();
    await fresh.cleanup();
  }
});

test("a routine's turn hears how the owner rated its earlier messages", async () => {
  const open = (await get()).routines.find((r) => r.origin === "secretary:day-open");
  assert.ok(open);
  const store = env.core.store;
  for (const f of ["up", "down"] as const) {
    const n = store.nudges.add({ kind: `routine:${open.name}`, text: "brief", state: "sent", exempt: true });
    store.nudges.feedback(n.id, f, new Date(Date.now() + (f === "down" ? 1000 : 0)).toISOString());
  }
  const { thread_id } = await env.client.call("routines.run", { routine: open.id });
  await env.settle(thread_id);
  const said = llm.calls.flatMap((c) => c.messages).map((m) => String(m.content));
  assert.ok(
    said.some((t) =>
      /\[owner feedback\]\n.*1 of these messages useful and 1 not useful \(the latest: not useful\)/.test(t),
    ),
  );
});

test("another profile takes over: the secretary's routines turn off, the new one's turn on, its block replaces", async () => {
  const { routines } = await env.client.call("profiles.set", { id: "focus", values: { morning: "0 10 * * *" } });
  assert.deepEqual(routines.map((r) => [r.origin, r.enabled]).sort(), [
    ["focus:look-back", true],
    ["focus:one-thing", true],
  ]);
  const one = routines.find((r) => r.origin === "focus:one-thing");
  assert.deepEqual(one?.schedule, { kind: "cron", cron: "0 10 * * *" });
  assert.equal(one?.name, "Una cosa para hoy", "named in the owner's language");
  const secretary = env.core.store.routines.list().filter((r) => r.origin?.startsWith("secretary:"));
  assert.ok(secretary.every((r) => !r.enabled));
  await assert.rejects(env.client.call("profiles.set", { id: "nope", values: {} }), /not_found|profile nope/);
  await set({});
});

test("a profile installs from a folder, can run, and removing it while it runs leaves the super-agent with none", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-profile-"));
  try {
    fs.writeFileSync(
      path.join(dir, "apx-profile.json"),
      JSON.stringify({
        id: "golf-coach",
        name: { en: "Golf coach" },
        description: { en: "A lesson a day." },
        prompt: "## Your role: golf coach\nTeach {{level}}.",
        settings: [{ key: "level", type: "text", label: { en: "Level" }, default: "level 2" }],
        routines: [
          {
            key: "lesson",
            name: { en: "Lesson" },
            schedule: { kind: "every", hours: 24 },
            prompt: "One concept, short.",
          },
        ],
      }),
    );
    const { profile } = await env.client.call("profiles.install", { path: dir });
    assert.equal(profile.source, "owner");
    assert.ok((await get()).profiles.some((p) => p.id === "golf-coach"));
    const { routines } = await env.client.call("profiles.set", { id: "golf-coach", values: {} });
    assert.deepEqual(routines[0]?.schedule, { kind: "every", minutes: 1440 });
    await assert.rejects(env.client.call("profiles.install", { path: os.tmpdir() }), /apx-profile.json/);
    assert.equal((await env.client.call("profiles.remove", { id: "golf-coach" })).removed, true);
    assert.equal((await get()).active.id, null);
    assert.equal((await env.client.call("profiles.remove", { id: "secretary" })).removed, false, "APX's own stay");
  } finally {
    await removeDir(dir);
    await set({});
  }
});
