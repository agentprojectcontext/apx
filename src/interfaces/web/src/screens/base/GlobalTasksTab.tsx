import { useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tasks } from "../../lib/api";
import type { TaskStatus } from "../../types/daemon";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Dialog, Empty, Field, Input, Loading } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useProjects } from "../../hooks/useProjects";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

// All projects' tasks, aggregated (GET /tasks), server-paginated.
export function GlobalTasksTab() {
  const navigate = useNavigate();
  const [state, setState] = useState<"open" | "done" | "dropped" | "all">("open");
  // Workflow sub-status is a different question from state: "what is blocked
  // right now" is not "what is open". Only meaningful for open tasks.
  const [status, setStatus] = useState<TaskStatus | "">("");
  const effectiveStatus = state === "open" ? status : "";
  // The per-project Tasks screen has always had an inline add form; this one
  // did not, so on the base workspace the only way to file a task was to ask
  // the agent. A picker is the price of the cross-project view.
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const { projects } = useProjects();
  const toast = useToast();

  const paged = usePagedQuery({
    key: `/api/tasks?state=${state}&status=${effectiveStatus}`,
    fetchPage: (limit, offset) => Tasks.globalPage({ state, limit, offset, status: effectiveStatus }),
    resetKey: `${state}|${effectiveStatus}`,
  });

  const create = async () => {
    if (!title.trim() || !target) return;
    setBusy(true);
    try {
      await Tasks.add(String(target), { title: title.trim(), due: due || null });
      await paged.mutate();
      setAdding(false);
      setTitle(""); setDue("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      fullHeight
      title={t("project.global_tasks.title")}
      description={t("project.global_tasks.subtitle")}
      action={
        <div className="flex items-center gap-1">
          {(["open", "done", "dropped", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={state === s ? "primary" : "ghost"} onClick={() => setState(s)}>{s}</Button>
          ))}
          <Button
            size="sm"
            variant="primary"
            className="ml-2"
            onClick={() => { setTarget(String(projects[0]?.id ?? "")); setAdding(true); }}
          >
            <Plus size={14} /> {t("project.global_tasks.add")}
          </Button>
        </div>
      }
    >
      {state === "open" ? (
        <div className="mb-3 flex flex-wrap gap-1">
          <Button size="sm" variant={status === "" ? "primary" : "ghost"} onClick={() => setStatus("")}>
            {t("project.global_tasks.any_status")}
          </Button>
          {(["pending", "running", "in_review", "blocked"] as const).map((s) => (
            <Button key={s} size="sm" variant={status === s ? "primary" : "ghost"} onClick={() => setStatus(s)}>
              {s.replace("_", " ")}
            </Button>
          ))}
        </div>
      ) : null}

      {paged.isLoading && <Loading />}
      {!paged.isLoading && paged.total === 0 && <Empty>{t("project.global_tasks.empty")}</Empty>}
      <PagedList paged={paged} fullHeight>
        <ul className="space-y-2 text-sm">
          {paged.items.map((task) => (
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
      </PagedList>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t("project.global_tasks.add_title")}
        footer={
          <>
            <Button onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!title.trim() || !target} onClick={create}>
              {t("project.global_tasks.add")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 p-5">
          <Field label={t("project.global_tasks.field_title")}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && title.trim() && target) create(); }}
            />
          </Field>
          {/* Required, unlike the per-project screen: a cross-project view has
              no "here" to default to, and guessing one would file the task
              somewhere the user did not look. */}
          <Field label={t("project.global_tasks.field_project")}>
            <UiSelect
              value={String(target)}
              onChange={setTarget}
              options={projects.map((p) => ({ value: String(p.id), label: p.name || p.path }))}
            />
          </Field>
          <Field label={t("project.global_tasks.field_due")}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </Section>
  );
}
