import type { Task, TaskColumn } from "@apx/protocol";
import { Icons, type MenuEntry } from "@apx/ui";
import { closeTask, updateTask } from "../data/tasks.ts";
import type { T } from "../i18n/index.ts";
import { columnLabel } from "./taskStatus.ts";

/** Shared state transitions for the board and the task's chat group. */
export function taskStateActions(task: Task, columns: readonly TaskColumn[], t: T): MenuEntry[] {
  const open = task.state === "open";
  return [
    {
      type: "submenu",
      label: t("tasks.menu.move"),
      icon: <Icons.ArrowRightLeft />,
      disabled: !open,
      items: columns.map((c) => ({
        label: columnLabel(c, t),
        checked: c.id === task.status,
        onSelect: () => void updateTask(task.id, { status: c.id, awaits_owner: false }),
      })),
    },
    {
      label: t(task.awaits_owner ? "tasks.menu.unblock" : "tasks.menu.block"),
      icon: <Icons.Hand />,
      disabled: !open,
      onSelect: () => void updateTask(task.id, { awaits_owner: !task.awaits_owner }),
    },
    { type: "separator" },
    open
      ? { label: t("tasks.markDone"), icon: <Icons.Check />, onSelect: () => void closeTask(task.id, "done") }
      : { label: t("tasks.reopen"), icon: <Icons.RotateCcw />, onSelect: () => void closeTask(task.id, "open") },
    ...(open
      ? [
          {
            label: t("tasks.drop"),
            icon: <Icons.X />,
            danger: true,
            onSelect: () => void closeTask(task.id, "dropped"),
          },
        ]
      : []),
  ];
}
