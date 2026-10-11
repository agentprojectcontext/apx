// A routine's schedule as the phone's editor changes it: a kind, and the few numbers each kind needs.
import type { Schedule } from "../../../../packages/protocol/src/index.ts";

export const EVERY_UNITS = [
  { id: "minutes", n: 1 },
  { id: "hours", n: 60 },
  { id: "days", n: 1440 },
] as const;
export type EveryUnit = (typeof EVERY_UNITS)[number]["id"];

/** The largest unit the minutes divide into: 120 → 2 hours. */
export function everyParts(minutes: number): { n: number; unit: EveryUnit } {
  const unit = [...EVERY_UNITS].reverse().find((u) => minutes % u.n === 0) ?? EVERY_UNITS[0];
  return { n: minutes / unit.n, unit: unit.id };
}

export function everyMinutes(n: number, unit: EveryUnit): number {
  return n * (EVERY_UNITS.find((u) => u.id === unit)?.n ?? 1);
}

/** What a new kind starts as: weekdays at 09:00, every hour, tomorrow at 09:00, or by hand. */
export function scheduleOfKind(kind: Schedule["kind"], now = new Date()): Schedule {
  switch (kind) {
    case "cron":
      return { kind, cron: "0 9 * * 1-5" };
    case "every":
      return { kind, minutes: 60 };
    case "once":
      return { kind, at: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).toISOString() };
    default:
      return { kind: "manual" };
  }
}

/** Whether the core takes it: five cron fields, at least every five minutes, a real moment. */
export function scheduleValid(s: Schedule): boolean {
  switch (s.kind) {
    case "cron":
      return s.cron.trim().split(/\s+/).length === 5;
    case "every":
      return Number.isInteger(s.minutes) && s.minutes >= 5;
    case "once":
      return !Number.isNaN(new Date(s.at).getTime());
    default:
      return true;
  }
}
