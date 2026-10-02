import type { TaskColumn } from "@apx/protocol";
import { AgentAvatar, Button, Dialog, Icons, Input, Menu, Textarea } from "@apx/ui";
import { useState } from "react";
import { blobOf, DEFAULT_PID } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { createTask } from "../data/tasks.ts";
import { type MessageKey, type T, useT } from "../i18n/index.ts";
import { type CommitmentDraft, CommitmentFields } from "./Commitments.tsx";

const COLUMN_KEYS: Record<string, MessageKey> = {
  backlog: "tasks.col.backlog",
  todo: "tasks.col.todo",
  doing: "tasks.col.doing",
  review: "tasks.col.review",
};

/** The default columns in the owner's language; a column the owner made shows its own name. */
export const columnLabel = (c: TaskColumn, t: T) => {
  const key = COLUMN_KEYS[c.id];
  return key ? t(key) : c.label;
};

export function NewTask({ projectId, onClose }: { projectId?: string | undefined; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<string>();
  const [commitment, setCommitment] = useState<CommitmentDraft>({ owed_by: "owner" });
  const save = async () => {
    await createTask({
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(projectId && projectId !== DEFAULT_PID ? { project: projectId } : {}),
      ...(assignee ? { assignee } : {}),
      ...(commitment.person ? { person: commitment.person, owed_by: commitment.owed_by } : {}),
      ...(commitment.due ? { due_at: commitment.due } : {}),
    });
    onClose();
  };
  return (
    <Dialog
      open
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
      <div className="pform">
        <Input
          aria-label={t("tasks.title")}
          placeholder={t("tasks.title")}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Textarea
          aria-label={t("tasks.description")}
          placeholder={t("tasks.descriptionHint")}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <AssigneePicker value={assignee} projectId={projectId} onChange={setAssignee} />
        <CommitmentFields value={commitment} onChange={setCommitment} />
      </div>
    </Dialog>
  );
}

export function AssigneePicker(props: {
  value?: string | undefined;
  projectId?: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const list = Object.values(agents).filter((a) => !a.project_id || a.project_id === props.projectId);
  const current = props.value ? agents[props.value] : undefined;
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
          {current && <AgentAvatar name={current.name} blob={blobOf(current)} size={16} />}
          {current?.name ?? t("tasks.nobody")}
        </Button>
      }
      items={[
        { label: t("tasks.nobody"), onSelect: () => props.onChange(undefined) },
        { type: "separator" as const },
        ...list.map((a) => ({ label: a.name, onSelect: () => props.onChange(a.id) })),
      ]}
    />
  );
}
