import type { Routine, RoutineRun } from "@apx/protocol";
import { AgentAvatar, Badge, Button, Dialog, EmptyState, IconButton, Icons, Menu, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { aheadLabel, shortWhen } from "../common/format.ts";
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
import { useT } from "../i18n/index.ts";
import { RoutineEditor, scheduleText } from "./RoutineEditor.tsx";

/** A project's routines (the base project shows the global ones). */
export function RoutinesPane({ projectId }: { projectId: string }) {
  const t = useT();
  const all = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  const [editing, setEditing] = useState<RoutineDraft>();
  const [open, setOpen] = useState<string>();
  useEffect(() => {
    void loadRoutines();
  }, []);
  const global = projectId === DEFAULT_PID;
  const list = all.filter((r) => (global ? !r.project_id : r.project_id === projectId));
  const current = list.find((r) => r.id === open);
  const blank: RoutineDraft = {
    name: "",
    agent: "",
    ...(global ? {} : { project: projectId }),
    schedule: { kind: "cron", cron: "0 9 * * *" },
    prompt: "",
    pre_command: "",
    post_command: "",
    call_model: "always",
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
        <ul className="routines">
          {list.map((r) => (
            <RoutineRow key={r.id} routine={r} onOpen={() => setOpen(r.id)} onEdit={() => setEditing(draftOf(r))} />
          ))}
        </ul>
      )}
      {editing && <RoutineEditor draft={editing} onClose={() => setEditing(undefined)} />}
      {current && <RoutineDetail routine={current} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function RoutineRow({ routine: r, onOpen, onEdit }: { routine: Routine; onOpen: () => void; onEdit: () => void }) {
  const t = useT();
  const agent = useData((s) => s.agents[r.agent_id]);
  return (
    <li className="routine">
      <button type="button" className="routine__main" onClick={onOpen}>
        <span className="routine__name">{r.name}</span>
        <span className="taskcard__meta">
          {agent && <AgentAvatar name={agent.name} blob={blobOf(agent)} size={16} />}
          <span>{scheduleText(r.schedule, t)}</span>
          {r.schedule.kind === "cron" && <code className="routine__cron">{r.schedule.cron}</code>}
          {(r.pre_command || r.post_command) && (
            <span className="routine__cmds" title={t("routines.withCommands")}>
              <Icons.Terminal size={12} />
            </span>
          )}
          {r.last && (
            <>
              <LastRun run={r.last} />
              <span>{t("routines.last", { when: shortWhen(r.last.ended_at ?? r.last.started_at) })}</span>
            </>
          )}
          <span className="taskcard__when">
            {!r.enabled
              ? t("routines.off")
              : r.next_run_at
                ? t("routines.next", { when: aheadLabel(r.next_run_at) })
                : r.schedule.kind === "manual"
                  ? ""
                  : t("routines.noNext")}
          </span>
        </span>
      </button>
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
          { label: t("routines.edit"), icon: <Icons.Pencil size={14} />, onSelect: onEdit },
          {
            label: t("routines.remove"),
            icon: <Icons.Trash2 size={14} />,
            danger: true,
            onSelect: () => void removeRoutine(r.id),
          },
        ]}
      />
    </li>
  );
}

function LastRun({ run }: { run: RoutineRun }) {
  const t = useT();
  if (run.state === "failed")
    return (
      <Badge tone="danger" dot>
        {t("routines.failed")}
      </Badge>
    );
  if (run.state !== "completed" && run.state !== "canceled")
    return (
      <Badge tone="info" dot>
        {t("routines.running")}
      </Badge>
    );
  if (run.model_called === false) return <Badge>{t("routines.noModel")}</Badge>;
  return <Badge>{run.delivered === false ? t("routines.quiet") : t("routines.told")}</Badge>;
}

/** A routine: what it asks and its recent runs; a run opens its conversation. */
function RoutineDetail({ routine: r, onClose }: { routine: Routine; onClose: () => void }) {
  const t = useT();
  const [runs, setRuns] = useState<RoutineRun[]>();
  const [shown, setShown] = useState<string>();
  // Read again whenever the latest run starts or ends.
  const latest = `${r.last?.run_id}:${r.last?.state}:${r.last?.delivered}`;
  useEffect(() => {
    void routineRuns(r.id).then((list) => {
      if (!latest) return;
      setRuns(list);
      setShown((s) => s ?? list[0]?.thread_id);
    });
  }, [r.id, latest]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={r.name}>
      <div className="taskdetail">
        <p className="taskdetail__desc">{r.prompt}</p>
        {(r.pre_command || r.post_command) && <Commands routine={r} runs={runs ?? []} />}
        <div className="routine__runs">
          {runs?.map((x) => (
            <button
              type="button"
              key={x.run_id}
              className={x.thread_id === shown ? "routine__run is-on" : "routine__run"}
              onClick={() => setShown(x.thread_id)}
            >
              <span>{shortWhen(x.started_at)}</span>
              <LastRun run={x} />
            </button>
          ))}
          {runs?.length === 0 && <span className="pform__hint">{t("routines.noRuns")}</span>}
        </div>
        {shown && <RunTranscript threadId={shown} />}
      </div>
    </Dialog>
  );
}

/** The routine's commands, and how often its pre-command spared a model call. */
function Commands({ routine: r, runs }: { routine: Routine; runs: RoutineRun[] }) {
  const t = useT();
  const judged = runs.filter((x) => x.model_called !== undefined);
  const skipped = judged.filter((x) => x.model_called === false).length;
  return (
    <div className="routine__pipeline">
      {r.pre_command && (
        <div>
          <span className="pform__label">{t("routines.pre")}</span>
          <pre className="routine__code">{r.pre_command}</pre>
        </div>
      )}
      {r.post_command && (
        <div>
          <span className="pform__label">{t("routines.post")}</span>
          <pre className="routine__code">{r.post_command}</pre>
        </div>
      )}
      {judged.length > 0 && (
        <span className="pform__hint">{t("routines.skippedOf", { n: skipped, m: judged.length })}</span>
      )}
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
