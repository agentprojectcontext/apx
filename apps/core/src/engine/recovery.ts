// Ending a turn honestly, also when the process died in the middle of it. The model log of an interrupted turn is
// closed so the next turn sees what may have happened; the owner's view loses its spinners.
import type { Part } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { systemNote } from "../harness/native.ts";
import type { AssistantItem, ChatItem } from "../providers/types.ts";

const UNKNOWN = (tool: string) =>
  `effect UNKNOWN: ${tool} started but the turn stopped before it reported back. Check the result before trying it again.`;
const NOT_RUN = "not run: the turn was interrupted";

/**
 * Gives every tool call of the run's last model step a result (from its step record when it finished, "effect
 * unknown" when it started and may have acted, "not run" otherwise) and adds a note saying why the turn ended.
 */
export function closeTurnLog(store: Store, run: RunRecord, why: string): void {
  const items = store.modelLog.forRun(run.id) as ChatItem[];
  const steps = new Map(store.runs.steps(run.id).map((s) => [s.call_id, s]));
  const answered = new Set(items.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : [])));
  const last = [...items].reverse().find((m): m is AssistantItem => m.role === "assistant");
  const fill: ChatItem[] = [];
  for (const c of last?.tool_calls ?? []) {
    if (answered.has(c.id)) continue;
    const s = steps.get(c.id);
    let content = NOT_RUN;
    if (s?.state === "ok" || s?.state === "error") content = s.result ?? "(no output)";
    else if (s?.state === "running") {
      const unknown = s.effect !== "none";
      content = unknown ? UNKNOWN(s.tool) : NOT_RUN;
      store.runs.endStep(run.id, c.id, unknown ? "unknown" : "skipped", content);
    }
    fill.push({ role: "tool", tool_call_id: c.id, content });
  }
  store.modelLog.append(run.thread_id, run.id, [...fill, systemNote(why)]);
}

/** Runs a crash or restart left mid-turn: closed as failed, with their cards settled. Returns them. */
export function recoverInterrupted(store: Store): RunRecord[] {
  const out: RunRecord[] = [];
  for (const run of store.runs.interrupted()) {
    closeTurnLog(store, run, "This turn was interrupted by a restart of APX.");
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    if (msg) {
      const parts: Part[] = msg.parts.map((p) =>
        p.type === "tool" && p.status === "running" ? { ...p, status: "error", detail: "interrupted by a restart" } : p,
      );
      parts.push({ type: "notice", level: "warn", code: "run.interrupted", text: "Interrupted by a restart of APX." });
      store.messages.update({ ...msg, parts });
    }
    out.push(store.runs.setState(run, "failed", "interrupted by a restart"));
    if (store.threads.get(run.thread_id)?.state !== "idle")
      store.threads.patch(run.thread_id, { state: "failed", preview: "Interrupted by a restart of APX." });
  }
  return out;
}
