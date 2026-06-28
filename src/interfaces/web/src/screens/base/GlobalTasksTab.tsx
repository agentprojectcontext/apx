import { useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { Pager, usePaged } from "../../components/Pager";
import { Badge, Button, Empty, Loading } from "../../components/ui";
import { t } from "../../i18n";

// All projects' tasks, aggregated (GET /tasks).
export function GlobalTasksTab() {
  const navigate = useNavigate();
  const [state, setState] = useState<"open" | "done" | "dropped" | "all">("open");
  const list = useSWR(`/tasks?state=${state}`, () => Tasks.global(state));
  const paged = usePaged(list.data || [], state);

  return (
    <Section
      title={t("project.global_tasks.title")}
      description={t("project.global_tasks.subtitle")}
      action={
        <div className="flex gap-1">
          {(["open", "done", "dropped", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={state === s ? "primary" : "ghost"} onClick={() => setState(s)}>{s}</Button>
          ))}
        </div>
      }
    >
      {list.isLoading && <Loading />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <Empty>{t("project.global_tasks.empty")}</Empty>}
      <ul className="space-y-2 text-sm">
        {paged.slice.map((task) => (
          <li key={`${task.project_id}-${task.id}`} className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <button
              type="button"
              onClick={() => navigate(`/p/${task.project_id}/tasks`)}
              title={t("project.global_tasks.go_project")}
            >
              <Badge tone="info">{(task.project_name || "").split("/").pop() || task.project_id}</Badge>
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{task.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                <span>{task.state}</span>
                {task.agent && <Badge tone="muted">@{task.agent}</Badge>}
                {task.tags?.map((tg) => <span key={tg}>#{tg}</span>)}
                {task.due && <span>{t("project.global_tasks.due")} {task.due}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Pager page={paged.page} pageCount={paged.pageCount} total={paged.total} start={paged.start} end={paged.end} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
    </Section>
  );
}
