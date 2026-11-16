import type { MessageKey } from "../i18n/index.ts";

/** A day's name in the panel's strings, by the day's number in WEEK (week.ts, which the phone shares). */
export const DAY_KEY: Record<number, MessageKey> = {
  0: "routines.day.sun",
  1: "routines.day.mon",
  2: "routines.day.tue",
  3: "routines.day.wed",
  4: "routines.day.thu",
  5: "routines.day.fri",
  6: "routines.day.sat",
};
