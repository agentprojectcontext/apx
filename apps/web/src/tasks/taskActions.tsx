// What can be done to a task from the list: drop it on a group, or pick an action from its right-click menu.
import type { Agent, Task, TaskColumn } from "@apx/protocol";
import { AgentAvatar, Icons, type MenuEntry } from "@apx/ui";
import { availableAgents } from "../common/pickers/agents.ts";
import { taskStateActions } from "../common/taskStateActions.tsx";
import { blobOf } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { archiveTaskChats } from "../data/taskChats.ts";
import { closeTask, updateTask } from "../data/tasks.ts";
import type { T } from "../i18n/index.ts";
import { PRIORITIES, PRIORITY_KEY, PriorityDot } from "./TaskFields.tsx";
import { type GroupId, moveTo } from "./taskGroups.ts";

/** Applies a drop on a group: its column (no longer waiting), waiting for the owner, or done. */
export async function dropOn(task: Task, group: GroupId, columns: readonly TaskColumn[]): Promise<void> {
  const move = moveTo(group, columns);
  if ("done" in move) {
    if (task.state === "open") await closeTask(task.id, "done");
    return;
  }
  // A closed task dropped on an open group opens again first.
  if (task.state !== "open") await closeTask(task.id, "open");
  if ("status" in move) {
    if (move.status !== task.status || task.awaits_owner) await updateTask(task.id, move);
  } else if (!task.awaits_owner) await updateTask(task.id, move);
}

/** Copies a task's id, or a line naming it that an agent understands, to paste in another chat. */
export function copyItems(task: Task, t: T): MenuEntry[] {
  const copy = (text: string, done: string) =>
    void navigator.clipboard.writeText(text).then(
      () => notify(done, "info"),
      () => {},
    );
  return [
    { label: t("tasks.menu.copyId"), icon: <Icons.Hash />, onSelect: () => copy(task.id, t("tasks.copiedId")) },
    {
      label: t("tasks.menu.copyRef"),
      icon: <Icons.Copy />,
      onSelect: () => copy(t("tasks.ref", { title: task.title, id: task.id }), t("tasks.copiedRef")),
    },
  ];
}

/** The right-click menu of a task: open it, copy it, move, prioritize, assign, wait for the owner, close, delete (it asks). */
export function taskMenu(
  task: Task,
  o: {
    t: T;
    columns: readonly TaskColumn[];
    agents: Agent[];
    archived: boolean;
    onOpen: () => void;
    onDelete: () => void;
  },
): MenuEntry[] {
  const { t } = o;
  return [
    { label: t("tasks.menu.open"), icon: <Icons.PanelRight />, onSelect: o.onOpen },
    ...copyItems(task, t),
    { type: "separator" },
    ...taskStateActions(task, o.columns, t),
    {
      type: "submenu",
      label: t("tasks.priority"),
      icon: <PriorityDot priority={task.priority} />,
      items: PRIORITIES.map((p) => ({
        label: t(PRIORITY_KEY[p]),
        icon: <PriorityDot priority={p} />,
        checked: p === task.priority,
        onSelect: () => void updateTask(task.id, { priority: p }),
      })),
    },
    {
      type: "submenu",
      label: t("tasks.assignee"),
      icon: <Icons.UserRound />,
      items: [
        {
          label: t("tasks.nobody"),
          checked: !task.assignee,
          onSelect: () => void updateTask(task.id, { assignee: null }),
        },
        { type: "separator" },
        ...availableAgents(o.agents, task.project_id, false, task.project_id ? "secretary" : "all").map((a) => ({
          label: a.name,
          icon: <AgentAvatar name={a.name} blob={blobOf(a)} size={14} animated={false} />,
          checked: a.id === task.assignee,
          onSelect: () => void updateTask(task.id, { assignee: a.id }),
        })),
      ],
    },
    { type: "separator" },
    {
      label: t(o.archived ? "tasks.chats.unarchive" : "tasks.chats.archive"),
      icon: o.archived ? <Icons.ArchiveRestore /> : <Icons.Archive />,
      onSelect: () => void archiveTaskChats(task.id, !o.archived),
    },
    { label: t("tasks.delete"), icon: <Icons.Trash2 />, danger: true, onSelect: o.onDelete },
  ];
}
