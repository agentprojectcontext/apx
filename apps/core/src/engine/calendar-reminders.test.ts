import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { officeScheduler } from "../office-wiring.ts";
import { waitFor } from "../testkit/platform.ts";
import type { Attention } from "./attention.ts";
import { type CalendarEvent, calendarReminders, dueEvents } from "./calendar-reminders.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const now = new Date("2026-05-04T17:55:00-03:00");
const ev = (id: string, start: string, more: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  start,
  all_day: false,
  ...more,
});

test("an event is due once it starts within the lead time, and only once", () => {
  const events = [
    ev("doctor", "2026-05-04T18:20:00-03:00"),
    ev("meeting", "2026-05-04T18:30:00-03:00"),
    ev("later", "2026-05-04T19:00:00-03:00"),
    ev("ongoing", "2026-05-04T17:30:00-03:00"),
  ];
  const first = dueEvents(events, {}, now, 30);
  assert.deepEqual(
    first.due.map((e) => e.id),
    ["doctor"],
    "18:30 is 35 minutes away, 19:00 further, and what already started is not told",
  );
  const again = dueEvents(events, first.told, new Date(now.getTime() + 5 * 60_000), 30);
  assert.deepEqual(
    again.due.map((e) => e.id),
    ["meeting"],
    "five minutes later the 18:30 comes in; the doctor is not told twice",
  );
});

test("a moved event is told again at its new time, and what started leaves the record", () => {
  const first = dueEvents([ev("call", "2026-05-04T18:10:00-03:00")], {}, now, 30);
  const moved = dueEvents([ev("call", "2026-05-04T18:15:00-03:00")], first.told, now, 30);
  assert.equal(moved.due.length, 1);
  const after = dueEvents([], moved.told, new Date("2026-05-04T18:20:00-03:00"), 30);
  assert.deepEqual(after.told, {}, "both starts are past");
});

test("all-day, declined and cancelled events are never reminded", () => {
  const due = dueEvents(
    [
      ev("holiday", "2026-05-04", { all_day: true }),
      ev("declined", "2026-05-04T18:00:00-03:00", { declined: true }),
      ev("cancelled", "2026-05-04T18:00:00-03:00", { status: "cancelled" }),
    ],
    {},
    now,
    60,
  );
  assert.deepEqual(due.due, []);
});

let env: Awaited<ReturnType<typeof startCore>>;
let clock = now;
let connected = false;
const calendar: CalendarEvent[] = [];
const asked: Array<{ from: string; to: string }> = [];
const sent: string[] = [];
let office: ReturnType<typeof officeScheduler>;

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")), clock: () => new Date(2000, 0, 1) });
  env.core.store.settings.write("owner_profile", {
    ...env.core.store.settings.read("owner_profile"),
    timezone: "America/Argentina/Buenos_Aires",
  });
  const store = env.core.store;
  office = officeScheduler({
    store,
    admit: () => {
      throw new Error("no runs here");
    },
    attention: { add() {} } as unknown as Attention,
    notifyOwner: (body) => {
      sent.push(body.text);
      return true;
    },
    checks: (remind) => [
      calendarReminders({
        store,
        source: {
          readable: () => connected,
          between: async (from, to) => {
            asked.push({ from, to });
            return calendar.filter((e) => (e.start ?? "") >= from && (e.start ?? "") <= to);
          },
        },
        remind: (texts) => remind(texts, "event"),
      }),
    ],
    log: { info() {}, warn() {}, error() {}, debug() {} } as never,
    now: () => clock,
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

const minutes = (m: number) => new Date(clock.getTime() + m * 60_000).toISOString();
const step = (m: number) => (clock = new Date(clock.getTime() + m * 60_000));
/** One beat of the office clock, and the check it started has answered. */
const beat = async () => {
  office.tick();
  await new Promise((res) => setImmediate(res));
};

test("reminders stay off until the owner turns them on in Calendar's settings, and need Calendar connected", async () => {
  calendar.push(ev("Doctor", minutes(20), { location: "Clinic" }));
  await beat();
  connected = true;
  step(1);
  await beat();
  assert.deepEqual(asked, [], "off by default: Calendar is never asked");
  env.core.store.settings.write("calendar_reminders", { enabled: true, lead_min: 30, every_min: 1 });
  connected = false;
  step(1);
  await beat();
  assert.deepEqual(asked, [], "not connected: nothing to ask");
});

test("an event about to start is told once, in a fixed line in the owner's language and time zone", async () => {
  connected = true;
  calendar.push(ev("Planning with Northwind", minutes(90)));
  step(1);
  await beat();
  await waitFor(() => sent.length === 1, "the reminder");
  assert.equal(asked.at(-1)?.to, minutes(30), "only the lead time ahead");
  assert.equal(sent[0], "A las 18:15 (en 17 min): Doctor. Clinic");
  step(1);
  await beat();
  await waitFor(() => asked.length === 2, "the next check");
  assert.equal(sent.length, 1, "each event once");
});

test("Calendar is looked at as often as the owner chose, and never less often than the lead time", async () => {
  connected = true;
  const looks = async (minutes: number) => {
    const before = asked.length;
    for (let i = 0; i < minutes; i++) {
      step(1);
      await beat();
    }
    return asked.length - before;
  };
  env.core.store.settings.write("calendar_reminders", { enabled: true, lead_min: 30, every_min: 10 });
  await looks(10);
  assert.equal(await looks(30), 3, "every ten minutes");
  env.core.store.settings.write("calendar_reminders", { enabled: true, lead_min: 5, every_min: 60 });
  await looks(5);
  assert.equal(await looks(30), 6, "an hour apart would miss events: every five minutes, the lead time");
});
