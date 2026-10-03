import type { Routine, RoutineRun } from "@apx/protocol";
import { AgentAvatar, Badge, Button, EmptyState, IconButton, Icons, Menu, Switch } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { aheadLabel, formatSeconds, shortWhen } from "../common/format.ts";
import { loadThread } from "../data/actions.ts";
import { blobOf, DEFAULT_PID } from "../data/identity.ts";
import {
  draftOf,
  loadRoutines,
  type RoutineDraft,
  removeRoutine,
  routineRuns,
  runRoutine,
  saveRoutine,
  useRoutines,
} from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { RoutineEditor } from "./RoutineEditor.tsx";
import { scheduleText } from "./Schedule.tsx";

const CALL_KEY: Record<Routine["call_model"], MessageKey> = {
  always: "routines.call.always",
  output: "routines.call.output",
  fails: "routines.call.fails",
  never: "routines.call.never",
};
const ACTION_KEY: Record<Routine["action"], MessageKey> = {
  agent: "routines.action.agent",
  message: "routines.action.message",
  shell: "routines.action.shell",
  watch: "routines.action.watch",
};
/** An agent answers (agent) or watches (watch): both have one, and both can spare a model call. */
const hasAgent = (a: Routine["action"]) => a === "agent" || a === "watch";

/**
 * A project's routines (the base project shows the global ones), one row each: what it does as a flow, its last
 * activations as bars, when it runs next. A row opens in place: how it is set up, its prompt and its activations.
 */
