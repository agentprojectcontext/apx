// Cron ⇄ human, both directions.
//
// Imports the web's TypeScript directly — Node 24 strips types natively, so
// presentation logic with no DOM in it does not need a second test runner or a
// new dependency to be covered.
//
// The reason this is tested rather than eyeballed: a schedule summary that is
// confidently WRONG is worse than showing the raw expression, because the user
// stops checking. Every case where the reader cannot be sure is asserted to
// return null so the caller falls back to the cron text.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  describeCron, parseCron, cronDays, cronToSelection, selectionToCron,
  isPickerFriendly, normalizeCron,
} = await import(path.join(ROOT, "src/interfaces/web/src/lib/cron.ts"));

/** Stand-in for i18n: returns the key plus its vars, so assertions read plainly. */
const t = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

// --------------------------------------------------------------------------
// reading a schedule
// --------------------------------------------------------------------------

test("the two schedules the secretary ships read as sentences", () => {
  assert.equal(describeCron("30 8 * * 1-5", t), 'cron.weekdays {"at":"08:30"}');
  assert.equal(describeCron("30 18 * * 1-5", t), 'cron.weekdays {"at":"18:30"}');
});

test("every-N-hours, the watch routine's shape", () => {
  assert.equal(describeCron("0 */2 * * *", t), 'cron.every_n_hours {"n":2,"minute":"00"}');
  assert.equal(describeCron("15 */1 * * *", t), 'cron.every_hour {"minute":"15"}');
});

test("daily, weekends, and an arbitrary day set", () => {
  assert.equal(describeCron("0 9 * * *", t), 'cron.daily {"at":"09:00"}');
  assert.equal(describeCron("0 10 * * 0,6", t), 'cron.weekends {"at":"10:00"}');
  assert.match(describeCron("0 9 * * 1,3", t), /cron\.on_days/);
});

test("Sunday as 7 is the same day as Sunday as 0", () => {
  // Cron accepts both. Reading them differently would be a bug the user could
  // only find by waiting a week.
  assert.deepEqual(cronDays("7"), [0]);
  assert.equal(describeCron("0 10 * * 0,6", t), describeCron("0 10 * * 6,7", t));
});

test("minutes and day-of-month forms", () => {
  assert.equal(describeCron("*/15 * * * *", t), 'cron.every_n_minutes {"n":15}');
  assert.equal(describeCron("* * * * *", t), "cron.every_minute");
  assert.equal(describeCron("0 9 1 * *", t), 'cron.monthly {"day":1,"at":"09:00"}');
});

// --------------------------------------------------------------------------
// refusing to guess
// --------------------------------------------------------------------------

test("anything ambiguous or unsupported returns null, not a guess", () => {
  assert.equal(describeCron("", t), null);
  assert.equal(describeCron("0 9 * *", t), null, "four fields is not a cron");
  assert.equal(describeCron("0 9 * 3 *", t), null, "a specific month is not handled");
  assert.equal(describeCron("0 9 1 * 1", t), null, "dom AND dow together is ambiguous in cron itself");
  assert.equal(describeCron("0,30 9 * * *", t), null, "two minutes per hour is not phrased");
  assert.equal(describeCron("garbage", t), null);
});

test("out-of-range fields are refused rather than wrapped", () => {
  assert.equal(describeCron("0 99 * * *", t), null);
  assert.equal(describeCron("0 9 * * 9", t), null);
  assert.equal(describeCron("0 9-2 * * *", t), null, "an inverted range");
});

// --------------------------------------------------------------------------
// the picker: cron → controls → cron
// --------------------------------------------------------------------------

test("a schedule survives a round trip through the picker", () => {
  for (const expr of ["30 8 * * 1-5", "0 9 * * *", "0 10 * * 0,6", "0 */2 * * *", "45 23 * * 1"]) {
    const back = selectionToCron(cronToSelection(expr));
    assert.equal(
      normalizeCron(back), normalizeCron(expr),
      `${expr} came back as ${back} — a picker that rewrites the schedule on open is a picker that loses it`,
    );
  }
});

test("the picker reads the parts a human edits", () => {
  const sel = cronToSelection("30 8 * * 1-5");
  assert.equal(sel.time, "08:30");
  assert.deepEqual(sel.days, [1, 2, 3, 4, 5]);
  assert.equal(sel.everyHours, 0);

  const every = cronToSelection("0 */3 * * *");
  assert.equal(every.everyHours, 3);
});

test("no days ticked means every day, not no days", () => {
  // An empty set has to mean "*" — a cron with an empty dow field is invalid,
  // and a picker that produced one would silently stop the routine.
  assert.equal(selectionToCron({ time: "07:00", days: [], everyHours: 0 }), "0 7 * * *");
  assert.equal(selectionToCron({ time: "07:00", days: [0,1,2,3,4,5,6], everyHours: 0 }), "0 7 * * *");
});

test("the picker cannot emit an invalid expression", () => {
  const nonsense = [
    { time: "99:99", days: [], everyHours: 0 },
    { time: "", days: [3], everyHours: 0 },
    { time: "08:00", days: [], everyHours: 999 },
    { time: "08:00", days: [], everyHours: -4 },
  ];
  for (const sel of nonsense) {
    const expr = selectionToCron(sel);
    assert.ok(parseCron(expr), `${JSON.stringify(sel)} produced "${expr}"`);
    assert.equal(expr.trim().split(/\s+/).length, 5);
  }
});

test("a schedule the picker cannot hold is flagged, not silently narrowed", () => {
  // The editor uses this to open the raw field instead of showing controls
  // that do not match the expression.
  assert.equal(isPickerFriendly("30 8 * * 1-5"), true);
  assert.equal(isPickerFriendly("0 */2 * * *"), true);
  assert.equal(isPickerFriendly("0 9 1 * *"), false, "day-of-month");
  assert.equal(isPickerFriendly("0,30 9 * * *"), false, "two minutes per hour");
  assert.equal(isPickerFriendly("0 9,17 * * *"), false, "two hours a day");
  assert.equal(isPickerFriendly("nope"), false);
});

test("normalising makes equivalent expressions compare equal", () => {
  assert.equal(normalizeCron("30 08 * * 1-5"), normalizeCron("30 8 * * 1,2,3,4,5"));
  assert.equal(normalizeCron("0 9 * * 7"), normalizeCron("0 9 * * 0"));
  assert.equal(normalizeCron("nonsense"), "nonsense", "unparseable passes through untouched");
});
