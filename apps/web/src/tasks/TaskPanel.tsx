import type { Task, TaskEvent } from "@apx/protocol";
import { Button, IconButton, Icons, Menu, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { shortWhen } from "../common/format.ts";
import { loadThread } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { closeTask, commentTask, taskEvents, updateTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { CommitmentFields, dayOf } from "./Commitments.tsx";
import { AssigneePicker, columnLabel } from "./TaskForms.tsx";

/**
 * One task beside the list (the list stays in view): its column and owner, state buttons, history and conversation;
 * comment with @agent to ask one of them.
 */
export function TaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const t = useT();
  const columns = useTasks((s) => s.columns);
  const thread = useData((s) => s.threads[task.thread_id]);
  const load = useData((s) => s.threadLoad[task.thread_id]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    if (load == null) void loadThread(task.thread_id);
  }, [load, task.thread_id]);
  // The history is read again whenever the task moves (activity_at changes with every event).
  const movedAt = task.activity_at;
  useEffect(() => {
    let current = true;
    void taskEvents(task.id).then((list) => current && movedAt && setEvents(list));
    return () => {
      current = false;
    };
  }, [task.id, movedAt]);
  const send = async () => {
    if (await commentTask(task.id, text.trim())) setText("");
  };
  return (
    <aside className="taskpanel" aria-label={task.title}>
      <header className="taskpanel__head">
        <h2 className="taskpanel__title">{task.title}</h2>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      <div className="taskdetail">
        <div className="taskdetail__bar">
          <Menu
            trigger={
              <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
                {(() => {
                  const c = columns.find((x) => x.id === task.status);
                  return c ? columnLabel(c, t) : task.status;
                })()}
              </Button>
            }
            items={columns.map((c) => ({
              label: columnLabel(c, t),
              onSelect: () => void updateTask(task.id, { status: c.id }),
            }))}
          />
          <AssigneePicker
            value={task.assignee}
            projectId={task.project_id}
            onChange={(id) => void updateTask(task.id, { assignee: id ?? null })}
          />
          <span className="board__spacer" />
          {task.state === "open" ? (
            <>
              <Button size="sm" leadingIcon={<Icons.Check size={14} />} onClick={() => void closeTask(task.id, "done")}>
                {t("tasks.markDone")}
              </Button>
              <IconButton
                size="sm"
                label={t("tasks.drop")}
                icon={<Icons.X size={14} />}
                onClick={() => void closeTask(task.id, "dropped")}
              />
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void closeTask(task.id, "open")}>
              {t("tasks.reopen")}
            </Button>
          )}
        </div>
        <CommitmentFields
          value={{ person: task.person_id, owed_by: task.owed_by ?? "owner", due: dayOf(task.due_at) }}
          onChange={(v) =>
            void updateTask(task.id, {
              ...(v.person !== task.person_id ? { person: v.person ?? null } : {}),
              ...(v.person && v.owed_by !== (task.owed_by ?? "owner") ? { owed_by: v.owed_by } : {}),
              ...(v.due !== dayOf(task.due_at) ? { due_at: v.due ?? null } : {}),
            })
          }
        />
        {task.description && <p className="taskdetail__desc">{task.description}</p>}
        <div className="taskdetail__history">
          {events.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only.
            <div key={i} className="taskdetail__event">
              <span>{t(`tasks.op.${e.op}`, { by: e.by === "owner" ? t("tasks.you") : e.by })}</span>
              <span className="taskcard__when">{shortWhen(e.at)}</span>
            </div>
          ))}
        </div>
        <div className="taskdetail__chat">{thread && load === "ready" && <Transcript thread={thread} />}</div>
        <div className="memory__add">
          <Textarea
            aria-label={t("tasks.comment")}
            rows={2}
            placeholder={t("tasks.commentHint")}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <Button size="sm" disabled={!text.trim()} onClick={() => void send()}>
            {t("tasks.send")}
          </Button>
        </div>
      </div>
    </aside>
  );
}
