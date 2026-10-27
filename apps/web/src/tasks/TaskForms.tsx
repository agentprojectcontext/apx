import type { Task, TaskKind, TaskPriority } from "@apx/protocol";
import { Button, Dialog, Field, Help, Input, TagInput, Textarea } from "@apx/ui";
import { useState } from "react";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { ProjectSelect } from "../common/pickers/ProjectSelect.tsx";
import { columnLabel } from "../common/taskStatus.ts";
import { realProjectId } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { createTask, deleteTask, useTasks } from "../data/tasks.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { useDraftAttachments } from "./draftAttachments.ts";
import { TaskAttachments } from "./TaskAttachments.tsx";
import { DueField, KindControl, OwedByControl, PersonSelect, PrioritySelect, ReminderField } from "./TaskFields.tsx";
import { type Reminder, remindAt } from "./when.ts";

export { columnLabel } from "../common/taskStatus.ts";

/** A column's dot, in the tone of its group in the list; the backlog stays grey (nothing planned yet). */
export function ColumnDot({ id }: { id: string }) {
  const tone = id === "backlog" || id === "doing" || id === "review" ? id : "pending";
  return <span className={`col-dot is-${tone}`} aria-hidden="true" />;
}

const KIND_HINT: Record<TaskKind, MessageKey> = {
  task: "tasks.type.taskHint",
  commitment: "tasks.type.commitmentHint",
  errand: "tasks.type.errandHint",
};

const COLUMN_HELP: Record<string, MessageKey> = {
  backlog: "tasks.help.col.backlog",
  todo: "tasks.help.col.todo",
  doing: "tasks.help.col.doing",
  review: "tasks.help.col.review",
};

/** What each column of the board means, the owner's own ones included. */
export function ColumnHelp() {
  const t = useT();
  const columns = useTasks((s) => s.columns);
  return (
    <Help
      label={t("tasks.help.columns")}
      title={t("tasks.help.columnsTitle")}
      items={columns.map((c) => ({
        term: (
          <span className="taskhelp__term">
            <ColumnDot id={c.id} />
            {columnLabel(c, t)}
          </span>
        ),
        text: t(COLUMN_HELP[c.id] ?? "tasks.help.col.custom"),
      }))}
    >
      {t("tasks.help.columnsMore")}
    </Help>
  );
}

/** When to make a task, a commitment or an errand. */
export function KindHelp() {
  const t = useT();
  const kinds: TaskKind[] = ["task", "commitment", "errand"];
  return (
    <Help
      label={t("tasks.help.types")}
      title={t("tasks.help.typesTitle")}
      items={kinds.map((k) => ({ term: t(`tasks.type.${k}`), text: t(KIND_HINT[k]) }))}
    />
  );
}

export function NewTask({ projectId, onClose }: { projectId?: string | undefined; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<TaskKind>("task");
  const [project, setProject] = useState(realProjectId(projectId));
  const [assignee, setAssignee] = useState<string>();
  const [person, setPerson] = useState<string>();
  const [owedBy, setOwedBy] = useState<"owner" | "person">("owner");
  const [due, setDue] = useState<string>();
  const [reminder, setReminder] = useState<Reminder>("due");
  const [customRemind, setCustomRemind] = useState<string>();
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [tags, setTags] = useState<string[]>([]);
  const { attachments, change: setAttachments, consumed } = useDraftAttachments();
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const agents = useData((s) => s.agents);
  // Inside a project the task belongs there; from the global list the owner picks where.
  const global = projectId === undefined;

  const pickProject = (id: string | undefined) => {
    setProject(id);
    // An agent from another project cannot take it.
    const owner = assignee ? agents[assignee]?.project_id : undefined;
    if (owner && owner !== id) setAssignee(undefined);
  };
  const save = async () => {
    if (uploading || saving) return;
    setSaving(true);
    const remind = remindAt(due, reminder, customRemind);
    const ok = await createTask({
      title: title.trim(),
      kind,
      priority,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(project ? { project } : {}),
      ...(assignee ? { assignee } : {}),
      ...(kind === "commitment" && person ? { person, owed_by: owedBy } : {}),
      ...(due ? { due_at: due } : {}),
      ...(remind ? { remind_at: remind } : {}),
      ...(tags.length ? { tags } : {}),
      ...(attachments.length ? { attachments: attachments.map((a) => a.id) } : {}),
    });
    setSaving(false);
    if (ok) {
      consumed();
      onClose();
    }
  };
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && !saving && onClose()}
      title={t("tasks.new")}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!title.trim() || uploading || saving} loading={saving} onClick={() => void save()}>
            {t("tasks.create")}
          </Button>
        </>
      }
    >
      <div className="taskform">
        <Field label={t("tasks.title")}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              placeholder={t("tasks.titleHint")}
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
          )}
        </Field>
        <Field label={t("tasks.description")} hint={t("tasks.descriptionHelp")}>
          {(id) => (
            <Textarea
              id={id}
              placeholder={t("tasks.descriptionHint")}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          )}
        </Field>
        <TaskAttachments value={attachments} onChange={setAttachments} onBusy={setUploading} disabled={saving} />
        <Field label={t("tasks.type")} hint={t(KIND_HINT[kind])}>
          <KindControl value={kind} onChange={setKind} />
        </Field>
        {kind === "commitment" && (
          <div className="taskform__row">
            <Field label={t("commitments.person.label")}>
              <PersonSelect value={person} onChange={setPerson} />
            </Field>
            <Field label={t("commitments.who")}>
              <OwedByControl value={owedBy} onChange={setOwedBy} />
            </Field>
          </div>
        )}
        <div className="taskform__row">
          {global && (
            <Field label={t("pickers.project")}>
              <ProjectSelect value={project} onChange={pickProject} />
            </Field>
          )}
          <Field label={t("tasks.assignee")} hint={global ? t("tasks.assigneeHint") : undefined}>
            <AgentSelect
              value={assignee}
              projectId={project}
              all={global && !project}
              globalAgents={project ? "secretary" : "all"}
              none={t("tasks.nobody")}
              onChange={(id, agentProject) => {
                setAssignee(id);
                // Picking a project's agent puts the task in that project.
                if (agentProject) setProject(agentProject);
              }}
            />
          </Field>
        </div>
        <div className="taskform__row">
          <Field label={t("commitments.due")}>
            <DueField value={due} onChange={setDue} />
          </Field>
          <Field label={t("tasks.reminder")}>
            <ReminderField
              due={due}
              choice={reminder}
              custom={customRemind}
              onChange={(c, v) => {
                setReminder(c);
                setCustomRemind(v);
              }}
            />
          </Field>
        </div>
        <div className="taskform__row">
          <Field label={t("tasks.priority")}>
            <PrioritySelect value={priority} onChange={setPriority} />
          </Field>
          <Field label={t("tasks.tags")} hint={t("tasks.tagsHint")}>
            <TagInput
              label={t("tasks.tags")}
              removeLabel={t("tasks.tagRemove")}
              placeholder={t("tasks.tagsPlaceholder")}
              value={tags}
              onValueChange={setTags}
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** Asks before deleting a task for good: it, its history and its conversation go. */
export function DeleteTask({ task, onClose }: { task: Task; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await deleteTask(task.id);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && onClose()}
      title={t("tasks.delete.title")}
      description={t("thread.delete.body")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t("tasks.delete")}
          </Button>
        </>
      }
    >
      {t("tasks.delete.what", { title: task.title })}
    </Dialog>
  );
}
