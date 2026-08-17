/**
 * "in 8 hours" / "2 minutes ago".
 *
 * A status row showing two absolute timestamps makes the reader do the
 * arithmetic that the row exists to save them. The absolute value stays
 * available as a tooltip for when the exact minute is what matters.
 */
type T = (key: string, vars?: Record<string, string | number>) => string;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeWhen(iso: string, t: T, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diff = ms - now;
  const ahead = diff >= 0;
  const abs = Math.abs(diff);

  // Under a minute reads as "now" in both directions: "in 34 seconds" is
  // precision nobody acts on.
  if (abs < MINUTE) return t("when.now");

  const [n, unit] =
    abs < HOUR ? [Math.round(abs / MINUTE), "minutes"] :
    abs < DAY ? [Math.round(abs / HOUR), "hours"] :
    [Math.round(abs / DAY), "days"];

  const amount = t(`when.${unit}`, { n });
  return ahead ? t("when.in", { amount }) : t("when.ago", { amount });
}
