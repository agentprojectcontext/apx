import type { TaskColumn, TaskKind, TaskPriority } from "@apx/protocol";
import { Button, Dialog, Field, Input, TagInput, Textarea } from "@apx/ui";
import { useState } from "react";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { ProjectSelect } from "../common/pickers/ProjectSelect.tsx";
import { realProjectId } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { createTask } from "../data/tasks.ts";
import { type MessageKey, type T, useT } from "../i18n/index.ts";
import { DueField, KindControl, OwedByControl, PersonSelect, PrioritySelect, ReminderField } from "./TaskFields.tsx";
import { type Reminder, remindAt } from "./when.ts";

const COLUMN_KEYS: Record<string, MessageKey> = {
  backlog: "tasks.col.backlog",
  todo: "tasks.col.todo",
  doing: "tasks.col.doing",
  review: "tasks.col.review",
};

/** A column's dot, in the tone of its group in the list; the backlog stays grey (nothing planned yet). */
export function ColumnDot({ id }: { id: string }) {
  const tone = id === "backlog" || id === "doing" || id === "review" ? id : "pending";
  return <span className={`col-dot is-${tone}`} aria-hidden="true" />;
}

/** The default columns in the owner's language; a column the owner made shows its own name. */
export const columnLabel = (c: TaskColumn, t: T) => {
  const key = COLUMN_KEYS[c.id];
  return key ? t(key) : c.label;
};

const KIND_HINT: Record<TaskKind, MessageKey> = {
  task: "tasks.type.taskHint",
  commitment: "tasks.type.commitmentHint",
  errand: "tasks.type.errandHint",
};

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
    const remind = remindAt(due, reminder, customRemind);
    await createTask({
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
    });
    onClose();
  };
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={t("tasks.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!title.trim()} onClick={() => void save()}>
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
