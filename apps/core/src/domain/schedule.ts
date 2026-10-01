// When a routine runs next. Cron (five fields, local time: minute hour day-of-month month day-of-week, with *, lists,
// ranges and steps), every N minutes, once at a moment, or only by hand.
import type { Schedule } from "@apx/protocol";

type Field = { min: number; max: number };
const FIELDS: Field[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
];

/** One cron field as the set of values it allows; throws on anything it does not understand. */
function parseField(text: string, f: Field): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
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
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < f.min || hi > f.max || lo > hi)
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
  // 7 is Sunday too.
  const weekday = parseField(w.replace(/\b7\b/g, "0"), FIELDS[4] as Field);
  return {
    minute: parseField(m, FIELDS[0] as Field),
    hour: parseField(h, FIELDS[1] as Field),
    day: parseField(d, FIELDS[2] as Field),
    month: parseField(mo, FIELDS[3] as Field),
    weekday,
    anyDay: d === "*",
    anyWeekday: w === "*",
  };
}

/** Cron's day rule: with both day fields restricted, either one matching is enough. */
function dayMatches(c: Cron, t: Date): boolean {
  const d = c.day.has(t.getDate());
  const w = c.weekday.has(t.getDay());
  if (c.anyDay && c.anyWeekday) return true;
  if (c.anyDay) return w;
  if (c.anyWeekday) return d;
  return d || w;
}

/** The first minute after `from` the cron allows (local time); undefined if none within four years. */
export function nextCron(c: Cron, from: Date): Date | undefined {
  const t = new Date(from.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = from.getTime() + 4 * 366 * 24 * 3600_000;
  while (t.getTime() < limit) {
    if (!c.month.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0);
      continue;
    }
    if (!dayMatches(c, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0);
      continue;
    }
    if (!c.hour.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0);
      continue;
    }
    if (!c.minute.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1);
      continue;
    }
    return t;
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
