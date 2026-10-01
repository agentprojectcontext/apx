// When a routine runs next. Cron (five fields, local time: minute hour day-of-month month day-of-week, with *, lists,
// ranges and steps), every N minutes, once at a moment, or only by hand.
import type { Schedule } from "@apx/protocol";

type Field = { min: number; max: number };
const FIELDS: Field[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  // 7 is Sunday too.
  { min: 0, max: 7 },
];

/** One cron field as the set of values it allows; throws on anything it does not understand. */
function parseField(text: string, f: Field): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    if (!part) throw new Error(`empty item in "${text}"`);
    const [range = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);
    let lo = f.min;
    let hi = f.max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b === undefined ? (stepText === undefined ? lo : f.max) : Number(b);
    }
    if (!range || !Number.isInteger(lo) || !Number.isInteger(hi) || lo < f.min || hi > f.max || lo > hi)
      throw new Error(`"${part}" is outside ${f.min}-${f.max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export type Cron = {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  anyDay: boolean;
  anyWeekday: boolean;
};

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("a cron has five fields: minute hour day month weekday");
  const [m = "", h = "", d = "", mo = "", w = ""] = parts;
  const weekday = parseField(w, FIELDS[4] as Field);
  if (weekday.delete(7)) weekday.add(0);
  return {
    minute: parseField(m, FIELDS[0] as Field),
    hour: parseField(h, FIELDS[1] as Field),
    day: parseField(d, FIELDS[2] as Field),
    month: parseField(mo, FIELDS[3] as Field),
    weekday,
    // As in cron: a day field starting with * does not restrict, so the other day field alone decides.
    anyDay: d.startsWith("*"),
    anyWeekday: w.startsWith("*"),
  };
}

/** Cron's day rule: with both day fields restricted, either one matching is enough; otherwise both must. */
function dayMatches(c: Cron, t: Date): boolean {
  const d = c.day.has(t.getDate());
  const w = c.weekday.has(t.getDay());
  return c.anyDay || c.anyWeekday ? d && w : d || w;
}

/**
 * The first minute after `from` the cron allows (local time); undefined if none within four years. It steps forward
 * on real time and reads the local fields at each step, so a clock change (an hour repeated or skipped) can never
 * send it back before `from`.
 */
export function nextCron(c: Cron, from: Date): Date | undefined {
  const MIN = 60_000;
  let t = Math.floor(from.getTime() / MIN) * MIN + MIN;
  const limit = from.getTime() + 4 * 366 * 24 * 3600_000;
  while (t < limit) {
    const d = new Date(t);
    const minutes = d.getHours() * 60 + d.getMinutes();
    if (!c.month.has(d.getMonth() + 1) || !dayMatches(c, d)) {
      // Towards the next local day, an hour short so a clock change cannot skip its first hour.
      t += Math.max(60, 24 * 60 - minutes - 60) * MIN;
      continue;
    }
    if (!c.hour.has(d.getHours())) {
      t += (60 - d.getMinutes()) * MIN;
      continue;
    }
    if (!c.minute.has(d.getMinutes())) {
      t += MIN;
      continue;
    }
    return d;
  }
  return undefined;
}

/** A routine never runs more often than this: each run is a model turn. */
export const MIN_GAP_MIN = 5;

/** When a schedule runs next after `from`; undefined when it will not run on its own again. */
export function nextRun(s: Schedule, from: Date, lastRun?: Date): Date | undefined {
  switch (s.kind) {
    case "cron":
      return nextCron(parseCron(s.cron), from);
    case "every": {
      const base = lastRun ?? from;
      return new Date(Math.max(base.getTime() + s.minutes * 60_000, from.getTime() + 60_000));
    }
    case "once": {
      const at = new Date(s.at);
      return !lastRun && at.getTime() > from.getTime() - 60_000 ? at : undefined;
    }
    case "manual":
      return undefined;
  }
}

/** Throws with a readable reason when a schedule cannot run. */
export function checkSchedule(s: Schedule): void {
  if (s.kind === "cron") parseCron(s.cron);
  if (s.kind === "every" && (!Number.isFinite(s.minutes) || s.minutes < MIN_GAP_MIN))
    throw new Error(`every needs ${MIN_GAP_MIN} minutes or more`);
  if (s.kind === "once" && Number.isNaN(Date.parse(s.at))) throw new Error(`"${s.at}" is not a date`);
}
