import { useState } from "react";
import { Alert } from "react-native";
import type { Task, Thread, Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import type { TaskEvent } from "../protocol";
import { Icon, type IconName } from "../ui/Icon";
import { BottomSheet, ListRow, Toggle } from "../ui/kit";
import { useTheme } from "../ui/theme";
import type { TaskComment } from "./comments";
import { columnName, PRIORITY_KEY, type TaskPatch, taskValues } from "./fields";
import { FieldSheet, type TaskField } from "./TaskFields";
import { WorkSheet } from "./TaskWork";

export type CloseState = "done" | "dropped" | "open" | "missed";

export type TaskActions = {
  detail: (taskId: string) => Promise<{ events: TaskEvent[]; comments: TaskComment[]; sessions: Thread[] }>;
  update: (taskId: string, patch: TaskPatch) => Promise<Task>;
  close: (task: Task, state: CloseState) => Promise<Task>;
  remove: (taskId: string) => Promise<void>;
  comment: (taskId: string, text: string) => Promise<void>;
};

export type CloseChoice = { state: CloseState; label: Key; icon: IconName };

/** How an open task can close (a commitment is kept, missed or released), or reopening a closed one. */
export function closeChoices(task: Task): CloseChoice[] {
  if (task.state !== "open") return [{ state: "open", label: "tkReopen", icon: "RotateCcw" }];
  if (task.kind === "commitment")
    return [
      { state: "done", label: "tkKept", icon: "CircleCheck" },
      { state: "missed", label: "tkMissed", icon: "CircleX" },
      { state: "dropped", label: "tkRelease", icon: "Archive" },
    ];
  return [
    { state: "done", label: "tkMarkDone", icon: "CircleCheck" },
    { state: "dropped", label: "tkDrop", icon: "Archive" },
  ];
}

/** Closing asks first (it leaves the board); reopening does not. */
export function confirmClose(task: Task, choice: CloseChoice, go: () => void) {
  if (choice.state === "open") return go();
  Alert.alert(t(choice.label), t("tkCloseAsk", { title: task.title }), [
    { text: t("cancel"), style: "cancel" },
    { text: t(choice.label), style: choice.state === "done" ? "default" : "destructive", onPress: go },
  ]);
}

export function confirmDelete(task: Task, go: () => void) {
  Alert.alert(t("tkDelete"), t("tkDeleteAsk", { title: task.title }), [
    { text: t("cancel"), style: "cancel" },
    { text: t("delete"), style: "destructive", onPress: go },
  ]);
}

export const failAlert = (title: string) => (error: unknown) =>
  Alert.alert(title, error instanceof Error ? error.message : String(error));

/**
 * A task's options in a sheet, from a long press on the list or the page's "…": open it or its agents' chats, move it,
 * change its priority or who does it, wait for the owner, close, reopen or delete it (closing and deleting ask first).
 */
export function TaskMenu({
  task,
  data,
  actions,
  onClose,
  onOpen,
  openThread,
  onDeleted,
}: {
  task: Task;
  data: Workspace;
  actions: TaskActions;
  onClose: () => void;
  onOpen?: () => void;
  openThread: (id: string) => void;
  onDeleted?: () => void;
}) {
  const theme = useTheme();
  const [field, setField] = useState<TaskField | "work">();
  const fail = failAlert(task.title);
  const open = task.state === "open";
  const value = taskValues(task);
  const column = data.columns.find((item) => item.id === task.status);
  const agent = data.agents.find((item) => item.id === task.assignee);
  const done = (work: () => Promise<unknown>) => {
    onClose();
    void work().catch(fail);
  };
  const update = (patch: TaskPatch) => done(() => actions.update(task.id, patch));
  const item = (label: string, icon: IconName, onPress: () => void, o: { detail?: string; danger?: boolean } = {}) => (
    <ListRow
      key={label}
      label={label}
      detail={o.detail}
      detailColor={o.danger ? theme.danger : undefined}
      leading={<Icon name={icon} size={18} color={o.danger ? theme.danger : theme.fgMuted} />}
      chevron={Boolean(o.detail)}
      onPress={onPress}
    />
  );
  if (field === "work")
    return <WorkSheet task={task} data={data} load={actions.detail} openThread={openThread} onClose={onClose} />;
  if (field) return <FieldSheet field={field} data={data} value={value} onChange={update} onClose={onClose} />;
  return (
    <BottomSheet title={task.title} onClose={onClose}>
      {onOpen
        ? item(t("tkOpen"), "FileText", () => {
            onClose();
            onOpen();
          })
        : null}
      {item(t("tkWork"), "MessageCircle", () => setField("work"))}
      {open
        ? item(t("tkColumn"), "LayoutGrid", () => setField("status"), {
            detail: column ? columnName(column, t) : task.status,
          })
        : null}
      {item(t("tkPriority"), "Flag", () => setField("priority"), { detail: t(PRIORITY_KEY[value.priority]) })}
      {item(t("tkAssignee"), "UserRound", () => setField("assignee"), {
        detail: agent?.name ?? task.assignee ?? t("tkNobody"),
      })}
      {open ? (
        <ListRow
          label={t("tkWaits")}
          leading={<Icon name="Hand" size={18} color={theme.fgMuted} />}
          chevron={false}
          trailing={
            <Toggle
              label={t("tkWaits")}
              value={task.awaits_owner}
              onChange={(awaits_owner) => update({ awaits_owner })}
            />
          }
        />
      ) : null}
      {closeChoices(task).map((choice) =>
        item(t(choice.label), choice.icon, () =>
          confirmClose(task, choice, () => done(() => actions.close(task, choice.state))),
        ),
      )}
      {item(
        t("tkDelete"),
        "Trash2",
        () =>
          confirmDelete(task, () =>
            done(async () => {
              await actions.remove(task.id);
              onDeleted?.();
            }),
          ),
        { danger: true },
      )}
    </BottomSheet>
  );
}
