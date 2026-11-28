import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateHours } from "./hours.ts";

const TZ = "America/Argentina/Buenos_Aires";
// 2026-11-23 is a Monday; Buenos Aires is UTC-3 all year.
const at = (day: number, hhmm: string) => new Date(`2026-11-${String(23 + day).padStart(2, "0")}T${hhmm}:00-03:00`);
const MON = 0;
const TUE = 1;
const SAT = 5;
const SUN = 6;
const check = (hours: string, when: Date) => evaluateHours(hours, when, TZ);
const open = { open: "open", closes_soon: false };
const soon = { open: "open", closes_soon: true };
const closed = { open: "closed", closes_soon: false };

test("24/7 is always open and never closes soon", () => {
  assert.deepEqual(check("24/7", at(SUN, "03:00")), open);
  assert.deepEqual(check("24/7", at(MON, "23:50")), open);
});

test("weekday ranges, lists and split shifts", () => {
  const h = "Mo-Fr 08:00-12:30,16:00-20:30; Sa 09:00-13:00";
  assert.deepEqual(check(h, at(MON, "10:00")), open);
  assert.deepEqual(check(h, at(MON, "14:00")), closed);
  assert.deepEqual(check(h, at(MON, "20:00")), soon);
  assert.deepEqual(check(h, at(SAT, "12:30")), soon);
  // A day no rule names is closed.
  assert.deepEqual(check(h, at(SUN, "10:00")), closed);
  assert.deepEqual(check("Mo,We 10:00-12:00", at(TUE, "11:00")), closed);
  assert.deepEqual(check("Mo,We 10:00-12:00", at(MON, "10:30")), open);
  assert.deepEqual(check("Mo-Fr 08:00-12:00, Sa 09:00-13:00", at(SAT, "10:00")), open);
});

test("off, closed and later rules replace earlier ones", () => {
  assert.deepEqual(check("Mo-Su 09:00-21:00; Su off", at(SUN, "10:00")), closed);
  assert.deepEqual(check("Mo-Su 09:00-21:00; Su closed", at(SAT, "10:00")), open);
  assert.deepEqual(check("Mo-Sa 08:00-22:00; Su 10:00-14:00", at(SUN, "13:30")), soon);
});

test("times past midnight run into the next day", () => {
  const h = "Fr-Sa 20:00-02:00";
  assert.deepEqual(check(h, at(SAT, "01:30")), soon); // Friday's night
  assert.deepEqual(check(h, at(SUN, "01:00")), soon); // Saturday's night
  assert.deepEqual(check(h, at(SAT, "21:00")), open);
  assert.deepEqual(check(h, at(TUE, "01:00")), closed);
  // Open until midnight, then again from midnight: not closing soon.
  assert.deepEqual(check("Mo 18:00-24:00; Tu 00:00-03:00", at(MON, "23:30")), open);
});

test("holidays are ignored, not guessed", () => {
  assert.deepEqual(check("Mo-Fr 09:00-18:00; PH off", at(MON, "10:00")), open);
  assert.deepEqual(check("Sa,PH 10:00-14:00", at(SAT, "11:00")), open);
});

test("unknown or unsupported hours stay unknown", () => {
  for (const h of [
    "",
    "sunrise-sunset",
    "Mo-Fr 09:00+",
    "Jan-Mar Mo-Fr 09:00-18:00",
    "by appointment",
    "Mo-Fr 25:00-26:00",
  ]) {
    assert.equal(check(h, at(MON, "10:00")), undefined, h);
  }
  assert.equal(evaluateHours(undefined, at(MON, "10:00"), TZ), undefined);
});

test("the place's time zone decides the local time", () => {
  // 13:30 UTC is 10:30 in Buenos Aires and 14:30 in Madrid (winter).
  const when = new Date("2026-11-23T13:30:00Z");
  assert.deepEqual(evaluateHours("Mo 09:00-12:00", when, TZ), open);
  assert.deepEqual(evaluateHours("Mo 09:00-12:00", when, "Europe/Madrid"), closed);
});
