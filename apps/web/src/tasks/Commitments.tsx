import type { Task } from "@apx/protocol";
import { Badge, Icons } from "@apx/ui";
import { aheadLabel, shortWhen } from "../common/format.ts";
import { useT } from "../i18n/index.ts";

/** Who and when, on a card: "Ana owes you · due Fri 09:00" (red once overdue). */
export function CommitmentMeta({ task }: { task: Task }) {
  const t = useT();
  const overdue = task.state === "open" && task.due_at && task.due_at < new Date().toISOString();
  return (
    <>
      {task.person_name && (
        <Badge tone="violet">
          {task.owed_by === "person"
            ? t("commitments.theyOwe", { name: task.person_name })
            : t("commitments.youOwe", { name: task.person_name })}
        </Badge>
      )}
      {task.due_at && (
        <Badge tone={overdue ? "danger" : "neutral"}>
          <Icons.Calendar size={11} />
          {overdue ? shortWhen(task.due_at) : aheadLabel(task.due_at)}
        </Badge>
      )}
    </>
  );
}