export function RoutinesPane({ projectId }: { projectId: string }) {
  const t = useT();
  const all = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  const agents = useData((s) => s.agents);
  const [editing, setEditing] = useState<RoutineDraft>();
  const [open, setOpen] = useState<string>();
  useEffect(() => {
    void loadRoutines();
  }, []);
  const global = projectId === DEFAULT_PID;
  const list = all.filter((r) => (global ? !r.project_id : r.project_id === projectId));
  const blank: RoutineDraft = {
    name: "",
    agent: "",
    ...(global ? {} : { project: projectId }),
    schedule: { kind: "cron", cron: "0 9 * * *" },
    action: "agent",
    prompt: "",
    pre_command: "",
    post_command: "",
    call_model: "always",
    anchor: false,
    enabled: true,
  };

  return (
    <div className="board">
      <div className="board__head">
        <p className="config__lead">{t("routines.lead")}</p>
        <span className="board__spacer" />
        <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setEditing(blank)}>
          {t("routines.new")}
        </Button>
      </div>
      {ready && !list.length ? (
        <EmptyState variant="dashed" size="lg" icon={<Icons.Clock />} title={t("routines.emptyTitle")}>
          {t("routines.empty")}
        </EmptyState>
      ) : (
        <section className="rtlist" aria-label={t("routines.title")}>
          <div className="rtlist__head" aria-hidden="true">
            <span>{t("routines.col.routine")}</span>
            <span>{t("routines.col.flow")}</span>
            <span>{t("routines.col.activations")}</span>
            <span>{t("routines.col.next")}</span>
            <span />
          </div>
          {list.map((r) => (
            <RoutineRow
              key={r.id}
              routine={r}
              agentName={agents[r.agent_id]?.name ?? r.agent_id}
              open={open === r.id}
              onToggle={() => setOpen(open === r.id ? undefined : r.id)}
              onEdit={() => setEditing(draftOf(r))}
            />
          ))}
          <div className="rtlist__legend">
            <span className="rtbar is-ran" /> {t("routines.legend.ran")}
            <span className="rtbar is-skipped" /> {t("routines.legend.skipped")}
            <span className="rtbar is-failed" /> {t("routines.legend.failed")}
          </div>
        </section>
      )}
      {editing && <RoutineEditor draft={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

/** The bar of one activation: the action ran, it was skipped (no tokens spent), or it failed. */
const barOf = (x: RoutineRun, action: Routine["action"]) => {
  if (x.state === "failed") return "is-failed";
  if (x.state !== "completed" && x.state !== "canceled") return "is-live";
  // A message or a shell job never calls a model: it ran when it sent or ran its command.
  const skipped = hasAgent(action) ? x.model_called === false : action === "message" && !x.delivered;
  return skipped ? "is-skipped" : "is-ran";
};

function useRuns(r: Routine) {
  const [runs, setRuns] = useState<RoutineRun[]>();
  // Read again whenever the latest run starts or ends.
  const latest = `${r.last?.run_id}:${r.last?.state}:${r.last?.delivered}`;
  useEffect(() => {
    let live = true;
    void routineRuns(r.id).then((list) => live && latest && setRuns(list));
    return () => {
      live = false;
    };
  }, [r.id, latest]);
  return runs;
}

function RoutineRow(props: {
  routine: Routine;
  agentName: string;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const { routine: r } = props;
  const agent = useData((s) => s.agents[r.agent_id]);
  const runs = useRuns(r);
  const flow = [
    r.pre_command && (r.action === "shell" ? t("routines.flow.command") : t("routines.flow.pre")),
    r.action === "agent"
      ? props.agentName
      : r.action === "watch"
        ? t("routines.flow.watch", { agent: props.agentName })
        : r.action === "message"
          ? t("routines.flow.message")
          : undefined,
    r.post_command && t("routines.flow.post"),
  ].filter(Boolean);
  return (
    <div className={`rtrow${props.open ? " is-open" : ""}${r.enabled ? "" : " is-off"}`}>
      <div className="rtrow__line">
        <button type="button" className="rtrow__main" aria-expanded={props.open} onClick={props.onToggle}>
          {hasAgent(r.action) && agent ? (
            <AgentAvatar name={agent.name} blob={blobOf(agent)} size={28} animated={false} />
          ) : (
            <span className="rtrow__icon">
              {r.action === "message" ? <Icons.Send size={14} /> : <Icons.Terminal size={14} />}
            </span>
          )}
          <span className="rtrow__names">
            <span className="rtrow__name">{r.name}</span>
            <span className="rtrow__when">{scheduleText(r.schedule, t)}</span>
          </span>
        </button>
        <span className="rtrow__flow">{flow.join(" → ")}</span>
        <span className="rtrow__bars" title={t("routines.col.activations")}>
          {(runs ?? [])
            .slice(0, 14)
            .reverse()
            .map((x) => (
              <span
                key={x.run_id}
                className={`rtbar ${barOf(x, r.action)}`}
                title={`${shortWhen(x.started_at)} · ${t(barKey(x, r.action))}`}
              />
            ))}
        </span>
        <span className="rtrow__next">
          <span>
            {!r.enabled
              ? t("routines.off")
              : r.next_run_at
                ? aheadLabel(r.next_run_at)
                : r.schedule.kind === "manual"
                  ? t("routines.manual")
                  : t("routines.noNext")}
          </span>
          {r.last && <span className="rtrow__last">{t("routines.last", { when: shortWhen(r.last.started_at) })}</span>}
        </span>
        <span className="rtrow__actions">
          <Switch
            size="sm"
            checked={r.enabled}
            aria-label={t("routines.enabled")}
            onCheckedChange={(on) => void saveRoutine({ ...draftOf(r), enabled: on })}
          />
          <IconButton
            size="sm"
            label={t("routines.runNow")}
            icon={<Icons.Play size={14} />}
            onClick={() => void runRoutine(r.id)}
          />
          <Menu
            align="end"
            trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={14} />} />}
            items={[
              { label: t("routines.edit"), icon: <Icons.Pencil size={14} />, onSelect: props.onEdit },
              { type: "separator" },
              {
                label: t("routines.remove"),
                icon: <Icons.Trash2 size={14} />,
                danger: true,
                onSelect: () => void removeRoutine(r.id),
              },
            ]}
          />
        </span>
      </div>
      {props.open && <RoutineDetail routine={r} agentName={props.agentName} runs={runs} onEdit={props.onEdit} />}
    </div>
  );
}

const BAR_KEY: Record<ReturnType<typeof barOf>, MessageKey> = {
  "is-failed": "routines.legend.failed",
  "is-skipped": "routines.legend.skipped",
  "is-ran": "routines.legend.ran",
  "is-live": "routines.running",
};
const barKey = (x: RoutineRun, action: Routine["action"]): MessageKey => BAR_KEY[barOf(x, action)];

/** How it is set up (trigger · before · action · after), its prompt, and its activations; one opens its run. */
function RoutineDetail(props: {
  routine: Routine;
  agentName: string;
  runs: RoutineRun[] | undefined;
  onEdit: () => void;
}) {
  const t = useT();
  const { routine: r, runs } = props;
  const [shown, setShown] = useState<string>();
  // Only an agent's routine can spare a model call; a message or a shell job never makes one.
  const judged = hasAgent(r.action) ? (runs ?? []).filter((x) => x.model_called !== undefined) : [];
  const skipped = judged.filter((x) => x.model_called === false).length;
  return (
    <div className="rtdetail">
      <div className="rtdetail__cards">
        <Card icon={<Icons.Clock size={13} />} label={t("routines.card.trigger")} title={scheduleText(r.schedule, t)}>
          {r.schedule.kind === "cron" && <code>{r.schedule.cron}</code>}
        </Card>
        {r.pre_command && r.action !== "shell" && (
          <Card
            icon={<Icons.Terminal size={13} />}
            label={t("routines.card.before")}
            title={t("routines.card.command")}
          >
            <code>{r.pre_command}</code>
          </Card>
        )}
        <Card
          icon={
            r.action === "agent" ? (
              <Icons.Bot size={13} />
            ) : r.action === "watch" ? (
              <Icons.Eye size={13} />
            ) : r.action === "message" ? (
              <Icons.Send size={13} />
            ) : (
              <Icons.Terminal size={13} />
            )
          }
          label={t("routines.card.action", { action: t(ACTION_KEY[r.action]) })}
          title={
            r.action === "agent"
              ? t("routines.card.agentAnswers", { agent: props.agentName })
              : r.action === "watch"
                ? t("routines.card.watches", { agent: props.agentName })
                : r.action === "message"
                  ? t("routines.card.messageSent")
                  : t("routines.card.commandRuns")
          }
          strong
        >
          {r.action === "shell" ? <code>{r.pre_command}</code> : <span className="rtdetail__clip">{r.prompt}</span>}
          {r.pre_command && r.action !== "shell" && r.action !== "watch" && (
            <Badge>{t("routines.card.cond", { cond: t(CALL_KEY[r.call_model]) })}</Badge>
          )}
        </Card>
        {r.post_command && (
          <Card icon={<Icons.Terminal size={13} />} label={t("routines.card.after")} title={t("routines.card.command")}>
            <code>{r.post_command}</code>
          </Card>
        )}
      </div>
      {r.action !== "shell" && (
        <div className="rtdetail__prompt">
          <span className="rtdetail__label">
            {r.action === "message" ? t("routines.step.message") : t("routines.prompt")}
          </span>
          <p>{r.prompt}</p>
        </div>
      )}
      <div className="rtdetail__runs">
        <div className="rtdetail__runshead">
          <span className="rtdetail__label">{t("routines.activations")}</span>
          {judged.length > 0 && (
            <span className="rtdetail__skipped">{t("routines.skippedOf", { n: skipped, m: judged.length })}</span>
          )}
          <span className="board__spacer" />
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={13} />} onClick={props.onEdit}>
            {t("routines.edit")}
          </Button>
        </div>
        {runs?.length === 0 && <p className="rtdetail__empty">{t("routines.noRuns")}</p>}
        {runs?.map((x) => (
          <button
            key={x.run_id}
            type="button"
            className={`rtrun${shown === x.thread_id ? " is-on" : ""}`}
            onClick={() => setShown(shown === x.thread_id ? undefined : x.thread_id)}
          >
            <span className={`rtbar ${barOf(x, r.action)}`} />
            <span className="rtrun__when">{shortWhen(x.started_at)}</span>
            <Badge tone={x.state === "failed" ? "danger" : barOf(x, r.action) === "is-skipped" ? "neutral" : "brand"}>
              {t(barKey(x, r.action))}
            </Badge>
            {x.delivered && <Badge tone="info">{t("routines.told")}</Badge>}
            <span className="board__spacer" />
            {x.ended_at && (
              <span className="rtrun__dur">
                {formatSeconds((Date.parse(x.ended_at) - Date.parse(x.started_at)) / 1000)}
              </span>
            )}
          </button>
        ))}
        {shown && <RunTranscript threadId={shown} />}
      </div>
    </div>
  );
}

function Card(props: { icon: ReactNode; label: string; title: string; strong?: boolean; children?: ReactNode }) {
  return (
    <div className={`rtcard${props.strong ? " is-strong" : ""}`}>
      <span className="rtcard__label">
        {props.icon}
        {props.label}
      </span>
      <span className="rtcard__title">{props.title}</span>
      {props.children && <span className="rtcard__body">{props.children}</span>}
    </div>
  );
}

function RunTranscript({ threadId }: { threadId: string }) {
  const thread = useData((s) => s.threads[threadId]);
  const load = useData((s) => s.threadLoad[threadId]);
  useEffect(() => {
    if (load == null) void loadThread(threadId);
  }, [load, threadId]);
  return <div className="taskdetail__chat">{thread && load === "ready" && <Transcript thread={thread} />}</div>;
}
