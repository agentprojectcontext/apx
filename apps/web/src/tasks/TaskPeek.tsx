import "../styles/screens.css";
import { IconButton, Icons } from "@apx/ui";
import { useEffect } from "react";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { go, nav, useNav } from "../shell/nav.ts";
import { TaskPanel } from "./TaskPanel.tsx";

/** The task opened from a chat, over that chat: the owner reads and answers it without leaving where they were. */
export function TaskPeek() {
  const t = useT();
  const id = useNav((s) => s.peekTaskId);
  const task = useTasks((s) => (id ? s.tasks[id] : undefined));
  useEffect(() => {
    if (id) ensureTask(id);
  }, [id]);
  if (!id || !task) return null;
  return (
    <TaskPanel
      key={task.id}
      task={task}
      onClose={() => nav.set({ peekTaskId: undefined })}
      actions={
        <IconButton
          size="sm"
          label={t("tasks.openInList")}
          icon={<Icons.Maximize2 size={14} />}
          onClick={() => go.taskInList(task.id)}
        />
      }
    />
  );
}
