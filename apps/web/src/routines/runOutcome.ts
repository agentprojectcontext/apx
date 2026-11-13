import type { Message, Routine, RoutineRun } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";

/** An agent answers (agent), watches (watch) or tells the team news (relay): each has one and can spare a model call. */
export const hasAgent = (a: Routine["action"]) => a === "agent" || a === "watch" || a === "relay";

/** How one activation ended: it failed, is still running, was skipped (no tokens spent), told the owner, or ran. */
export const barOf = (x: RoutineRun, action: Routine["action"]) => {
  if (x.state === "failed") return "is-failed";
  if (x.state !== "completed" && x.state !== "canceled") return "is-live";
  // A message or a shell job never calls a model: it ran when it sent or ran its command.
  const skipped = hasAgent(action) ? x.model_called === false : action === "message" && !x.delivered;
  if (skipped) return "is-skipped";
  return x.delivered ? "is-told" : "is-ran";
};

export type OutcomeTone = "ran" | "told" | "skipped" | "failed" | "live";
/**
 * One mark on a run's line. `quiet`: nothing worth telling, drawn as the shared skip badge. `reason`: why it failed,
 * short, with `detail` the whole sentence.
 */
export type OutcomeMark = {
  key: MessageKey;
  tone: OutcomeTone;
  quiet?: true;
  reason?: MessageKey;
  detail?: MessageKey;
};

const QUIET: OutcomeMark = { key: "quiet.label", tone: "skipped", quiet: true };

/** How a run ended, as the marks the run's divider shows: the same meanings and colours as the activation bars. */
export function outcomeMarks(run: RoutineRun, action: Routine["action"]): OutcomeMark[] {
  switch (barOf(run, action)) {
    case "is-told":
      return [
        { key: "routines.legend.ran", tone: "ran" },
        { key: "routines.legend.told", tone: "told" },
      ];
    case "is-ran":
      // The agent ran and answered SKIP: nothing worth telling this time (its dot keeps the colour of a run).
      return run.state === "completed" && run.delivered === false && hasAgent(action)
        ? [{ ...QUIET, tone: "ran" }]
        : [{ key: "routines.legend.ran", tone: "ran" }];
    case "is-skipped":
      return [QUIET];
    case "is-failed": {
      const why = run.failure && run.failure !== "other" ? run.failure : undefined;
      return [
        {
          key: "routines.legend.failed",
          tone: "failed",
          ...(why
            ? { reason: `routineChat.failure.${why}` as const, detail: `notice.run.failed.${why}` as const }
            : {}),
        },
      ];
    }
    case "is-live":
      return [{ key: "routines.running", tone: "live" }];
  }
}

/** A mark in words, for a tooltip or a list: "Failed · No connection". */
export const markText = (m: OutcomeMark, t: (k: MessageKey) => string) =>
  m.reason ? `${t(m.key)} · ${t(m.reason)}` : t(m.key);

/** The tone of a run's mark in the timeline: told outranks ran. */
export const toneOf = (run: RoutineRun, action: Routine["action"]): OutcomeTone =>
  outcomeMarks(run, action).at(-1)?.tone ?? "ran";

/** The instructions a run started from: its thread's first message, the owner's prompt as it was then. */
export function promptOf(messages: readonly Message[] | undefined): string | undefined {
  const first = messages?.find((m) => m.author.kind === "user");
  if (!first) return undefined;
  return first.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
}
