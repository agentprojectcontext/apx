import type { Task } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { conflict } from "../errors.ts";
import { untrusted } from "../tools/result.ts";
import type { Asker } from "./task-work.ts";

export function handedOff(store: Store, run: Pick<RunRecord, "id" | "thread_id">): string | undefined {
  const handoff = store.threads.context(run.thread_id).task_handoff;
  if (!handoff) return undefined;
  const visited = new Set<string>();
  let id: string | undefined = run.id;
  while (id && !visited.has(id)) {
    if (id === handoff.run)
      return `Execution transferred to task ${handoff.task}. Do not run more tools or duplicate its work. End this turn with a short acknowledgment.`;
    visited.add(id);
    const previous = store.runs.get(id);
    if (previous?.thread_id !== run.thread_id) break;
    id = previous.input?.resume_of;
  }
  return undefined;
}

/** A transfer cannot strand helpers whose results still belong to the original chat. */
export function checkSelfHandoff(store: Store, asker: Asker, project: string | undefined): void {
  if (asker.kind !== "agent") return;
  const source = store.threads.get(asker.thread_id);
  const run = store.runs.get(asker.run_id);
  if (!source || !run || run.ended_at) return;
  const transferred = handedOff(store, run);
  if (transferred) throw conflict(transferred);
  if (source.project_id !== project) throw conflict("a self-handoff must stay in the current project");
  const context = store.threads.context(source.id);
  if (context.client || context.room || store.settings.read("computer_chats").includes(source.id))
    throw conflict("this chat cannot transfer execution to a separate task session; continue here");
  if (store.runs.children(run.id).length)
    throw conflict(
      "already delegated work in this turn: continue here with the existing helpers; do not create another executor",
    );
  if (
    store.runs
      .steps(run.id)
      .some((step) => step.state === "running" && !["task_create", "task_update"].includes(step.tool))
  )
    throw conflict("another tool is still running in this turn: finish it before transferring execution");
  if (store.threads.busy(store.threads.family(source.id), run.id))
    throw conflict(
      "this chat still has active helpers, jobs or queued turns: finish them here before transferring execution",
    );
}

export function markHandoff(store: Store, task: Task, asker: Asker, work: RunRecord): void {
  if (asker.kind !== "agent" || task.assignee !== asker.id) return;
  const source = store.runs.get(asker.run_id);
  if (!source || source.ended_at) return;
  store.threads.mergeContext(asker.thread_id, { task_handoff: { task: task.id, run: source.id } });
  store.threads.mergeContext(work.thread_id, { handoff_from: { thread: asker.thread_id, run: source.id } });
}

export function handoffBrief(store: Store, thread: string): string {
  const from = store.threads.context(thread).handoff_from;
  if (!from) return "";
  const source = store.threads.get(from.thread);
  const target = store.threads.get(thread);
  const run = store.runs.get(from.run);
  if (!source || !target || !run || source.project_id !== target.project_id || run.thread_id !== source.id) return "";
  const steps = store.runs.steps(run.id).filter((s) => s.state === "ok" || s.state === "error");
  return [
    `Existing work transferred from chat ${source.id}, run ${run.id}. Continue it here; the originating turn cannot execute more tools. Read the existing findings before doing research or launching helpers again.`,
    untrusted(
      "handoff_findings",
      {},
      JSON.stringify({
        request: run.input?.text.slice(0, 4000),
        steps: steps.slice(-12).map((s) => ({ tool: s.tool, state: s.state, result: s.result?.slice(0, 600) })),
      }),
    ),
  ].join("\n");
}
