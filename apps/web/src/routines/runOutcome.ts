import type { Message, Routine, RoutineRun } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";
import { barOf } from "./ActivationBars.tsx";

export type OutcomeTone = "ran" | "told" | "skipped" | "failed" | "live";
export type OutcomeMark = { key: MessageKey; tone: OutcomeTone };

/** How a run ended, as the marks the run's divider shows: the same meanings and colours as the activation bars. */
export function outcomeMarks(run: RoutineRun, action: Routine["action"]): OutcomeMark[] {
  switch (barOf(run, action)) {
    case "is-told":
      return [
        { key: "routines.legend.ran", tone: "ran" },
        { key: "routines.legend.told", tone: "told" },
      ];
    case "is-ran":
      return [{ key: "routines.legend.ran", tone: "ran" }];
    case "is-skipped":
      return [{ key: "routines.legend.skipped", tone: "skipped" }];
    case "is-failed":
      return [{ key: "routines.legend.failed", tone: "failed" }];
    case "is-live":
      return [{ key: "routines.running", tone: "live" }];
  }
}

/** The tone of a run's mark in the timeline: told outranks ran. */
export const toneOf = (run: RoutineRun, action: Routine["action"]): OutcomeTone =>
  outcomeMarks(run, action).at(-1)?.tone ?? "ran";

/** The instructions a run started from: its thread's first message, the owner's prompt as it was then. */
export function promptOf(messages: readonly Message[] | undefined): string | undefined {
  const first = messages?.find((m) => m.author.kind === "user");
  if (!first) return undefined;
  return first.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
}
