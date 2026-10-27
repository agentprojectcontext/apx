import { MarkdownView } from "@apx/ui";
import { useEffect } from "react";
import { useMarkdownLabels } from "../common/useMarkdownLabels.ts";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";

/** A read-only view of the task, never a new message or input to its agent. */
export function TaskDescription({ id }: { id: string }) {
  const task = useTasks((s) => s.tasks[id]);
  const t = useT();
  const labels = useMarkdownLabels();
  useEffect(() => ensureTask(id), [id]);
  return task?.description.trim() ? (
    <section className="transcript__task-description" aria-label={t("tasks.description")}>
      <h3>{t("tasks.description")}</h3>
      <MarkdownView source={task.description} size="sm" labels={labels} />
    </section>
  ) : null;
}
