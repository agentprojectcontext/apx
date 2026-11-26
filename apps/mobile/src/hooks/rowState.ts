import { textOrder } from "../format.ts";
import type { Key } from "../i18n/index.ts";
import type { ColorKey } from "../ui/theme.ts";
import { isWorking } from "./chatSelectors.ts";
import { type InboxNode, nodeFailed, nodeThreads } from "./inboxTree.ts";
import type { Task } from "./useWorkspace";

/** Where a task or a routine stands, as the panel's Inbox shows it: what its runs did, or the task's place. */
export function rowState(
  kind: "task" | "routine",
  at: { task?: Task | undefined; busy: boolean; waiting: boolean; failed: boolean },
): { label: Key; color: ColorKey } {
  if (kind === "routine") {
    if (at.busy) return { label: "stateRunning", color: "info" };
    return at.failed ? { label: "inboxFailed", color: "danger" } : { label: "stateDone", color: "brand" };
  }
  if (at.task?.state === "dropped") return { label: "stateDropped", color: "danger" };
  if (at.task && at.task.state !== "open") return { label: "stateDone", color: "brand" };
  if (at.waiting || at.task?.awaits_owner) return { label: "waitsForYou", color: "warning" };
  if (at.busy || at.task?.status === "doing") return { label: "stateRunning", color: "info" };
  if (at.failed) return { label: "inboxFailed", color: "danger" };
  return { label: "statePending", color: "fgSubtle" };
}

/** A task row's state from its chats and the task itself. */
export function taskRowState(node: InboxNode, tasks: readonly Task[]): ReturnType<typeof rowState> {
  const threads = nodeThreads(node);
  return rowState("task", {
    task: tasks.find((task) => task.id === node.ref),
    busy: threads.some((thread) => isWorking(thread.state)),
    waiting: threads.some((thread) => thread.state === "input-required"),
    failed: nodeFailed(node),
  });
}

/** What needs the owner first: waiting on them, failed, running, pending; then dropped, and done last. */
const ATTENTION: readonly Key[] = [
  "waitsForYou",
  "inboxFailed",
  "stateRunning",
  "statePending",
  "stateDropped",
  "stateDone",
];

/** Task rows by what needs attention, the latest first inside each state. */
export function byAttention(nodes: readonly InboxNode[], tasks: readonly Task[]): InboxNode[] {
  const rank = new Map(nodes.map((node) => [node.key, ATTENTION.indexOf(taskRowState(node, tasks).label)]));
  return [...nodes].sort(
    (a, b) =>
      (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0) ||
      textOrder(b.thread.updated_at, a.thread.updated_at) ||
      textOrder(a.key, b.key),
  );
}
