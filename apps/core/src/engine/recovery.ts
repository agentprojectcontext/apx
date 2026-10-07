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
  const handled = new Set<string>();
  for (const c of last?.tool_calls ?? []) {
    handled.add(c.id);
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
  // External harnesses keep their own transcript: their started steps have no call in our log, so they are named
  // in the note instead.
  const loose: string[] = [];
  for (const st of steps.values()) {
    if (st.state !== "running" || handled.has(st.call_id)) continue;
    const unknown = st.effect !== "none";
    store.runs.endStep(run.id, st.call_id, unknown ? "unknown" : "skipped", unknown ? UNKNOWN(st.tool) : NOT_RUN);
    if (unknown) loose.push(st.tool);
  }
  const note = loose.length
    ? `${why} These tools had started and may have acted (effect UNKNOWN): ${loose.join(", ")}.`
    : why;
  store.modelLog.append(run.thread_id, run.id, [...fill, systemNote(note)]);
}

/** What the model reads when its cut-off turn is picked back up. */
export const RESUME_NOTE =
  "APX restarted while you were working on this, and your turn was cut off. Carry on from where it stopped and finish the task. Tools marked effect UNKNOWN may have acted: check before running them again.";

/**
 * A turn cut off mid-work is picked up once more: a restart is not the agent failing. A turn waiting on the owner
 * gets their answer as a new input instead, and a turn that was itself a resume ends here, so a crash loop stops.
 * See DECISIONS.md#d-052
 */
const resumable = (store: Store, run: RunRecord) =>
  run.state === "working" &&
  Boolean(run.input) &&
  !run.input?.resume_of &&
  Boolean(store.threads.get(run.thread_id)) &&
  Boolean(store.agents.get(run.agent_id));

/** Delegations of this run still going: their results come back as new turns, so they must not be asked again. */
function stillDelegated(store: Store, run: RunRecord): string {
  const names = store.runs
    .children(run.id)
    .filter((c) => c.state === "submitted" || c.state === "working")
    .map((c) => store.threads.context(c.thread_id).worker?.name ?? store.agents.get(c.agent_id)?.name ?? c.agent_id);
  return names.length
    ? ` Tasks you delegated to ${names.join(", ")} are still going: their results come back in a new turn, do not delegate them again.`
    : "";
}

/**
 * Runs a crash or restart left mid-turn: closed as failed, with their cards settled. Each comes back with whether
 * the engine should run it once more (see `resumable`).
 */
export function recoverInterrupted(store: Store): { run: RunRecord; resume: boolean }[] {
  const out: { run: RunRecord; resume: boolean }[] = [];
  for (const run of store.runs.interrupted()) {
    const resume = resumable(store, run);
    const text = resume ? "Interrupted by a restart of APX; picking it back up." : "Interrupted by a restart of APX.";
    closeTurnLog(store, run, `This turn was interrupted by a restart of APX.${stillDelegated(store, run)}`);
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    if (msg) {
      const parts: Part[] = msg.parts.map((p) =>
        p.type === "tool" && p.status === "running" ? { ...p, status: "error", detail: "interrupted by a restart" } : p,
      );
      parts.push({ type: "notice", level: "warn", code: resume ? "run.resumed" : "run.interrupted", text });
      store.messages.update({ ...msg, parts });
    }
    out.push({ run: store.runs.setState(run, "failed", "interrupted by a restart"), resume });
    if (!resume && store.threads.get(run.thread_id)?.state !== "idle")
      store.threads.patch(run.thread_id, { state: "failed", preview: text });
  }
  return out;
}
