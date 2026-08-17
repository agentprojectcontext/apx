/**
 * Five-field cron ⇄ human, both directions.
 *
 * `30 8 * * 1-5` is not a thing anyone should have to read to answer "when
 * does my morning message arrive". Two pure functions, one file, so the
 * summary shown in a status line and the picker used in a form can never
 * disagree about what an expression means.
 *
 * Deliberately NOT a general cron library. It covers what APX writes and what
 * the picker produces — fixed time, day-of-week sets, day-of-month, and
 * step values — and says plainly when it does not understand something rather
 * than guessing. `describeCron` returning null is the signal for a surface to
 * fall back to showing the raw expression.
 */

export interface CronParts {
  minute: string;
  hour: string;
  dom: string;
  month: string;
  dow: string;
}

/** What a picker edits. */
export interface CronSelection {
  /** "HH:MM" in the machine's local time. */
  time: string;
  /** 0=Sunday … 6=Saturday. Empty = every day. */
  days: number[];
  /** Run every N hours instead of at a fixed time. 0 = off. */
  everyHours: number;
}

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function parseCron(expr: string): CronParts | null {
  const f = String(expr || "").trim().split(/\s+/);
  if (f.length !== 5) return null;
  return { minute: f[0], hour: f[1], dom: f[2], month: f[3], dow: f[4] };
}

// Expand `1-5`, `1,3,5`, `*` and step values like `*/2` into concrete numbers.
// (Kept as a line comment: a `*/` inside a block comment closes it.)
function expand(field: string, min: number, max: number): number[] | null {
  const out = new Set<number>();
  for (const part of String(field).split(",")) {
    const step = part.match(/^(.+)\/(\d+)$/);
    const body = step ? step[1] : part;
    const by = step ? Number(step[2]) : 1;
    if (!Number.isFinite(by) || by < 1) return null;

    let lo: number;
    let hi: number;
    if (body === "*") { lo = min; hi = max; }
    else {
      const range = body.match(/^(\d+)-(\d+)$/);
      if (range) { lo = Number(range[1]); hi = Number(range[2]); }
      else if (/^\d+$/.test(body)) { lo = Number(body); hi = lo; }
      else return null;
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += by) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Day numbers a cron dow field selects. Cron accepts 7 for Sunday. */
export function cronDays(dow: string): number[] | null {
  if (dow === "*" || dow === "?") return [];
  const nums = expand(dow.replace(/\b7\b/g, "0"), 0, 6);
  return nums && nums.length ? nums : null;
}

/**
 * A sentence. Returns null when the expression is beyond what this understands
 * — the caller shows the raw cron rather than a confident wrong reading.
 */
export function describeCron(
  expr: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  const p = parseCron(expr);
  if (!p) return null;
  if (p.month !== "*") return null;      // "in March" is not a case APX writes
  if (p.dom !== "*" && p.dow !== "*") return null; // both set is ambiguous in cron itself

  // Every N hours: `0 */2 * * *`.
  const stepHour = p.hour.match(/^\*\/(\d+)$/);
  if (stepHour && /^\d+$/.test(p.minute)) {
    const n = Number(stepHour[1]);
    return n === 1
      ? t("cron.every_hour", { minute: pad(Number(p.minute)) })
      : t("cron.every_n_hours", { n, minute: pad(Number(p.minute)) });
  }
  // Every N minutes: `*/15 * * * *`.
  const stepMin = p.minute.match(/^\*\/(\d+)$/);
  if (stepMin && p.hour === "*") return t("cron.every_n_minutes", { n: Number(stepMin[1]) });
  if (p.minute === "*" && p.hour === "*") return t("cron.every_minute");

  const hours = expand(p.hour, 0, 23);
  const minutes = expand(p.minute, 0, 59);
  if (!hours || !minutes || minutes.length !== 1) return null;

  const at = hours.length === 1
    ? `${pad(hours[0])}:${pad(minutes[0])}`
    : hours.map((h) => `${pad(h)}:${pad(minutes[0])}`).join(", ");

  if (p.dom !== "*") {
    const doms = expand(p.dom, 1, 31);
    if (!doms || doms.length !== 1) return null;
    return t("cron.monthly", { day: doms[0], at });
  }

  const days = cronDays(p.dow);
  if (days === null) return null;
  if (!days.length) return t("cron.daily", { at });

  const weekdays = [1, 2, 3, 4, 5];
  const isWeekdays = days.length === 5 && weekdays.every((d) => days.includes(d));
  if (isWeekdays) return t("cron.weekdays", { at });
  if (days.length === 2 && days.includes(0) && days.includes(6)) return t("cron.weekends", { at });

  const names = days.map((d) => t(`cron.day_short.${DAY_KEYS[d]}`)).join(", ");
  return t("cron.on_days", { days: names, at });
}

/** Cron → what a picker should show. */
export function cronToSelection(expr: string): CronSelection {
  const p = parseCron(expr);
  const fallback: CronSelection = { time: "08:00", days: [], everyHours: 0 };
  if (!p) return fallback;

  const stepHour = p.hour.match(/^\*\/(\d+)$/);
  if (stepHour) {
    return {
      time: `00:${pad(Number(/^\d+$/.test(p.minute) ? p.minute : 0))}`,
      days: [],
      everyHours: Number(stepHour[1]),
    };
  }
  const hours = expand(p.hour, 0, 23);
  const minutes = expand(p.minute, 0, 59);
  const days = cronDays(p.dow);
  return {
    time: hours?.length && minutes?.length ? `${pad(hours[0])}:${pad(minutes[0])}` : fallback.time,
    days: days ?? [],
    everyHours: 0,
  };
}

/** What a picker produces. Always a valid five-field expression. */
export function selectionToCron(sel: CronSelection): string {
  if (sel.everyHours > 0) {
    const [, mm] = splitTime(sel.time);
    return `${mm} */${clamp(sel.everyHours, 1, 23)} * * *`;
  }
  const [hh, mm] = splitTime(sel.time);
  // Sorted, and 0 kept as 0 — cron accepts both 0 and 7 for Sunday, and
  // writing one form consistently keeps round-tripping stable.
  const dow = sel.days.length && sel.days.length < 7
    ? [...sel.days].sort((a, b) => a - b).join(",")
    : "*";
  return `${mm} ${hh} * * ${dow}`;
}

/** Is this something the pickers can represent without losing information? */
export function isPickerFriendly(expr: string): boolean {
  const p = parseCron(expr);
  if (!p) return false;
  if (p.month !== "*" || p.dom !== "*") return false;
  return selectionToCron(cronToSelection(expr)) === normalizeCron(expr);
}

/** `30 08 * * 1-5` → `30 8 * * 1,2,3,4,5`, so comparisons are meaningful. */
export function normalizeCron(expr: string): string {
  const p = parseCron(expr);
  if (!p) return String(expr || "").trim();
  const days = cronDays(p.dow);
  const dow = days && days.length && days.length < 7 ? days.join(",") : "*";
  const one = (f: string) => (/^\d+$/.test(f) ? String(Number(f)) : f);
  return `${one(p.minute)} ${one(p.hour)} ${p.dom} ${p.month} ${dow}`;
}

function splitTime(time: string): [string, string] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!m) return ["8", "0"];
  return [String(clamp(Number(m[1]), 0, 23)), String(clamp(Number(m[2]), 0, 59))];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}
