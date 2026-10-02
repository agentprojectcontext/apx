import { currentLocale, t } from "../i18n/index.ts";

type Formatters = { time: Intl.DateTimeFormat; date: Intl.DateTimeFormat; weekday: Intl.DateTimeFormat };
const cache = new Map<string, Formatters>();

/** Date formatters for the current language, built once per locale. */
function fmt(): Formatters {
  const locale = currentLocale();
  let f = cache.get(locale);
  if (!f) {
    f = {
      // es-AR defaults to "11:14 a. m."; Argentina reads clocks as 24 h.
      time: new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: locale.startsWith("es") ? "h23" : undefined,
      }),
      date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }),
    };
    cache.set(locale, f);
  }
  return f;
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** List timestamp: "14:18" today, "Yesterday", "Mon" this week, else "Sep 3". */
export function shortWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  const f = fmt();
  if (days <= 0) return f.time.format(d);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return f.weekday.format(d);
  return f.date.format(d);
}

/** Day divider label: "Today · 14:18", "Yesterday · 09:02", "Sep 3 · 10:00". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  const f = fmt();
  const time = f.time.format(d);
  if (days <= 0) return t("time.todayAt", { time });
  if (days === 1) return t("time.yesterdayAt", { time });
  return `${f.date.format(d)} · ${time}`;
}

export function sameDay(a: string, b: string): boolean {
  return dayStart(new Date(a)) === dayStart(new Date(b));
}

/** A number in the current language ("12,345" / "12.345"). */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(currentLocale(), opts);
}

/** Seconds with one decimal: "3.4 s" / "3,4 s". */
export function formatSeconds(s: number): string {
  return `${formatNumber(s, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

/** "github.com/login" from a URL, for compact display. */
export function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/** Time since `iso`: "12 s", "13 min", "1 h 17". */
export function elapsed(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")}`;
}

/** A moment ahead: "Today · 08:30", "Tomorrow · 08:30", "Mon · 08:30", else "Sep 3 · 08:30". */
export function aheadLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((dayStart(d) - dayStart(now)) / 86_400_000);
  const f = fmt();
  const time = f.time.format(d);
  if (days <= 0) return t("time.todayAt", { time });
  if (days === 1) return t("time.tomorrowAt", { time });
  if (days < 7) return `${f.weekday.format(d)} · ${time}`;
  return `${f.date.format(d)} · ${time}`;
}

/**
 * A due date for lists: "Today 18:00", "Tomorrow", "Fri" this week, else "Oct 9". A bare day (09:00 local, how
 * a date without a time is stored) shows no time. `late` says it is already past.
 */
export function dueLabel(iso: string, now = new Date()): { text: string; late: boolean } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: "", late: false };
  const f = fmt();
  const days = Math.round((dayStart(d) - dayStart(now)) / 86_400_000);
  const bare = d.getHours() === 9 && d.getMinutes() === 0;
  // A bare date (no time picked) is due all that day: late only from the next one.
  const late = bare ? days < 0 : d.getTime() < now.getTime();
  if (days === 0) return { text: bare ? t("time.today") : t("time.todayTime", { time: f.time.format(d) }), late };
  if (days === 1) return { text: t("time.tomorrow"), late };
  if (days > 1 && days < 7) return { text: f.weekday.format(d), late };
  return { text: f.date.format(d), late };
}
