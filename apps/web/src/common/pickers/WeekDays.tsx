// The days of a week as a row of chips, Monday first: a routine's days, a channel's attention hours.
import { type MessageKey, useT } from "../../i18n/index.ts";
import { DAY_KEY, WEEK } from "../week.ts";

/** Ticks days on and off; the last one ticked stays (a week with no day means nothing). */
export function WeekDays({ days, label, onChange }: { days: number[]; label: string; onChange(days: number[]): void }) {
  const t = useT();
  return (
    <fieldset className="weekdays">
      <legend className="sr-only">{label}</legend>
      {WEEK.map((d) => {
        const on = days.includes(d);
        return (
          <label key={d} className={on ? "weekdays__day is-on" : "weekdays__day"}>
            <input
              type="checkbox"
              checked={on}
              onChange={() => {
                const next = on ? days.filter((x) => x !== d) : [...days, d];
                if (next.length) onChange(WEEK.filter((x) => next.includes(x)));
              }}
            />
            {t(DAY_KEY[d] as MessageKey)}
          </label>
        );
      })}
    </fieldset>
  );
}
