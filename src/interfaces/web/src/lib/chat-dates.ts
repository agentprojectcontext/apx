/**
 * Which calendar day a message belongs to, and the divider that announces it.
 *
 * A thread that ran for three months used to render as one uninterrupted
 * column: every bubble carried a time, the newest one carried today's date, and
 * nothing in between said that the answer above was written in June. Reading it
 * back, the whole conversation looked like it had happened in one sitting.
 *
 * Pure on purpose — no DOM, no i18n import — so the day arithmetic (the part
 * that goes wrong quietly, at a timezone boundary or at new year) is tested
 * without rendering anything. Callers hand in `t` the way `when.ts` does.
 *
 * The two keys are spelled out rather than typed as a bare `string`, which is
 * what forces every `when.ts` caller to write `t as never`: a lookup function
 * that accepts EVERY key is assignable to one that accepts only these two.
 */
type T = (key: "chat_ui.day_today" | "chat_ui.day_yesterday") => string;

/**
 * The LOCAL calendar day of a timestamp, as `YYYY-MM-DD`. `null` for anything
 * undatable — a missing or malformed `ts` must not open a day of its own.
 *
 * Built from the local parts, never `toISOString()`: a message sent at 22:00 in
 * Buenos Aires is already tomorrow in UTC, so a UTC key would cut a new day in
 * the middle of the reader's evening — every evening.
 */
export function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Does this message open a new day in the thread?
 *
 * `prevIso` absent (the first message) counts as a change: a conversation is
 * announced by the day it started on, the way every chat app opens.
 */
export function startsNewDay(prevIso: string | null | undefined, iso: string | null | undefined): boolean {
  const key = dayKey(iso);
  if (!key) return false;
  return key !== dayKey(prevIso);
}

/** Whole days between two timestamps, counted in calendar days rather than in
 *  elapsed hours: 23:50 → 00:10 is one day apart, not zero. */
function daysBetween(iso: string, now: Date): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const then = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86_400_000);
}

/** Spanish (and most locales) return weekday and month names lowercase; a
 *  divider NAMES the day on screen, so it gets a capital (AGENTS.md rule 11a). */
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export interface DayLabelOptions {
  /** What "today" means. Injected so the tests don't depend on the clock. */
  now?: Date;
  /** BCP-47 tag for the month/weekday names. Defaults to the browser's. */
  locale?: string;
  /** Phone: drop the weekday from an older date so the pill stays one line. */
  compact?: boolean;
}

/**
 * "Hoy" · "Ayer" · "Jueves" · "4 de septiembre" · "4 de septiembre de 2026".
 *
 * The scale narrows as the date gets further away, which is how people actually
 * name days: this week by its weekday, this year by its date, anything older
 * with the year spelled out.
 */
export function dayLabel(iso: string, t: T, opts: DayLabelOptions = {}): string {
  const now = opts.now ?? new Date();
  const diff = daysBetween(iso, now);
  if (diff === null) return "";
  if (diff === 0) return t("chat_ui.day_today");
  if (diff === 1) return t("chat_ui.day_yesterday");

  const d = new Date(iso);
  const locale = opts.locale || undefined;
  // Inside the last week the weekday alone is enough, and reads faster than a
  // date does ("Jueves" vs "4 de septiembre" for something three days old).
  if (diff >= 2 && diff <= 6) {
    return capitalize(d.toLocaleDateString(locale, { weekday: "long" }));
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return capitalize(
    d.toLocaleDateString(locale, {
      // The weekday is the first thing to go where there is no room for it.
      ...(sameYear && !opts.compact ? { weekday: "long" } : {}),
      day: "numeric",
      month: "long",
      ...(sameYear ? {} : { year: "numeric" }),
    }),
  );
}
