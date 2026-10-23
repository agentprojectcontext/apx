import type { RoutineRun, Schedule } from "../../../../packages/protocol/src/index.ts";
import { ago, ahead } from "../format.ts";
import { type Key, type Lang, lang, translator } from "../i18n/index.ts";
import { weeklyOf } from "./cron.ts";

type Action = "agent" | "message" | "shell" | "watch" | "mail";
type RoutineLike = {
  enabled: boolean;
  action: string;
  schedule: Schedule;
  pre_command?: string;
  post_command?: string;
  next_run_at?: string;
};

const DAY_KEYS: Key[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const UNITS: Array<[number, Key, Key]> = [
  [7 * 1440, "rtWeek", "rtWeeks"],
  [1440, "rtDay", "rtDays"],
  [60, "rtHour", "rtHours"],
  [1, "rtMinute", "rtMinutes"],
];

/** "Every 30 minutes", "Weekdays at 08:30", "Once, tomorrow 09:00", "By hand" — as the panel says it. */
export function scheduleText(s: Schedule, language: Lang = lang, now = new Date()): string {
  const tr = translator(language);
  switch (s.kind) {
    case "every": {
      const [size, one, many] = UNITS.find(([size]) => s.minutes % size === 0) ??
        UNITS[3] ?? [1, "rtMinute", "rtMinutes"];
      const n = s.minutes / size;
      return n === 1 ? tr("rtEveryOne", { unit: tr(one) }) : tr("rtEvery", { n, unit: tr(many) });
    }
    case "cron": {
      const w = weeklyOf(s.cron);
      if (!w) return tr("rtCron", { cron: s.cron });
      const key = w.days.join(",");
      const days =
        w.days.length === 7
          ? tr("rtEveryDay")
          : key === "1,2,3,4,5"
            ? tr("rtWeekdays")
            : key === "6,0"
              ? tr("rtWeekends")
              : w.days.map((d) => tr(DAY_KEYS[d] ?? "sun")).join(", ");
      return tr("rtAtTime", { days, time: w.time });
    }
    case "once":
      return tr("rtOnce", { when: ahead(s.at, now, language) });
    default:
      return tr("rtManual");
  }
}

/** What a routine does, step by step: "Pre-command → Roby → Post-command". */
export function flowText(r: RoutineLike, agentName: string, language: Lang = lang): string {
  const tr = translator(language);
  const action = r.action as Action;
  return [
    r.pre_command && (action === "shell" ? tr("rtCommand") : tr("rtPre")),
    action === "agent"
      ? agentName
      : action === "watch"
        ? tr("rtWatch", { agent: agentName })
        : action === "mail"
          ? tr("rtMail", { agent: agentName })
          : action === "message"
            ? tr("rtMessage")
            : undefined,
    r.post_command && tr("rtPost"),
  ]
    .filter(Boolean)
    .join(" → ");
}

/** How one run ended, for its bar and its label (the panel's legend). */
export function runOutcome(run: RoutineRun, action: string): "failed" | "live" | "skipped" | "told" | "ran" {
  if (run.state === "failed") return "failed";
  if (run.state !== "completed" && run.state !== "canceled") return "live";
  const usesAgent = action === "agent" || action === "watch" || action === "mail";
  const skipped = usesAgent ? run.model_called === false : action === "message" && !run.delivered;
  if (skipped) return "skipped";
  return run.delivered ? "told" : "ran";
}

/** Runs that failed one after another, newest first, until one did not. */
export function failStreak(runs: RoutineRun[]): number {
  const i = runs.findIndex((run) => run.state !== "failed");
  return i < 0 ? runs.length : i;
}

/** The line under a routine's bars, and whether it reads as a problem. */
export function routineStatus(
  r: RoutineLike,
  runs: RoutineRun[],
  now = new Date(),
  language: Lang = lang,
): { text: string; bad: boolean } {
  const tr = translator(language);
  if (!r.enabled) return { text: tr("rtOff"), bad: false };
  const latest = runs[0];
  if (latest && runOutcome(latest, r.action) === "live") return { text: tr("rtRunning"), bad: false };
  const streak = failStreak(runs);
  if (streak >= 2) return { text: tr("rtFailedTimes", { n: streak }), bad: true };
  // Mid-sentence: "Next today 18:30", not "Next Today 18:30".
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  const next = r.next_run_at
    ? tr("rtNext", { when: lower(ahead(r.next_run_at, now, language)) })
    : r.schedule.kind === "manual"
      ? tr("rtManual")
      : tr("rtNoNext");
  const last =
    streak === 1
      ? tr("rtFailedLast").toLowerCase()
      : latest && tr("rtLast", { when: ago(latest.started_at, now, language) });
  return { text: [next, last].filter(Boolean).join(" · "), bad: streak === 1 };
}
