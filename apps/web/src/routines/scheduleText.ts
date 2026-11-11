// What a schedule reads as, apart from its editor: lists and the Inbox show it without loading the form.
import type { Schedule } from "@apx/protocol";
import { aheadLabel } from "../common/format.ts";
import { DAY_KEY } from "../common/week.ts";
import type { MessageKey, T } from "../i18n/index.ts";
import { weeklyOf } from "./cron.ts";

export const UNITS = [
  { id: "minutes", n: 1 },
  { id: "hours", n: 60 },
  { id: "days", n: 1440 },
  { id: "weeks", n: 10080 },
] as const;
export type Unit = (typeof UNITS)[number]["id"];
/** The largest unit the minutes divide into: 120 → 2 hours. */
export function everyParts(minutes: number): { n: number; unit: Unit } {
  const u = [...UNITS].reverse().find((x) => minutes % x.n === 0) ?? UNITS[0];
  return { n: minutes / u.n, unit: u.id };
}

export function scheduleText(s: Schedule, t: T): string {
  switch (s.kind) {
    case "cron": {
      const w = weeklyOf(s.cron);
      if (!w) return `cron ${s.cron}`;
      const key = w.days.join(",");
      const days =
        w.days.length === 7
          ? t("routines.days.every")
          : key === "1,2,3,4,5"
            ? t("routines.days.weekdays")
            : key === "6,0"
              ? t("routines.days.weekends")
              : w.days.map((d) => t(DAY_KEY[d] as MessageKey)).join(", ");
      return t("routines.atTime", { days, time: w.time });
    }
    case "every": {
      const { n, unit } = everyParts(s.minutes);
      // "Every hour", not "every 1 hours".
      if (n === 1) return t("routines.everyOne", { unit: t(`routines.unitOne.${unit}`) });
      return t("routines.everyUnit", { n, unit: t(`routines.unit.${unit}`) });
    }
    case "once":
      return t("routines.onceAt", { when: aheadLabel(s.at) });
    case "manual":
      return t("routines.manual");
  }
}
