import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createNudges, ratingNote } from "./nudges.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let clock = new Date(2026, 9, 5, 10, 0);
let sent: string[] = [];
let rates: Array<string | undefined> = [];
let nudges: ReturnType<typeof createNudges>;

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  nudges = createNudges({
    store: env.core.store,
    send: (text, _thread, rate) => {
      sent.push(text);
      rates.push(rate);
      return true;
    },
    digest: (texts) => `DIGEST[${texts.join("|")}]`,
    now: () => clock,
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});
afterEach(() => {
  sent = [];
  rates = [];
  env.core.store.settings.write("notices", { inputs_after_s: 120 } as never);
});

const prefs = (p: Record<string, unknown>) =>
  env.core.store.settings.write("notices", { inputs_after_s: 120, ...p } as never);
const at = (h: number, m = 0, day = 5) => {
  clock = new Date(2026, 9, day, h, m);
};

test("three unasked messages a day by default; then only the tray", () => {
  at(10);
  prefs({ project_gap_min: 0, kind_gap_min: 0 });
  const states = ["a", "b", "c", "d"].map((k) => nudges.offer({ kind: `routine:${k}`, text: k }));
  assert.deepEqual(states, ["sent", "sent", "sent", "dropped"]);
  assert.deepEqual(sent, ["a", "b", "c"]);
  assert.deepEqual(nudges.today(), { sent: 3, cap: 3 });
  // Anchors and reminders the owner set always go, and do not count.
  assert.equal(nudges.offer({ kind: "routine:morning", text: "brief", anchor: true }), "sent");
  assert.equal(nudges.offer({ kind: "reminder", text: "call the bank", asked: true }), "sent");
  assert.equal(nudges.today().sent, 3);
  // A new day starts the count again.
  at(10, 0, 6);
  assert.equal(nudges.offer({ kind: "routine:e", text: "e" }), "sent");
});

test("one about the same project, or of the same kind, waits its gap", () => {
  at(10, 0, 7);
  prefs({ budget_per_day: 0, project_gap_min: 180, kind_gap_min: 120 });
  assert.equal(nudges.offer({ kind: "routine:x", text: "1", project_id: "p1" }), "sent");
  at(11, 0, 7);
  assert.equal(nudges.offer({ kind: "routine:y", text: "2", project_id: "p1" }), "dropped", "same project, 1 h later");
  assert.equal(nudges.offer({ kind: "routine:x", text: "3" }), "dropped", "same kind, 1 h later");
  assert.equal(nudges.offer({ kind: "routine:z", text: "4", project_id: "p2" }), "sent");
  at(13, 30, 7);
  assert.equal(nudges.offer({ kind: "routine:y", text: "5", project_id: "p1" }), "sent", "past both gaps");
  const log = env.core.store.nudges.list(10);
  assert.match(log.find((n) => n.text === "2")?.reason ?? "", /this project/);
});

test("quiet hours hold what is unasked, then it goes together when they end", () => {
  prefs({ quiet_from: "22:00", quiet_to: "07:30", budget_per_day: 0, project_gap_min: 0, kind_gap_min: 0 });
  at(23, 0, 8);
  assert.equal(nudges.offer({ kind: "routine:a", text: "night news" }), "held");
  assert.equal(nudges.offer({ kind: "reminder", text: "late reminder", asked: true }), "held");
  assert.equal(nudges.offer({ kind: "routine:morning", text: "anchor", anchor: true }), "sent");
  assert.deepEqual(sent, ["anchor"]);
  at(6, 0, 9);
  nudges.release();
  assert.deepEqual(sent, ["anchor"], "still quiet");
  at(7, 31, 9);
  nudges.release();
  assert.deepEqual(sent, ["anchor", "DIGEST[night news|late reminder]"]);
  nudges.release();
  assert.equal(sent.length, 2, "once");
  // Something critical may wake the owner only when they said so.
  at(23, 30, 9);
  assert.equal(nudges.offer({ kind: "x", text: "fire", critical: true }), "held");
  prefs({ quiet_from: "22:00", quiet_to: "07:30", critical_wakes: true });
  assert.equal(nudges.offer({ kind: "x", text: "fire again", critical: true }), "sent");
});

test("the log lists what was meant, newest first, with what became of it", async () => {
  const { items, today } = await env.client.call("notices.log", { limit: 5 });
  assert.equal(items.length, 5);
  assert.ok(items.every((n, i) => i === 0 || (items[i - 1]?.at ?? "") >= n.at));
  assert.equal(typeof today.cap, "number");
});

test("a routine is made an anchor, and keeps it when changed without saying", async () => {
  const r = await env.client.call("routines.set", {
    name: "Morning brief",
    agent: "roby",
    schedule: { kind: "manual" },
    prompt: "Brief me",
    anchor: true,
    enabled: false,
  });
  assert.equal(r.anchor, true);
  const again = await env.client.call("routines.set", {
    id: r.id,
    name: "Morning brief",
    agent: "roby",
    schedule: { kind: "manual" },
    prompt: "Brief me, shorter",
    enabled: false,
  });
  assert.equal(again.anchor, true);
});

test("a routine's news can be rated; a kind marked 👎 twice stops reaching the owner until a 👍", async () => {
  at(9, 0, 12);
  prefs({ budget_per_day: 0, project_gap_min: 0, kind_gap_min: 0 });
  const offer = () => nudges.offer({ kind: "routine:Watch", text: "news" });
  assert.equal(offer(), "sent");
  assert.equal(nudges.offer({ kind: "reminder", text: "call", asked: true }), "sent");
  const [first, reminder] = rates;
  assert.ok(first, "a routine's news carries its id for 👍/👎");
  assert.equal(reminder, undefined, "a reminder the owner set is not rated");

  const rate = (id: string, feedback: "up" | "down" | null) => env.client.call("notices.feedback", { id, feedback });
  assert.equal((await rate(first, "down")).feedback, "down");
  assert.equal(offer(), "sent", "one 👎 is not enough");
  await rate(rates.at(-1) ?? "", "down");
  assert.equal(offer(), "dropped");
  assert.match(env.core.store.nudges.list(1)[0]?.reason ?? "", /unhelpful/);
  // An anchor of that kind still arrives; its rating only shapes it.
  assert.equal(nudges.offer({ kind: "routine:Watch", text: "brief", anchor: true }), "sent");
  assert.match(ratingNote(env.core.store, "routine:Watch", clock), /0 of these messages useful and 2 not useful/);

  await new Promise((r) => setTimeout(r, 5));
  await rate(first, "up");
  assert.equal(offer(), "sent", "a later 👍 lifts it");
  assert.equal(ratingNote(env.core.store, "routine:Never", clock), "");
  await assert.rejects(rate("ndg_missing", "up"));
});
