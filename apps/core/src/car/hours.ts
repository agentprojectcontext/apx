// OSM `opening_hours`, the common subset (rules/ERRANDS_ON_THE_WAY.md#providers): weekdays, time ranges, "24/7",
// "off", times past midnight. Anything else (months, weeks, dates, "sunrise", open ends) is unknown, never guessed.
export type HoursNow = { open: "open" | "closed"; closes_soon: boolean };

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const DAY_MIN = 24 * 60;
const SOON_MIN = 60;

type Interval = { from: number; to: number };
/** Per weekday (0 = Monday), minutes from that day's midnight; `to` past 1440 runs into the next day. */
type Week = Interval[][];

function parseTime(s: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return undefined;
  return h * 60 + min;
}

function parseTimes(s: string): Interval[] | undefined {
  const out: Interval[] = [];
  for (const part of s.split(",")) {
    const m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(part.trim());
    if (!m) return undefined;
    const from = parseTime(m[1] ?? "");
    let to = parseTime(m[2] ?? "");
    if (from === undefined || to === undefined || from >= DAY_MIN) return undefined;
    if (to <= from) to += DAY_MIN;
    out.push({ from, to });
  }
  return out;
}

/** "Mo-Fr,Sa" → weekday indexes; holiday tokens (PH, SH) drop out; undefined when a token is not a weekday. */
function parseDays(s: string): { days: number[]; holiday: boolean } | undefined {
  const days: number[] = [];
  let holiday = false;
  for (const part of s.split(",")) {
    if (part === "PH" || part === "SH") {
      holiday = true;
      continue;
    }
    const m = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part);
    if (!m) return undefined;
    const a = DAYS.indexOf(m[1] as (typeof DAYS)[number]);
    const b = m[2] ? DAYS.indexOf(m[2] as (typeof DAYS)[number]) : a;
    for (let d = a; ; d = (d + 1) % 7) {
      if (!days.includes(d)) days.push(d);
      if (d === b) break;
    }
  }
  return { days, holiday };
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_LIST =
  /^(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*$/;

/**
 * Splits one ";" rule on the ", " that starts another weekday ("Mo-Fr 08:00-12:00, Sa 09:00-13:00"), which adds
 * to the rule before instead of replacing it.
 */
function splitAdditional(rule: string): string[] {
  return rule.split(/(?<=\d|off|closed|open)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b)/).map((r) => r.trim());
}

/** Parsed week, or undefined when any part is outside the supported subset. */
function parseOpeningHours(raw: string): Week | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const week: Week = ALL_DAYS.map(() => []);
  for (const rule of text.split(";")) {
    const r = rule.trim();
    if (!r) continue;
    const seen = new Set<number>();
    for (const part of splitAdditional(r)) {
      if (part === "24/7") {
        for (const d of ALL_DAYS) week[d] = [{ from: 0, to: DAY_MIN }];
        continue;
      }
      const [first = "", ...rest] = part.split(/\s+/);
      let days = ALL_DAYS;
      let spec = part;
      if (DAY_LIST.test(first)) {
        const parsed = parseDays(first);
        if (!parsed) return undefined;
        // A holiday-only rule ("PH off") says nothing about ordinary days.
        if (parsed.days.length === 0) continue;
        days = parsed.days;
        spec = rest.join(" ");
      }
      spec = spec.replace(/\s*,\s*/g, ",").trim();
      let intervals: Interval[];
      if (spec === "off" || spec === "closed") intervals = [];
      else if (spec === "" || spec === "open") intervals = [{ from: 0, to: DAY_MIN }];
      else {
        const times = parseTimes(spec);
        if (!times) return undefined;
        intervals = times;
      }
      for (const d of days) {
        // Within one ";" rule, comma-joined parts add up; a later ";" rule replaces the days it names.
        if (seen.has(d)) week[d] = [...(week[d] ?? []), ...intervals];
        else week[d] = [...intervals];
        seen.add(d);
      }
    }
  }
  return week;
}

function localTime(at: Date, timeZone: string | undefined): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Intervals as minutes from the start of `day`, covering yesterday's overflow, today and the next two days. */
function around(week: Week, day: number): Interval[] {
  const out: Interval[] = [];
  for (let offset = -1; offset <= 2; offset++) {
    for (const i of week[(day + offset + 7) % 7] ?? []) {
      out.push({ from: i.from + offset * DAY_MIN, to: i.to + offset * DAY_MIN });
    }
  }
  return out;
}

/**
 * Whether a place with these hours is open at `at` in `timeZone` (the owner's when unset), and whether it closes
 * within the hour. Undefined when the hours are missing or outside the supported subset. Holidays are not known.
 */
export function evaluateHours(raw: string | undefined, at: Date, timeZone?: string): HoursNow | undefined {
  if (!raw) return undefined;
  const week = parseOpeningHours(raw);
  if (!week) return undefined;
  const { day, minute } = localTime(at, timeZone);
  if (day < 0) return undefined;
  const spans = around(week, day);
  if (!spans.some((i) => i.from <= minute && minute < i.to)) return { open: "closed", closes_soon: false };
  // Follow touching or overlapping intervals to the real closing time (24/7 or "Mo 00:00-24:00, Tu 00:00-..." go on).
  let close = minute;
  for (let moved = true; moved; ) {
    moved = false;
    for (const i of spans) {
      if (i.from <= close && i.to > close) {
        close = i.to;
        moved = true;
      }
    }
  }
  return { open: "open", closes_soon: close - minute <= SOON_MIN };
}
