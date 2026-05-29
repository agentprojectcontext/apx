import { useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Empty, Loading } from "../../components/ui";

// All projects' tasks, aggregated (GET /tasks).
export function GlobalTasksTab() {
  const navigate = useNavigate();
  const [state, setState] = useState<"open" | "done" | "dropped" | "all">("open");
  const list = useSWR(`/tasks?state=${state}`, () => Tasks.global(state));

  return (
    <Section
      title="Tasks (todos los proyectos)"
      description="Tareas agregadas de todos los proyectos registrados."
      action={
        <div className="flex gap-1">
          {(["open", "done", "dropped", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={state === s ? "primary" : "ghost"} onClick={() => setState(s)}>{s}</Button>
          ))}
        </div>
      }
    >
      {list.isLoading && <Loading />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <Empty>Sin tasks {state === "all" ? "" : state}.</Empty>}
      <ul className="space-y-2 text-sm">
        {(list.data || []).map((t) => (
          <li key={`${t.project_id}-${t.id}`} className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <button
              type="button"
              onClick={() => navigate(`/p/${t.project_id}/tasks`)}
              title="Ir al proyecto"
            >
              <Badge tone="info">{(t.project_name || "").split("/").pop() || t.project_id}</Badge>
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                <span>{t.state}</span>
                {t.agent && <Badge tone="muted">@{t.agent}</Badge>}
                {t.tags?.map((tg) => <span key={tg}>#{tg}</span>)}
                {t.due && <span>vence {t.due}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
