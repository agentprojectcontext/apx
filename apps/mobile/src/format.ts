import { type Lang, lang, translator } from "./i18n/index.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const parse = (iso?: string) => {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(at) ? undefined : new Date(at);
};
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole calendar days from `now`'s day to `at`'s day (negative: in the past). */
const dayOffset = (at: Date, now: Date) => Math.round((startOfDay(at) - startOfDay(now)) / DAY);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const locale = (language: Lang) => (language === "es" ? "es" : "en");

export function clock(iso?: string, language: Lang = lang): string {
  const at = parse(iso);
  return at ? new Intl.DateTimeFormat(locale(language), { hour: "2-digit", minute: "2-digit" }).format(at) : "";
}

/** A chat row's time: the hour today, "Yesterday", or the date ("11 sept"). */
export function listWhen(iso?: string, now = new Date(), language: Lang = lang): string {
  const at = parse(iso);
  if (!at) return "";
  const days = dayOffset(at, now);
  if (days === 0) return clock(iso, language);
  if (days === -1) return translator(language)("yesterday");
  return new Intl.DateTimeFormat(locale(language), {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(at);
}

/** When a task is due: "Today", "Today 18:00", "Tomorrow", a weekday within the week, or the date. */
export function dueWhen(iso?: string, now = new Date(), language: Lang = lang): string {
  const at = parse(iso);
  if (!at) return "—";
  const tr = translator(language);
  const days = dayOffset(at, now);
  const time = at.getHours() || at.getMinutes() ? ` ${clock(iso, language)}` : "";
  if (days === 0) return tr("today") + time;
  if (days === 1) return tr("tomorrow") + time;
  if (days === -1) return tr("yesterday");
  if (days > 1 && days < 7)
    return capital(new Intl.DateTimeFormat(locale(language), { weekday: "short" }).format(at).replace(".", ""));
  return listWhen(iso, now, language);
}

/** How long ago: "Just now", "18 min ago", "2 h ago", "3 d ago". */
export function ago(iso?: string, now = new Date(), language: Lang = lang): string {
  const at = parse(iso);
  if (!at) return "";
  const tr = translator(language);
  const ms = now.getTime() - at.getTime();
  if (ms < MINUTE) return tr("justNow");
  if (ms < HOUR) return tr("minutesAgo", { n: Math.floor(ms / MINUTE) });
  if (ms < DAY) return tr("hoursAgo", { n: Math.floor(ms / HOUR) });
  return tr("daysAgo", { n: Math.floor(ms / DAY) });
}

/** How long until: "in 12 min", "in 3 h", then "Tomorrow 08:00" or the date. */
export function ahead(iso?: string, now = new Date(), language: Lang = lang): string {
  const at = parse(iso);
  if (!at) return "";
  const tr = translator(language);
  const ms = at.getTime() - now.getTime();
  if (ms < MINUTE) return tr("inMinutes", { n: 1 });
  if (ms < HOUR) return tr("inMinutes", { n: Math.ceil(ms / MINUTE) });
  if (ms < 6 * HOUR) return tr("inHours", { n: Math.round(ms / HOUR) });
  const days = dayOffset(at, now);
  if (days === 0) return `${tr("today")} ${clock(iso, language)}`;
  if (days === 1) return `${tr("tomorrow")} ${clock(iso, language)}`;
  return `${listWhen(iso, now, language)} ${clock(iso, language)}`;
}

/** How long something has been running: "12 min", "1 h 5 min". */
export function elapsed(iso?: string, now = new Date(), language: Lang = lang): string {
  const at = parse(iso);
  if (!at) return "";
  const tr = translator(language);
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / MINUTE));
  if (minutes < 60) return tr("minutes", { n: minutes });
  return tr("hoursMinutes", { h: Math.floor(minutes / 60), m: minutes % 60 });
}
