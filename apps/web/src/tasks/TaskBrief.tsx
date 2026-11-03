import type { Task } from "@apx/protocol";
import { planSteps } from "@apx/protocol/task-plan";
import { Button, IconButton, Icons, MarkdownView, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { PlanCard } from "../chat/parts/PlanPart.tsx";
import { shortWhen } from "../common/format.ts";
import { useMarkdownLabels } from "../common/useMarkdownLabels.ts";
import { useData } from "../data/state.ts";
import { updateTask } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";

/** How many of the owner's messages show before "show all": the newest. */
const ASKED_SHOWN = 3;

/** Where the work must arrive, in a line or two: what its agent reads first, saved when the owner leaves the box. */
export function TaskGoal({ task }: { task: Task }) {
  const t = useT();
  const [draft, setDraft] = useState(task.goal ?? "");
  useEffect(() => setDraft(task.goal ?? ""), [task.goal]);
  return (
    <section className="taskdetail__goal" aria-label={t("tasks.goal")}>
      <h3 className="taskdetail__sectionhead">
        <Icons.MapPin size={13} />
        {t("tasks.goal")}
      </h3>
      <Textarea
        className="taskdetail__goalinput"
        aria-label={t("tasks.goal")}
        placeholder={t("tasks.goalHint")}
        rows={1}
        maxLength={500}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value.replace(/\n/g, " "))}
        onBlur={() => draft.trim() !== (task.goal ?? "") && void updateTask(task.id, { goal: draft.trim() || null })}
      />
    </section>
  );
}

/** What the owner said that asked for the task, as they said it and to whom: the newest few, the rest on request. */
export function TaskAsked({ task }: { task: Task }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [all, setAll] = useState(false);
  const asked = task.asked ?? [];
  if (!asked.length) return null;
  const shown = all ? asked : asked.slice(-ASKED_SHOWN);
  return (
    <section className="taskdetail__asked" aria-label={t("tasks.asked")}>
      <h3 className="taskdetail__sectionhead">
        <Icons.Quote size={13} />
        {t("tasks.asked")}
      </h3>
      {shown.map((a) => (
        <blockquote key={`${a.at}-${a.message_id ?? a.text.slice(0, 20)}`} className="taskdetail__said">
          <p>{a.text}</p>
          <footer>{t("tasks.askedTo", { when: shortWhen(a.at), agent: agents[a.by]?.name ?? a.by })}</footer>
        </blockquote>
      ))}
      {asked.length > shown.length && (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          {t("tasks.askedAll", { count: asked.length })}
        </Button>
      )}
    </section>
  );
}

/** What the task is about, read as formatted text; the pencil (or an empty task) opens it to edit. */
export function TaskDescription({ task }: { task: Task }) {
  const t = useT();
  const labels = useMarkdownLabels();
  const [draft, setDraft] = useState(task.description);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(task.description), [task.description]);
  if (!editing && task.description.trim())
    return (
      <div className="taskdetail__descview">
        <IconButton
          className="taskdetail__descedit"
          size="sm"
          label={t("tasks.descriptionEdit")}
          icon={<Icons.Pencil size={13} />}
          onClick={() => setEditing(true)}
        />
        <MarkdownView source={task.description} size="sm" labels={labels} />
      </div>
    );
  return (
    <Textarea
      className="taskdetail__desc"
      aria-label={t("tasks.description")}
      placeholder={t("tasks.descriptionHint")}
      rows={Math.min(14, Math.max(6, draft.split("\n").length))}
      autoFocus={editing}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        if (draft !== task.description) void updateTask(task.id, { description: draft });
        setEditing(false);
      }}
    />
  );
}

/** The plan its agent keeps: each step pending, under way or done, as the agent marks them while it works. */
export function TaskPlan({ plan }: { plan: string }) {
  const t = useT();
  const labels = useMarkdownLabels();
  const steps = planSteps(plan);
  return (
    <PlanCard label={t("tasks.plan")} {...(steps ? { steps } : {})}>
      <MarkdownView source={plan} size="sm" labels={labels} />
    </PlanCard>
  );
}
