const time = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" });
const weekday = new Intl.DateTimeFormat("es", { weekday: "short" });

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** List timestamp: "14:18" today, "Ayer", "lun" this week, else "3 sept". */
export function shortWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days <= 0) return time.format(d);
  if (days === 1) return "Ayer";
  if (days < 7) return weekday.format(d);
  return date.format(d);
}

/** Day divider label: "Hoy · 14:18", "Ayer", "3 sept". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days <= 0) return `Hoy · ${time.format(d)}`;
  if (days === 1) return `Ayer · ${time.format(d)}`;
  return `${date.format(d)} · ${time.format(d)}`;
}

export function sameDay(a: string, b: string): boolean {
  return dayStart(new Date(a)) === dayStart(new Date(b));
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
