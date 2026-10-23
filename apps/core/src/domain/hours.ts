// Weekly hours in the owner's time zone: when a channel answers its contacts. See DECISIONS.md#d-136
import type { ChannelHours } from "@apx/protocol";

/** "HH:MM" as minutes since midnight. */
export const minutesOf = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekday (0 = Sunday) and minutes since midnight of `at` on the clocks of `timeZone` (none: this machine's). */
export function localTime(at: Date, timeZone?: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: WEEKDAYS.indexOf(part("weekday")), minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}

/**
 * Whether `at` falls in the hours. Hours past midnight belong to the day they start on: Friday 20:00–02:00 covers the
 * first two hours of Saturday, not of Friday.
 */
export function withinHours(hours: ChannelHours, at: Date, timeZone?: string): boolean {
  const { day, minutes } = localTime(at, timeZone);
  const from = minutesOf(hours.from);
  const to = minutesOf(hours.to);
  const opens = (d: number) => hours.days.includes(d);
  if (from === to) return opens(day);
  if (from < to) return opens(day) && minutes >= from && minutes < to;
  return (opens(day) && minutes >= from) || (opens((day + 6) % 7) && minutes < to);
}
