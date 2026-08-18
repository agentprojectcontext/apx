import { useEffect, useState } from "react";
import useSWR from "swr";
import { Tasks } from "../../lib/api";
import { Agents } from "../../lib/api/agents";
import { Button, Dialog, Field, Input, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { TASK_STATUS_ORDER, statusLabel } from "./taskStatus";
import { t } from "../../i18n";
import type { TaskEntry, TaskStatus } from "../../types/daemon";

/**
 * The one form for a task — creating and editing.
 *
 * A task used to be born from a single-line input and could never be changed
 * afterwards: a typo in the title, a date that moved, the wrong agent, all of
 * it was permanent unless you went back to the CLI. Same dialog for both jobs
 * so what you can set is exactly what you can later fix.
 */
export function TaskFormDialog({
  open,
  onClose,
  fixedPid,
  projects,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Project the screen is pinned to. Omitted on the cross-project screen. */
  fixedPid?: string;
  /** Pickable projects — only used when there is no fixedPid. */
  projects?: { id: string | number; name?: string | null; path?: string }[];
  /** Present = edit that task; absent = create a new one. */
  editing?: { pid: string; task: TaskEntry } | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const pid = editing?.pid ?? fixedPid ?? target;

  // Reset every time the dialog opens so a cancelled edit never leaks into the
  // next one.
  useEffect(() => {
    if (!open) return;
    const task = editing?.task;
    setTitle(task?.title ?? "");
    setBody(task?.body ?? "");
    setDue(task?.due ? String(task.due).slice(0, 10) : "");
    setAgent(task?.agent ?? "");
    setStatus(task?.status ?? "pending");
    setTarget(fixedPid ?? String(projects?.[0]?.id ?? ""));
  }, [open, editing, fixedPid, projects]);

  // Agents belong to a project, so the picker can only be filled once one is
  // chosen. On the cross-project screen that is after the project select.
  const { data: agents } = useSWR(
    open && pid ? `/api/projects/${pid}/agents` : null,
    () => Agents.list(pid),
  );

  const save = async () => {
    if (!title.trim() || !pid) return;
    setBusy(true);
    try {
      const fields = {
        title: title.trim(),
        body: body.trim() || null,
        due: due || null,
        agent: agent || null,
      };
      if (editing) {
        await Tasks.patch(pid, editing.task.id, fields);
        // Status is its own event (it is a workflow move, not a field edit) —
        // only send it when it actually changed.
        if (editing.task.state === "open" && status !== (editing.task.status ?? "pending")) {
          await Tasks.status(pid, editing.task.id, status);
        }
        toast.success(t("common.saved"));
      } else {
        await Tasks.add(pid, { ...fields, source: "web" });
        toast.success(t("project.tasks.created"));
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("project.tasks.create_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? t("tasks.edit_title") : t("project.global_tasks.add_title")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            data-testid="task-add"
            loading={busy}
            disabled={!title.trim() || !pid}
            onClick={save}
          >
            {editing ? t("common.save") : t("project.global_tasks.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("project.global_tasks.field_title")}>
          <Input
            data-testid="task-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("project.tasks.add_placeholder")}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
        </Field>

        {/* "Prompt" meant nothing on its own — it is the task's instructions
            for the agent, and saying so is the difference between a field
            people fill and a field people skip. */}
        <Field label={t("tasks.field_prompt")} hint={t("tasks.prompt_hint")}>
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("tasks.prompt_ph")}
            className="text-xs"
          />
        </Field>

        {/* Required on the cross-project screen: there is no "here" to default
            to, and guessing files the task where nobody looked. */}
        {!fixedPid && !editing && (
          <Field label={t("project.global_tasks.field_project")}>
            <UiSelect
              value={String(target)}
              onChange={setTarget}
              options={(projects ?? []).map((p) => ({ value: String(p.id), label: p.name || p.path || String(p.id) }))}
            />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("tasks.field_agent")}>
            <UiSelect
              value={agent}
              onChange={setAgent}
              disabled={!pid}
              options={[
                { value: "", label: t("tasks.agent_none") },
                ...(agents ?? []).map((a) => ({ value: a.slug, label: a.name || a.slug })),
              ]}
            />
          </Field>
          <Field label={t("project.global_tasks.field_due")}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>

        {editing?.task.state === "open" && (
          <Field label={t("tasks.field_status")}>
            <UiSelect
              value={status}
              onChange={(v) => setStatus(v as TaskStatus)}
              options={TASK_STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) }))}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
