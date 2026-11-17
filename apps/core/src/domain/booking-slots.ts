// When a contact may book an appointment on the owner's calendar: inside the account's hours, far enough ahead, not
// past the horizon, on a quarter-hour grid, clear of every busy block, on a day the account still takes them.
// Everything the contact's chat may pick comes from here, so a time it makes up is refused. See DECISIONS.md#d-238
import type { ChannelHours } from "@apx/protocol";
import { withinHours } from "./hours.ts";

/** How soon a contact may book: never sooner than this from now. */
const BOOKING_LEAD_MS = 2 * 3600_000;
/** How far ahead a contact may book. */
export const BOOKING_HORIZON_DAYS = 14;
/** Appointments start on this grid. */
const GRID_MS = 15 * 60_000;

export type SlotRules = {
  hours: ChannelHours;
  minutes: number;
  timeZone?: string | undefined;
  now: Date;
  /** Busy blocks on the owner's calendar, [start, end) in epoch ms. */
  busy: ReadonlyArray<readonly [number, number]>;
  /** A day of the owner's ("YYYY-MM-DD", with a moment in it) that takes no more bookings. */
  dayFull?: (day: string, at: Date) => boolean;
};

const formats = new Map<string, Intl.DateTimeFormat>();
const format = (timeZone: string | undefined) => {
  let f = formats.get(timeZone ?? "");
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      ...(timeZone ? { timeZone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formats.set(timeZone ?? "", f);
  }
  return f;
};

const parts = (at: Date, timeZone: string | undefined) => {
  const p = format(timeZone).formatToParts(at);
  const v = (type: string) => p.find((x) => x.type === type)?.value ?? "";
  return { day: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
};

/** The owner's day of `at` ("YYYY-MM-DD"). */
export const localDay = (at: Date, timeZone?: string) => parts(at, timeZone).day;
/** `at` on the owner's clock, as a contact's chat names a time ("YYYY-MM-DDTHH:MM"). */
export const localSlot = (at: Date, timeZone?: string) => {
  const p = parts(at, timeZone);
  return `${p.day}T${p.time}`;
};

/** The first moment of the bookable range and the last one. */
export function bookingWindow(now: Date): { from: number; to: number } {
  const from = Math.ceil((now.getTime() + BOOKING_LEAD_MS) / GRID_MS) * GRID_MS;
  return { from, to: now.getTime() + BOOKING_HORIZON_DAYS * 24 * 3600_000 };
}

/** Whether the whole of [start, start + minutes) is inside the hours. */
function fitsHours(r: SlotRules, start: number): boolean {
  for (let t = start; t < start + r.minutes * 60_000; t += GRID_MS)
    if (!withinHours(r.hours, new Date(t), r.timeZone)) return false;
  return true;
}

const clear = (r: SlotRules, start: number) => {
  const end = start + r.minutes * 60_000;
  return r.busy.every(([s, e]) => end <= s || start >= e);
};

/** Every start a contact may book, soonest first; with `day`, only those on that day of the owner's. */
export function bookableStarts(r: SlotRules, day?: string): Date[] {
  const { from, to } = bookingWindow(r.now);
  const out: Date[] = [];
  for (let t = from; t + r.minutes * 60_000 <= to; t += GRID_MS) {
    const at = new Date(t);
    const d = localDay(at, r.timeZone);
    if (day && d !== day) continue;
    if (r.dayFull?.(d, at)) continue;
    if (fitsHours(r, t) && clear(r, t)) out.push(at);
  }
  return out;
}

/** A few starts spread over the days: the first `perDay` of each day, at most `max` in all. */
export function offerOf(starts: readonly Date[], timeZone: string | undefined, perDay = 3, max = 12): Date[] {
  const seen = new Map<string, number>();
  const out: Date[] = [];
  for (const s of starts) {
    const d = localDay(s, timeZone);
    const n = seen.get(d) ?? 0;
    // An hour apart at least, so the offer is not four quarter-hours of one morning.
    const last = out.at(-1);
    if (n >= perDay || (last && localDay(last, timeZone) === d && s.getTime() - last.getTime() < 3600_000)) continue;
    seen.set(d, n + 1);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
