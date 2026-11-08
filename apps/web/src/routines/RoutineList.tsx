import type { Routine } from "@apx/protocol";
import { AgentAvatar, IconButton, Icons, Menu, Switch } from "@apx/ui";
import type { ReactNode } from "react";
import { aheadLabel, shortWhen } from "../common/format.ts";
import { blobOf } from "../data/identity.ts";
import { draftOf, removeRoutine, runRoutine, saveRoutine } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ActivationBars, hasAgent, useRuns } from "./ActivationBars.tsx";
import { scheduleText } from "./Schedule.tsx";

export type RoutineGroup = { id: string; title?: ReactNode; routines: Routine[] };

/**
 * Routines as a table, one row each (what it does as a flow, its last activations, when it runs next), in groups
 * with a title when there is more than one (a project's routines on the Routines screen), and the bars' legend.
 */
export function RoutineList({
  groups,
  open,
  onOpen,
  onEdit,
}: {
  groups: RoutineGroup[];
  open: string | undefined;
  onOpen(id: string): void;
  onEdit(routine: Routine): void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  return (
    <section className="rtlist" aria-label={t("routines.title")}>
      <div className="rtlist__head" aria-hidden="true">
        <span>{t("routines.col.routine")}</span>
        <span>{t("routines.col.flow")}</span>
        <span>{t("routines.col.activations")}</span>
        <span>{t("routines.col.next")}</span>
        <span />
      </div>
      {groups.map((g) => (
        <div key={g.id} className="rtlist__group">
          {g.title != null && <div className="rtlist__grouphead">{g.title}</div>}
          {g.routines.map((r) => (
            <RoutineRow
              key={r.id}
              routine={r}
              agentName={agents[r.agent_id]?.name ?? r.agent_id}
              open={open === r.id}
              onOpen={() => onOpen(r.id)}
              onEdit={() => onEdit(r)}
            />
          ))}
        </div>
      ))}
      <div className="rtlist__legend">
        <span className="rtbar is-ran" /> {t("routines.legend.ran")}
        <span className="rtbar is-told" /> {t("routines.legend.told")}
        <span className="rtbar is-skipped" /> {t("routines.legend.skipped")}
        <span className="rtbar is-failed" /> {t("routines.legend.failed")}
        <span className="rtbar is-none" /> {t("routines.legend.none")}
      </div>
    </section>
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
