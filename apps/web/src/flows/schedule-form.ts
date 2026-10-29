// The schedule card's choices and the cron a schedule step keeps, both ways (DECISIONS.md#d-182): fixed times per
// day become one cron per group of days with the same times (and minute), joined by `;`; "every N units" is one cron.
// A cron neither reads back as stays a hand-written one.

/** A day of the week as cron counts it: 0 is Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** The week as the card lists it, Monday first. */
export const WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
/** Each chosen day's times, `HH:MM`. */
export type DayTimes = Partial<Record<Weekday, string[]>>;

export type EveryUnit = "minutes" | "hours" | "days" | "weeks" | "months";
/** The counts cron can repeat evenly: a step must divide its field, and five minutes is the shortest. */
export const EVERY_STEPS: Record<EveryUnit, readonly number[]> = {
  minutes: [5, 10, 15, 20, 30],
  hours: [1, 2, 3, 4, 6, 8, 12],
  days: [1, 2, 3, 4, 5, 6, 7, 10, 14, 15],
  weeks: [1],
  months: [1, 2, 3, 4, 6, 12],
};
export type Every = { n: number; unit: EveryUnit; at: string; weekday: Weekday; day: number };
export const EVERY_START: Every = { n: 1, unit: "days", at: "09:00", weekday: 1, day: 1 };

export type ScheduleForm = { mode: "times"; days: DayTimes } | { mode: "every"; every: Every } | { mode: "cron" };

/** At most this many crons in one schedule (the core's FLOW_CRONS_MAX). */
export const CRONS_MAX = 7;

const hm = (time: string): [number, number] => {
  const [h = "0", m = "0"] = time.split(":");
  return [Number(h), Number(m)];
};
const pad = (n: number) => String(n).padStart(2, "0");
export const timeOf = (h: number, m: number) => `${pad(h)}:${pad(m)}`;
const sorted = (times: string[]) => [...new Set(times)].sort();

/** The cron for these days and times; "" when no day has a time, undefined when it needs more than seven crons. */
export function timesCron(days: DayTimes): string | undefined {
  const groups = new Map<string, Weekday[]>();
  for (const d of WEEK) {
    const times = sorted(days[d] ?? []);
    if (!times.length) continue;
    const key = times.join(",");
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const crons: string[] = [];
  for (const [key, group] of groups) {
    const byMinute = new Map<number, number[]>();
    for (const time of key.split(",")) {
      const [h, m] = hm(time);
      byMinute.set(m, [...(byMinute.get(m) ?? []), h]);
    }
    for (const [m, hours] of byMinute) crons.push(`${m} ${hours.join(",")} * * ${weekdays(group)}`);
  }
  if (crons.length > CRONS_MAX) return undefined;
  return crons.join("; ");
}

/** Days as cron writes them: `*` for the whole week, runs of three or more as ranges (1-5). */
function weekdays(days: Weekday[]): string {
  if (days.length === 7) return "*";
  const ordered = [...days].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ordered.length; ) {
    let j = i;
    while (j + 1 < ordered.length && (ordered[j + 1] ?? 0) === (ordered[j] ?? 0) + 1) j++;
    parts.push(j - i >= 2 ? `${ordered[i]}-${ordered[j]}` : ordered.slice(i, j + 1).join(","));
    i = j + 1;
  }
  return parts.join(",");
}

/** The cron for "every N units". */
export function everyCron(e: Every): string {
  const [h, m] = hm(e.at);
  const step = (n: number) => (n === 1 ? "*" : `*/${n}`);
  switch (e.unit) {
    case "minutes":
      return `*/${e.n} * * * *`;
    case "hours":
      return `0 ${step(e.n)} * * *`;
    case "days":
      return `${m} ${h} ${step(e.n)} * *`;
    case "weeks":
      return `${m} ${h} * * ${e.weekday}`;
    case "months":
      return `${m} ${h} ${e.day} ${step(e.n)} *`;
  }
}

