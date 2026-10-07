import { Badge } from "../ui";
import { relativeWhen } from "../../lib/when";
import { t } from "../../i18n";
import type { TaskExecution as Execution } from "../../types/daemon";

const VERDICT_TONE: Record<Execution["verdict"], "success" | "warning" | "muted" | "info"> = {
  working: "success",
  not_verified: "warning",
  ended: "info",
  idle: "muted",
  closed: "muted",
};

/**
 * What is actually running on this task, apart from its column
 * (core/tasks/execution.js). Evidence only: a "running" card with nothing
 * behind it says "Ejecución no verificada", never "working", and nothing here
 * draws a progress bar — a live process is not proof of progress.
 */
export function TaskExecution({ execution }: { execution?: Execution | null }) {
  if (!execution) return null;
  const { verdict, runtime, last_activity: last, waiting_on: waiting, workflow } = execution;
  const s = runtime.session;
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3 text-xs" data-testid="task-execution">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t("tasks.execution_title")}</span>
        <Badge tone={VERDICT_TONE[verdict]}>
          <span data-testid="task-execution-verdict" data-verdict={verdict}>{t(`tasks.execution_verdict_${verdict}`)}</span>
        </Badge>
        {execution.agent_working && <Badge tone="success">{t("tasks.execution_agent_working")}</Badge>}
        {waiting && <Badge tone="warning">{t(`tasks.execution_waiting_${waiting}`)}</Badge>}
      </div>
      {verdict === "not_verified" && <p className="text-muted-fg">{t("tasks.execution_not_verified_hint")}</p>}
      {s && (
        <div className="text-muted-fg" data-testid="task-execution-session">
          {t("tasks.execution_session")}: <span className="font-mono">{s.id}</span>
          {s.runtime ? ` · ${s.runtime}` : ""}
          {" · "}{t(`tasks.execution_runtime_${runtime.state}`)}
          {s.started_at ? ` · ${t("tasks.execution_started")} ${relativeWhen(s.started_at, t as never)}` : ""}
          {s.finished_at ? ` · ${t("tasks.execution_finished")} ${relativeWhen(s.finished_at, t as never)}` : ""}
          {s.result ? <div className="mt-1 line-clamp-2 text-fg">{s.result}</div> : null}
        </div>
      )}
      {last?.at && (
        <div className="text-muted-fg">
          {t("tasks.execution_last_activity")}: {relativeWhen(last.at, t as never)}
          {last.by ? ` · ${last.by}` : ""}
          {last.kind !== "comment" ? ` · ${t(`tasks.execution_kind_${last.kind}`)}` : ""}
        </div>
      )}
      {workflow.changed_at && (
        <div className="text-muted-fg">
          {t("tasks.execution_status_set")} {relativeWhen(workflow.changed_at, t as never)}
          {workflow.changed_by ? ` · ${workflow.changed_by}` : ""}
        </div>
      )}
    </div>
  );
}
