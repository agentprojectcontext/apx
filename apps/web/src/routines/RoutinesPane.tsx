import type { Routine } from "@apx/protocol";
import { AgentAvatar, Button, EmptyState, IconButton, Icons, Menu, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { aheadLabel, shortWhen } from "../common/format.ts";
import { blobOf, DEFAULT_PID } from "../data/identity.ts";
import {
  draftOf,
  loadRoutines,
  type RoutineDraft,
  removeRoutine,
  runRoutine,
  saveRoutine,
  useRoutines,
} from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ActivationBars, hasAgent, useRuns } from "./ActivationBars.tsx";
import { RoutineDrawer } from "./RoutineDrawer.tsx";
import { RoutineEditor } from "./RoutineEditor.tsx";
import { scheduleText } from "./Schedule.tsx";

/**
 * A project's routines (the base project shows the global ones), one row each: what it does as a flow, its last
 * activations as a row of bars, when it runs next. A row opens its detail in a drawer at the right.
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
  const current = list.find((r) => r.id === open);
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
    max_steps: "",
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
              onOpen={() => setOpen(open === r.id ? undefined : r.id)}
              onEdit={() => setEditing(draftOf(r))}
            />
          ))}
          <div className="rtlist__legend">
            <span className="rtbar is-ran" /> {t("routines.legend.ran")}
            <span className="rtbar is-told" /> {t("routines.legend.told")}
            <span className="rtbar is-skipped" /> {t("routines.legend.skipped")}
            <span className="rtbar is-failed" /> {t("routines.legend.failed")}
            <span className="rtbar is-none" /> {t("routines.legend.none")}
          </div>
        </section>
      )}
      {current && (
        <RoutineDrawer
          key={current.id}
          routine={current}
          agentName={agents[current.agent_id]?.name ?? current.agent_id}
          onEdit={() => setEditing(draftOf(current))}
          onClose={() => setOpen(undefined)}
        />
      )}
      {editing && <RoutineEditor draft={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function RoutineRow(props: {
  routine: Routine;
  agentName: string;
  open: boolean;
  onOpen: () => void;
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
        : r.action === "relay"
          ? t("routines.flow.relay", { agent: props.agentName })
          : r.action === "mail"
            ? t("routines.flow.mail", { agent: props.agentName })
            : r.action === "message"
              ? t("routines.flow.message")
              : undefined,
    r.post_command && t("routines.flow.post"),
  ].filter(Boolean);
  return (
    <div className={`rtrow${props.open ? " is-open" : ""}${r.enabled ? "" : " is-off"}`}>
      <div className="rtrow__line">
        <button type="button" className="rtrow__main" aria-pressed={props.open} onClick={props.onOpen}>
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
        <ActivationBars routine={r} runs={runs} />
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
    </div>
  );
}
