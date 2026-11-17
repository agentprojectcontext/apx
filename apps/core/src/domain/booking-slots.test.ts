import assert from "node:assert/strict";
import { test } from "node:test";
import { bookableStarts, localDay, localSlot, offerOf, type SlotRules } from "./booking-slots.ts";

const TZ = "America/Argentina/Buenos_Aires";
// Monday 2026-11-16 09:00 in Buenos Aires (UTC-3).
const NOW = new Date("2026-11-16T12:00:00Z");
const rules = (o: Partial<SlotRules> = {}): SlotRules => ({
  hours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "13:00" },
  minutes: 30,
  timeZone: TZ,
  now: NOW,
  busy: [],
  ...o,
});
const slots = (r: SlotRules, day?: string) => bookableStarts(r, day).map((s) => localSlot(s, TZ));

test("a contact books only inside the hours, two hours ahead at least, and the whole appointment fits", () => {
  const monday = slots(rules(), "2026-11-16");
  assert.equal(monday[0], "2026-11-16T11:00", "not before two hours from now");
  assert.equal(monday.at(-1), "2026-11-16T12:30", "a 30-minute one still ends by 13:00");
  const long = slots(rules({ minutes: 60 }), "2026-11-17");
  assert.equal(long.at(-1), "2026-11-17T12:00");
  assert.deepEqual(slots(rules(), "2026-11-21"), [], "Saturday is closed");
});

test("nothing past two weeks ahead", () => {
  const all = slots(rules());
  assert.ok(all.length > 0);
  assert.ok(
    all.every((s) => s < "2026-11-30T12:00"),
    `last ${all.at(-1)}`,
  );
  assert.ok(all.some((s) => s.startsWith("2026-11-27")));
});

test("a busy block on the calendar is never overlapped, however it is aligned", () => {
  const busy = [[Date.parse("2026-11-17T13:10:00Z"), Date.parse("2026-11-17T13:50:00Z")] as const];
  const tuesday = slots(rules({ busy }), "2026-11-17");
  // 10:10–10:50 local: 9:45 ends at 10:15 and 10:45 starts before 10:50, both refused.
  for (const s of ["2026-11-17T09:45", "2026-11-17T10:00", "2026-11-17T10:15", "2026-11-17T10:30", "2026-11-17T10:45"])
    assert.ok(!tuesday.includes(s), s);
  assert.ok(tuesday.includes("2026-11-17T09:30"));
  assert.ok(tuesday.includes("2026-11-17T11:00"));
});

test("a day the account already filled takes no more", () => {
  const r = rules({ dayFull: (day) => day === "2026-11-17" });
  assert.deepEqual(slots(r, "2026-11-17"), []);
  assert.ok(slots(r, "2026-11-18").length > 0);
});

test("hours past midnight belong to the day they open", () => {
  const night = rules({ hours: { days: [5], from: "22:00", to: "02:00" }, minutes: 60 });
  const friday = bookableStarts(night).map((s) => localSlot(s, TZ));
  assert.ok(friday.includes("2026-11-20T22:00"));
  assert.ok(friday.includes("2026-11-21T01:00"), "Saturday's first hours are Friday's");
  assert.ok(!friday.includes("2026-11-21T01:15"), "and it ends by 02:00");
});

test("the offer spreads over days, an hour apart, a few each", () => {
  const offer = offerOf(bookableStarts(rules()), TZ);
  assert.ok(offer.length <= 12);
  const perDay = new Map<string, number>();
  for (const s of offer) perDay.set(localDay(s, TZ), (perDay.get(localDay(s, TZ)) ?? 0) + 1);
  assert.ok([...perDay.values()].every((n) => n <= 3));
  for (let i = 1; i < offer.length; i++) {
    const [a, b] = [offer[i - 1], offer[i]];
    if (a && b && localDay(a, TZ) === localDay(b, TZ)) assert.ok(b.getTime() - a.getTime() >= 3600_000);
  }
});
