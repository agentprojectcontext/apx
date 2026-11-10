import type { MessageKey } from "../i18n/index.ts";

/** Monday first, as people read a week; days are numbered as cron and Date do, Sunday 0. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export const DAY_KEY: Record<number, MessageKey> = {
  0: "routines.day.sun",
  1: "routines.day.mon",
  2: "routines.day.tue",
  3: "routines.day.wed",
  4: "routines.day.thu",
  5: "routines.day.fri",
  6: "routines.day.sat",
};
