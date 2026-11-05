import type { Result } from "@apx/protocol";
import type { T } from "../i18n/index.ts";

type Report = Result<"engines.usage">;
type Engine = Report["engines"][number];
type Window = Engine["windows"][number];

const DAY = 86_400_000;

export function windowLabel(window: Window, t: T): string {
  const minutes = window.window_minutes;
  if (minutes === 300) return t("engineUsage.fiveHours");
  if (minutes === 10080) return t("engineUsage.weekly");
  return minutes
    ? t("engineUsage.window", { minutes })
    : t(window.id === "primary" ? "engineUsage.primary" : "engineUsage.secondary");
}

export const remainingPercent = (window: Window) => Math.round(100 - Math.max(0, Math.min(100, window.used_percent)));

/** The window closest to its limit: the one that stops the agent first. */
export function tightestWindow(windows: readonly Window[]): Window | undefined {
  return windows.reduce<Window | undefined>(
    (best, next) =>
      Number.isFinite(next.used_percent) && (!best || next.used_percent > best.used_percent) ? next : best,
    undefined,
  );
}

/** One entry per usable engine, showing its tightest window; absent quotas never become a balance. */
export function quickWindows(report: Report | undefined) {
  return (report?.engines ?? [])
    .flatMap((engine) => {
      if (!engine.available || engine.status !== "ok") return [];
      const window = tightestWindow(engine.windows);
      return window ? [{ engine, window, remaining: remainingPercent(window) }] : [];
    })
    .slice(0, 4);
}

/** "in 2 h 10 min" within a day, otherwise the weekday and time ("on Monday 09:00"). */
export function resetLabel(resetsAt: string, now: Date, locale: string, t: T): string {
  const ms = new Date(resetsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < DAY) {
    const total = Math.max(1, Math.ceil(ms / 60_000));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    const span = hours ? (minutes ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`;
    return t("engineUsage.resetsIn", { span });
  }
  const at = new Date(resetsAt);
  const day = at.toLocaleDateString(locale, ms < 7 * DAY ? { weekday: "long" } : { month: "short", day: "numeric" });
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  return t("engineUsage.resetsOn", { at: `${day} ${time}` });
}

/** Hover text: every window of every usable engine, with its share left and when it resets. */
export function usageLines(report: Report | undefined, now: Date, locale: string, t: T): string[] {
  return (report?.engines ?? []).flatMap((engine) => {
    if (!engine.available || engine.status !== "ok") return [];
    return engine.windows.map((window) => {
      const parts = [
        `${engine.label} · ${windowLabel(window, t)}`,
        t("engineUsage.remaining", { pct: remainingPercent(window) }),
      ];
      if (window.resets_at) parts.push(resetLabel(window.resets_at, now, locale, t));
      return parts.join(" · ");
    });
  });
}
