// What a task's own runs show its assignee did, read when they close it as done: a close backed only by documents
// (a plan, decision notes) is checked once, since a task that asked for a change is not done by describing it.
import type { Task } from "@apx/protocol";
import type { Step } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";

const DOCUMENT = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
/** Tools that change the project or check it: what a code task's work goes through. */
const WORK = new Set(["file_write", "file_edit", "shell"]);

const pathOf = (s: Step) => (typeof s.args.path === "string" ? s.args.path : "");

/** The documents the task's work wrote, when that is all it changed and it ran no command; else undefined. */
export function documentsOnly(store: Store, task: Task): string[] | undefined {
  const threads = [task.thread_id, ...store.threads.byTask(task.id).map((t) => t.id)];
  const runs = [...new Set(threads)]
    .flatMap((id) => store.runs.list(id, 50))
    .filter((r) => r.agent_id === task.assignee)
    .flatMap((r) => [r, ...store.runs.children(r.id)]);
  const done = runs.flatMap((r) => store.runs.steps(r.id)).filter((s) => s.state === "ok" && s.effect !== "none");
  const work = done.filter((s) => WORK.has(s.tool) || s.tool.startsWith("external:"));
  const docs = work.filter((s) => s.tool !== "shell" && DOCUMENT.test(pathOf(s)));
  if (!docs.length || docs.length < work.length) return undefined;
  return [...new Set(docs.map(pathOf))];
}
