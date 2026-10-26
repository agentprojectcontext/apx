import type { Result } from "@apx/protocol";
import type { T } from "../i18n/index.ts";

type Window = Result<"engines.usage">["engines"][number]["windows"][number];

export function windowLabel(window: Window, t: T): string {
  const minutes = window.window_minutes;
  if (minutes === 300) return t("engineUsage.fiveHours");
  if (minutes === 10080) return t("engineUsage.weekly");
  return minutes
    ? t("engineUsage.window", { minutes })
    : t(window.id === "primary" ? "engineUsage.primary" : "engineUsage.secondary");
}
