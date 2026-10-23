// How a finished turn went, for whoever reads its result (its caller, the owner's tray): done, done with something
// to check, or not done. A completed run is not a good one when it said nothing or some of its actions failed.
import type { Part } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";

export type Outcome =
  | { level: "ok" }
  | { level: "warn" | "error"; issue: "failed" | "canceled" | "no_answer" | "actions_failed"; why: string };

/** The run's answer: the last text it wrote, or undefined when it wrote none. */
export function answerOf(store: Store, run: RunRecord): string | undefined {
  const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
  const text = msg?.parts.findLast((p): p is Extract<Part, { type: "text" }> => p.type === "text")?.text;
  return text?.trim() ? text : undefined;
}

/** `actions` as `actionsOf` gives them ("shell ok ×3", "browser_type error"). A limit cutting it short is `endNote`'s. */
export function outcomeOf(
  run: Pick<RunRecord, "state" | "error">,
  answered: boolean,
  actions: readonly string[] = [],
): Outcome {
  if (run.state === "failed") return { level: "error", issue: "failed", why: run.error ?? "it failed" };
  if (run.state === "canceled") return { level: "warn", issue: "canceled", why: "it was canceled" };
  if (!answered) return { level: "warn", issue: "no_answer", why: "it ended without an answer" };
  const failed = actions.filter((a) => / (error|unknown)( ×\d+)?$/.test(a));
  if (failed.length)
    return { level: "warn", issue: "actions_failed", why: `some actions failed: ${failed.join(", ")}` };
  return { level: "ok" };
}

/** Said to a caller beside a result that did not go well, so it never tells the owner the work is done unchecked. */
export const outcomeNote = (o: { level: Outcome["level"]; why?: string }): string =>
  o.level === "ok"
    ? ""
    : `APX marks this result as ${o.level === "error" ? "an error" : "a warning"}: ${o.why}. Check what did not work or is unverified, and tell the owner plainly; never report it as done without checking.\n`;

/** A completed turn that wrote nothing and ran no tool. */
export const silent = (store: Store, run: RunRecord): boolean =>
  run.state === "completed" && !answerOf(store, run) && store.runs.steps(run.id).length === 0;

/** A turn that should act on a result (a delegate's, a closed task's) but stayed silent. */
export function droppedResult(store: Store, run: RunRecord): boolean {
  const kind = run.input?.origin.kind;
  return (kind === "delegation_result" || kind === "task_result") && silent(store, run);
}
