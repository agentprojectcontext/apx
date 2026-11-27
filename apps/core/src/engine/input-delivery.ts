import type { InputRecord } from "../domain/inputs.ts";
import type { Store } from "../domain/store.ts";
import { finishTaskInput, taskInputIsCurrent } from "../domain/task-input-wait.ts";
import type { AdmitFn } from "./engine.ts";

/** A write-folder consent must never double as a read-folder consent. */
export const folderBinding = (folders: string[], write = false) =>
  `${write ? "write-folders" : "folders"}:${folders.join("\n")}`;

export function createInputDelivery(o: {
  store: Store;
  admit: AdmitFn;
  /** The turns listening for an answer; `held` tells one its answer waits on another of the task's waits. */
  waiting: Map<string, (r: InputRecord, held?: boolean) => void>;
  settleCard: (r: InputRecord) => void;
}) {
  const { store, waiting, settleCard } = o;

  function answerText(r: InputRecord): string {
    settleCard(r);
    const note = r.answer ? ` Their note: ${r.answer}` : "";
    if (r.kind === "question") return `You asked the owner: "${r.prompt}". Their answer: ${r.answer ?? "(empty)"}`;
    if (!r.tool && !r.folders)
      return r.state === "approved"
        ? `The owner accepted the action you proposed: "${r.prompt}". Do it now, as proposed.${note}`
        : `The owner declined the action you proposed: "${r.prompt}". Do not do it.${note}`;
    if (r.state !== "approved")
      return `The owner declined ${r.tool} (${r.detail ?? r.prompt}). Do not try it again.${note}`;
    const binding = r.approval?.key ?? (r.folders ? folderBinding(r.folders, r.folders_write) : undefined);
    if (r.tool && (!r.approval_scope || r.approval_scope === "once"))
      store.approvals.grantOnce(r.thread_id, r.agent_id, r.tool, r.args ?? {}, binding, r.approval?.server);
    const what = r.folders
      ? `let you ${r.folders_write ? "change files in" : "read"} ${r.folders.join(", ")}${r.approval_scope === "project" ? " in this project from now on" : r.approval_scope === "always" ? " from now on" : " for that call"}`
      : `approved ${r.tool} (${r.detail ?? r.prompt})`;
    return `The owner ${what}, but your earlier turn had already ended, so it did not run. If it is still needed, call it again with the same arguments: it will run without asking.${note}`;
  }

  function wake(records: InputRecord[]): void {
    const r = records.at(-1);
    if (!r) return;
    const text = records.map(answerText).join("\n\n");
    const previous = store.runs.get(r.run_id);
    o.admit({
      thread_id: r.thread_id,
      agent_id: r.agent_id,
      trigger: "user",
      origin: { kind: "input_answer", input_id: r.id },
      text,
      reply_to: previous?.input?.reply_to,
      parent_run_id: previous?.parent_run_id,
      depth: previous?.depth ?? 0,
    });
  }

  function releaseTask(taskId: string): number {
    return store.tx(() => {
      const task = store.tasks.get(taskId);
      if (task?.state !== "open" || task.awaits_owner || task.proposed) return 0;
      let delivered = 0;
      for (const thread of store.threads.byTask(taskId)) {
        const bindings = store.threads.context(thread.id).task_inputs ?? {};
        const records: InputRecord[] = [];
        for (const id of Object.keys(bindings)) {
          const r = store.inputs.get(id);
          if (!r || r.state === "pending") continue;
          if (
            !taskInputIsCurrent(store, r) ||
            (r.state !== "approved" && r.state !== "answered" && r.state !== "denied")
          ) {
            finishTaskInput(store, r);
            continue;
          }
          records.push(r);
        }
        if (!records.length) continue;
        const live = records.filter((r) => waiting.has(r.id));
        if (live.length) {
          const delivery = live[0]?.run_id;
          const ids = new Set(records.map((r) => r.id));
          store.threads.mergeContext(thread.id, {
            task_inputs: Object.fromEntries(
              Object.entries(bindings).map(([id, binding]) => [id, ids.has(id) ? { ...binding, delivery } : binding]),
            ),
          });
          const extra = records
            .filter((r) => !waiting.has(r.id))
            .map(answerText)
            .join("\n\n");
          for (const r of live) {
            settleCard(r);
            const listener = waiting.get(r.id);
            waiting.delete(r.id);
            listener?.(extra ? { ...r, answer: `${r.answer ?? ""}\n\nOther owner responses:\n${extra}` } : r);
          }
        } else {
          wake(records);
          for (const r of records) finishTaskInput(store, r);
        }
        delivered += records.length;
      }
      return delivered;
    });
  }

  function deliver(r: InputRecord): void {
    const binding = store.threads.context(r.thread_id).task_inputs?.[r.id];
    if (binding) {
      settleCard(r);
      releaseTask(binding.task);
      // Still listening: another of the task's waits holds the answer. The turn ends now instead of waiting with no
      // deadline, and the answer, kept here, wakes the agent once that wait is cleared (HISTORY.md#held-task-answer).
      waiting.get(r.id)?.(r, true);
      return;
    }
    const listener = waiting.get(r.id);
    if (listener) listener(r);
    else wake([r]);
  }

  return {
    deliver,
    releaseTask,
    consumed: (thread: string, run: string) => {
      const bindings = store.threads.context(thread).task_inputs;
      if (bindings)
        store.threads.mergeContext(thread, {
          task_inputs: Object.fromEntries(Object.entries(bindings).filter(([, binding]) => binding.delivery !== run)),
        });
    },
    restore: () => {
      for (const task of store.tasks.list({ state: "open", limit: 1000, exhaustive: true })) releaseTask(task.id);
    },
  };
}
