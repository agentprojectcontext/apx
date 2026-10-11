import { useState } from "react";
import { dueWhen, sentenceCase } from "../format";
import type { Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { DateSheet } from "../ui/DateSheet";
import { Icon, type IconName } from "../ui/Icon";
import { AgentAvatar, ListGroup, ListRow } from "../ui/kit";
import { OptionSheet } from "../ui/OptionSheet";
import { theme } from "../ui/theme";
import {
  assignableAgents,
  columnName,
  KIND_KEY,
  KINDS,
  PRIORITIES,
  PRIORITY_KEY,
  type TaskPatch,
  type TaskValues,
} from "./fields";
import { momentOf } from "./when";

export type TaskField = "status" | "kind" | "priority" | "project" | "assignee" | "due";

/**
 * A task's column, priority, who does it, due date, project and type, one row each; a row opens its sheet and the
 * pick reaches `onChange` as tasks.update takes it (`null` clears). Shared by the task's page and the new task.
 */
export function TaskFields({
  data,
  value,
  onChange,
}: {
  data: Workspace;
  value: TaskValues;
  onChange: (patch: TaskPatch) => void;
}) {
  const [sheet, setSheet] = useState<TaskField>();
  const close = () => setSheet(undefined);
  const column = data.columns.find((item) => item.id === value.status);
  const agent = data.agents.find((item) => item.id === value.assignee);
  const project = data.projects.find((item) => item.id === value.project);
  const lead = (name: IconName) => <Icon name={name} size={18} color={theme.fgMuted} />;
  return (
    <>
      <ListGroup>
        <ListRow
          label={t("tkColumn")}
          leading={lead("LayoutGrid")}
          detail={column ? columnName(column, t) : value.status}
          onPress={() => setSheet("status")}
        />
        <ListRow
          label={t("tkPriority")}
          leading={lead("Flag")}
          detail={t(PRIORITY_KEY[value.priority])}
          detailColor={
            value.priority === "urgent" ? theme.danger : value.priority === "high" ? theme.warning : undefined
          }
          onPress={() => setSheet("priority")}
        />
        <ListRow
          label={t("tkAssignee")}
          leading={lead("UserRound")}
          detail={agent?.name ?? value.assignee ?? t("tkNobody")}
          onPress={() => setSheet("assignee")}
        />
        <ListRow
          label={t("tkDue")}
          leading={lead("Calendar")}
          detail={value.due ? dueWhen(momentOf(value.due).toISOString()) : "—"}
          onPress={() => setSheet("due")}
        />
        <ListRow
          label={t("tkProject")}
          leading={lead("Folder")}
          detail={project?.name ?? t("defaultProject")}
          onPress={() => setSheet("project")}
        />
        <ListRow
          label={t("tkType")}
          leading={lead("ListChecks")}
          detail={t(KIND_KEY[value.kind])}
          onPress={() => setSheet("kind")}
        />
      </ListGroup>
      {sheet ? <FieldSheet field={sheet} data={data} value={value} onChange={onChange} onClose={close} /> : null}
    </>
  );
}

/** One property's sheet: a pick reaches `onChange` as tasks.update takes it (`null` clears). */
export function FieldSheet({
  field,
  data,
  value,
  onChange,
  onClose: close,
}: {
  field: TaskField;
  data: Workspace;
  value: TaskValues;
  onChange: (patch: TaskPatch) => void;
  onClose: () => void;
}) {
  const agents = assignableAgents(data.agents, value.project);
  const projects = data.projects.filter((item) => item.registered !== false);
  return (
    <>
      {field === "status" ? (
        <OptionSheet
          title={t("tkColumn")}
          value={value.status}
          options={data.columns.map((item) => ({ value: item.id, label: columnName(item, t) }))}
          onPick={(status) => onChange({ status })}
          onClose={close}
        />
      ) : null}
      {field === "priority" ? (
        <OptionSheet
          title={t("tkPriority")}
          value={value.priority}
          options={PRIORITIES.map((item) => ({ value: item, label: t(PRIORITY_KEY[item]) }))}
          onPick={(priority) => onChange({ priority })}
          onClose={close}
        />
      ) : null}
      {field === "kind" ? (
        <OptionSheet
          title={t("tkType")}
          value={value.kind}
          options={KINDS.map((item) => ({ value: item, label: t(KIND_KEY[item]) }))}
          onPick={(kind) => onChange({ kind })}
          onClose={close}
        />
      ) : null}
      {field === "assignee" ? (
        <OptionSheet
          title={t("tkAssignee")}
          value={value.assignee ?? ""}
          options={[
            { value: "", label: t("tkNobody") },
            ...agents.map((item) => ({
              value: item.id,
              label: item.name,
              sub: item.kind === "secretary" ? t("superAgent") : sentenceCase(item.role),
              leading: <AgentAvatar name={item.name} blob={item.blob} id={item.id} size={28} />,
            })),
          ]}
          onPick={(id) => onChange({ assignee: id || null })}
          onClose={close}
        />
      ) : null}
      {field === "project" ? (
        <OptionSheet
          title={t("tkProject")}
          value={value.project ?? ""}
          options={[
            { value: "", label: t("defaultProject") },
            ...projects.map((item) => ({ value: item.id, label: item.name })),
          ]}
          onPick={(id) => {
            // An agent of another project cannot keep it: the core unassigns it, and so does the form.
            const keeps =
              !value.assignee || assignableAgents(data.agents, id || undefined).some((a) => a.id === value.assignee);
            onChange({ project: id || null, ...(keeps ? {} : { assignee: null }) });
          }}
          onClose={close}
        />
      ) : null}
      {field === "due" ? (
        <DateSheet
          title={t("tkDue")}
          value={value.due}
          onPick={(due) => onChange({ due_at: due ? momentOf(due).toISOString() : null })}
          onClose={close}
        />
      ) : null}
    </>
  );
}