const NUMBER = /^\d{1,2}$/;
const inRange = (v: string, lo: number, hi: number) => NUMBER.test(v) && Number(v) >= lo && Number(v) <= hi;
const stepOf = (v: string, unit: EveryUnit): number | undefined => {
  const n = v === "*" ? 1 : /^\*\/\d{1,2}$/.test(v) ? Number(v.slice(2)) : undefined;
  return n !== undefined && EVERY_STEPS[unit].includes(n) ? n : undefined;
};

/** What the card shows for a cron: "every…" first, then fixed times, else the cron as written. */
export function readCron(cron: string): ScheduleForm {
  const every = readEvery(cron.trim());
  if (every) return { mode: "every", every };
  const days = readTimes(cron);
  return days ? { mode: "times", days } : { mode: "cron" };
}

function readEvery(cron: string): Every | undefined {
  const [m = "", h = "", d = "", mo = "", w = "", ...rest] = cron.split(/\s+/);
  if (rest.length || cron.includes(";")) return;
  const at = (hour: string, minute: string) =>
    inRange(hour, 0, 23) && inRange(minute, 0, 59) ? timeOf(Number(hour), Number(minute)) : undefined;
  if (h === "*" && d === "*" && mo === "*" && w === "*" && m.startsWith("*/")) {
    const n = stepOf(m, "minutes");
    return n ? { ...EVERY_START, unit: "minutes", n } : undefined;
  }
  const hours = m === "0" && d === "*" && mo === "*" && w === "*" ? stepOf(h, "hours") : undefined;
  if (hours) return { ...EVERY_START, unit: "hours", n: hours };
  const time = at(h, m);
  if (!time) return;
  if (mo === "*" && w === "*" && d.startsWith("*")) {
    const n = stepOf(d, "days");
    return n ? { ...EVERY_START, unit: "days", n, at: time } : undefined;
  }
  if (w === "*" && inRange(d, 1, 28) && mo.startsWith("*")) {
    const n = stepOf(mo, "months");
    return n ? { ...EVERY_START, unit: "months", n, at: time, day: Number(d) } : undefined;
  }
  return;
}

function readTimes(cron: string): DayTimes | undefined {
  const days: DayTimes = {};
  for (const part of cron.split(";")) {
    const [m = "", h = "", d = "", mo = "", w = "", ...rest] = part.trim().split(/\s+/);
    if (rest.length || d !== "*" || mo !== "*" || !inRange(m, 0, 59)) return;
    const hours = h.split(",");
    if (!hours.every((x) => inRange(x, 0, 23))) return;
    const week = readWeekdays(w);
    if (!week) return;
    for (const day of week)
      days[day] = sorted([...(days[day] ?? []), ...hours.map((x) => timeOf(Number(x), Number(m)))]);
  }
  return days;
}

function readWeekdays(field: string): Weekday[] | undefined {
  if (field === "*") return [...WEEK];
  const out = new Set<Weekday>();
  for (const part of field.split(",")) {
    const [a = "", b] = part.split("-");
    if (!inRange(a, 0, 7) || (b !== undefined && !inRange(b, 0, 7))) return;
    const lo = Number(a);
    const hi = b === undefined ? lo : Number(b);
    if (lo > hi) return;
    for (let v = lo; v <= hi; v++) out.add((v % 7) as Weekday);
  }
  return [...out];
}

/** A weekday's name in `locale`, long or short. */
export const dayName = (d: Weekday, width: "long" | "short", locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + d)));

/** Fixed times in words, days with the same times together: "Mon 04:00, 05:00 · Wed, Fri 09:15". */
export function timesText(days: DayTimes, locale: string): string {
  const groups = new Map<string, Weekday[]>();
  for (const d of WEEK) {
    const times = days[d];
    if (times?.length) groups.set(sorted(times).join(", "), [...(groups.get(sorted(times).join(", ")) ?? []), d]);
  }
  const text = [...groups]
    .map(([times, group]) => `${group.map((d) => dayName(d, "short", locale)).join(", ")} ${times}`)
    .join(" · ");
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
