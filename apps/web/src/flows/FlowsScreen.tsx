import { shapeOfDefinition } from "@apx/protocol/flow-shape";
import {
  AgentAvatar,
  Button,
  EmptyState,
  FlowStepTile,
  IconButton,
  Icons,
  RunBars,
  Select,
  Skeleton,
  Switch,
} from "@apx/ui";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useFlowsChanged } from "../data/flowDrafts.ts";
import { blobOf } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { FlowDetail, FlowEditor } from "../lazy.ts";
import { go, useNav } from "../shell/nav.ts";
import { agentOf, issueText, loadFlows, loadRuns, type Published, type Schedules, setEnabled } from "./data.ts";
import { OutwardConfirm } from "./outward.tsx";
import { nextWhen, OUTCOME, outcomeOf, runWhen } from "./run-view.ts";
import { STARTERS, type Starter } from "./starters.ts";
import { chipsOf, type Flow, type FlowRun, isTrigger, STEP, type StepKind, scheduleName } from "./steps.tsx";
import "@apx/ui/flow.css";
import "./flows.css";

/** Flows across projects: a list, a flow's runs, and the full-screen editor, all on this one screen. */
export default function FlowsScreen({ projectId }: { projectId?: string | undefined }) {
  const ready = usePack("flow");
  const flowId = useNav((s) => s.flowId);
  const flowEdit = useNav((s) => s.flowEdit);
  const [data, setData] = useState<Awaited<ReturnType<typeof loadFlows>>>();
  const [failed, setFailed] = useState(false);
  // A new flow's editor, before it has an id to link to.
  const [creating, setCreating] = useState<Starter>();
  // The flow a new editor first saved: the same editor stays open on it, without reloading.
  const [born, setBorn] = useState<string>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    void loadRoutines();
  }, []);
  // A Flow an agent made, or a drawing saved elsewhere, shows in the list as soon as it is saved.
  const elsewhere = useFlowsChanged();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new revision reads the flows again
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadFlows().then(
      (list) => live && setData(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [revision, elsewhere]);
  if (!ready) return <Skeleton width="100%" height={80} />;
  const flows = data?.flows;
  const open = flowId ? flows?.find((f) => f.id === flowId) : undefined;
  // A new flow's editor stays open while its first save comes back as a flow with an id.
  if (creating && open) setCreating(undefined);
  const show = (id?: string, edit = false) => {
    setCreating(undefined);
    setBorn(undefined);
    go.flows(projectId, id, edit);
  };
  return (
    <>
      {open ? (
        <Suspense fallback={<Skeleton width="100%" height="100%" />}>
          <FlowDetail
            key={open.id}
            flow={open}
            schedule={data?.schedules[open.id]}
            timeZone={data?.timeZone ?? "UTC"}
            onBack={() => show()}
            onEdit={() => show(open.id, true)}
            onChanged={refresh}
          />
        </Suspense>
      ) : (
        <FlowList
          flows={flows}
          published={data?.published ?? {}}
          schedules={data?.schedules ?? {}}
          timeZone={data?.timeZone ?? "UTC"}
          failed={failed}
          projectId={projectId}
          revision={revision}
          retry={refresh}
          onOpen={(id) => show(id)}
          onEdit={(id) => show(id, true)}
          onNew={(starter) => {
            setBorn(undefined);
            go.flows(projectId);
            setCreating(starter);
          }}
          onChanged={refresh}
        />
      )}
      {(creating || (open && flowEdit)) && (
        <Suspense fallback={null}>
          <FlowEditor
            key={creating || (born && born === open?.id) ? "new" : open?.id}
            flow={open}
            starter={creating}
            projectId={projectId}
            // A flow saved for the first time closes to its page, even before the list has it back.
            onClose={() => show(open?.id ?? born)}
            onSaved={(id) => {
              if (creating) setBorn(id);
              refresh();
              go.flows(projectId, id, true);
            }}
          />
        </Suspense>
      )}
      <OutwardConfirm />
    </>
  );
}

function FlowList(props: {
  flows: Flow[] | undefined;
  published: Published;
  schedules: Schedules;
  timeZone: string;
  failed: boolean;
  projectId: string | undefined;
  revision: number;
  retry: () => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onNew: (starter: Starter) => void;
  onChanged: () => void;
}) {
  const { flows, projectId } = props;
  const t = useT();
  const projects = useData((s) => s.projects);
  const shown = useMemo(() => flows?.filter((f) => !projectId || f.projectId === projectId), [flows, projectId]);
  const options = [
    { value: "", label: t("flow.allProjects"), hint: String(flows?.length ?? "") },
    ...projects.map((p) => ({
      value: p.id,
      label: p.name,
      hint: String(flows?.filter((f) => f.projectId === p.id).length ?? ""),
    })),
  ];
  return (
    <section className="flows" aria-label={t("flow.title")}>
      <div className="flows__page">
        <header className="flows__head">
          <div className="flows__intro">
            <h1 className="flows__title">{t("flow.title")}</h1>
            <p className="flows__lead">{t("flow.lead")}</p>
          </div>
          <div className="flows__tools">
            <Select
              label={t("flow.projectFilter")}
              value={projectId ?? ""}
              onValueChange={(v) => go.flows(v || undefined)}
              options={options}
            />
            <Button leadingIcon={<Icons.Plus size={14} />} onClick={() => props.onNew(STARTERS.blank)}>
              {t("flow.new")}
            </Button>
          </div>
        </header>
        {props.failed ? (
          <EmptyState
            variant="dashed"
            icon={<Icons.TriangleAlert />}
            title={t("flow.loadFailed")}
            action={
              <Button size="sm" variant="secondary" onClick={props.retry}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : !shown ? (
          <Skeleton width="100%" height={160} />
        ) : shown.length === 0 ? (
          <Starters project={Boolean(projectId)} onNew={props.onNew} />
        ) : (
          <div className="flowlist">
            <div className="flowlist__head" aria-hidden="true">
              <span>{t("flow.col.flow")}</span>
              <span>{t("flow.col.steps")}</span>
              <span>{t("flow.col.model")}</span>
              <span>{t("flow.col.runs")}</span>
              <span>{t("flow.col.next")}</span>
              <span />
            </div>
            <ul className="flowlist__rows">
              {shown.map((f) => (
                <FlowRow
                  key={f.id}
                  flow={f}
                  kinds={props.published[f.id]?.kinds}
                  schedule={props.schedules[f.id]}
                  timeZone={props.timeZone}
                  revision={props.revision}
                  onOpen={() => props.onOpen(f.id)}
                  onEdit={() => props.onEdit(f.id)}
                  onChanged={props.onChanged}
                />
              ))}
            </ul>
            <div className="flowlist__legend">
              <span>
                <span className="apx-runbars__bar" /> {t("flow.legend.ran")}
              </span>
              <span>
                <span className="apx-runbars__bar apx-runbars__bar--cut" /> {t("flow.legend.cut")}
              </span>
              <span>
                <span className="apx-runbars__bar apx-runbars__bar--failed" /> {t("flow.legend.failed")}
              </span>
              <span className="flowlist__spacer" />
              <Button variant="link" size="sm" onClick={() => go.config("devices")}>
                {t("flow.access")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Starters({ project, onNew }: { project: boolean; onNew: (s: Starter) => void }) {
  const t = useT();
  return (
    <div className="flows__empty">
      <span className="flows__emptyart" aria-hidden="true">
        <FlowStepTile icon={STEP.webhook.icon} tone="warning" size="lg" />
        <span />
        <FlowStepTile icon={STEP.table_write.icon} tone="info" size="lg" />
        <span />
        <FlowStepTile icon={STEP.agent.icon} tone="violet" size="lg" />
      </span>
      <div className="flows__emptytext">
        <h2>{t(project ? "flow.emptyProject" : "flow.emptyTitle")}</h2>
        <p>{t("flow.emptyBody")}</p>
      </div>
      <div className="flows__starters">
        {Object.values(STARTERS).map((s) => (
          <button key={s.title} type="button" className="flows__starter" onClick={() => onNew(s)}>
            <span className="flows__chips">
              {s.kinds.map((k) => (
                <FlowStepTile key={k} icon={STEP[k].icon} tone={STEP[k].tone} size="sm" />
              ))}
              {!s.kinds.length && <FlowStepTile icon={<Icons.Plus />} size="sm" />}
            </span>
            <span className="flows__startertext">
              <strong>{t(s.title)}</strong>
              <span>{t(s.body)}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="link" size="sm" onClick={() => go.config("devices")}>
        {t("flow.access")}
      </Button>
    </div>
  );
}

function FlowRow(props: {
  flow: Flow;
  /** A published drawing's step kinds, in the order they run; its old definition says nothing then. */
  kinds: string[] | undefined;
  /** Its schedule and next time, when it starts on one. */
  schedule: Schedules[string] | undefined;
  timeZone: string;
  revision: number;
  onOpen: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { flow } = props;
  const t = useT();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const routines = useRoutines((s) => s.routines);
  const [runs, setRuns] = useState<FlowRun[]>();
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new revision reads the runs again
  useEffect(() => {
    let live = true;
    void loadRuns(flow.id).then(
      (r) => live && setRuns(r.events),
      () => live && setRuns([]),
    );
    return () => {
      live = false;
    };
  }, [flow.id, props.revision]);
  const drawn = props.kinds?.filter((k): k is StepKind => !isTrigger(k) && k in STEP);
  const { schedule } = props;
  const chips = drawn ?? chipsOf(shapeOfDefinition(flow));
  const crew = drawn?.filter((k) => k === "agent" || k === "routine" || k === "llm").length;
  const agent = drawn ? undefined : agentOf(flow.action, agents, routines);
  const who = drawn
    ? crew
      ? t("flow.crewSteps", { count: crew })
      : undefined
    : flow.action.kind === "agent"
      ? (agent?.name ?? flow.action.agent)
      : flow.action.kind === "routine"
        ? (routines.find((r) => r.id === (flow.action as { routine: string }).routine)?.name ?? flow.action.routine)
        : undefined;
  const last = runs?.[0];
  const lastOutcome = last ? outcomeOf(last, flow.predicates.length) : undefined;
  const project = projects.find((p) => p.id === flow.projectId)?.name ?? flow.projectId;
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await setEnabled(flow, on);
      props.onChanged();
    } catch (e) {
      notify(issueText(e, undefined, t) ?? t("flow.ed.saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={flow.enabled ? "flowrow" : "flowrow is-off"}>
      <button type="button" className="flowrow__open" onClick={props.onOpen}>
        <span className="flowrow__name">
          <FlowStepTile icon={STEP[schedule ? "schedule" : "webhook"].icon} tone="warning" size="lg" />
          <span className="flowrow__text">
            <strong>{flow.name}</strong>
            <span>
              {project} · {schedule ? scheduleName(schedule.cron, t) : t("flow.kind.webhook")}
            </span>
          </span>
        </span>
        <span className="flowrow__chips">
          {chips.map((k, i) => (
            // Chips are positions in the chain.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional
            <FlowStepTile key={i} icon={STEP[k].icon} tone={STEP[k].tone} size="sm" label={t(STEP[k].label)} />
          ))}
        </span>
        <span className="flowrow__model">
          {who ? (
            <>
              {!drawn && <AgentAvatar name={agent?.name ?? who} blob={blobOf(agent)} size={20} animated={false} />}
              <span>{who}</span>
            </>
          ) : (
            <span className="flowrow__muted">{t("flow.noModel")}</span>
          )}
        </span>
        <span className="flowrow__runs">
          {runs?.length ? (
            <RunBars
              label={t("flow.runsLast")}
              runs={[...runs].reverse().map((e) => {
                const o = outcomeOf(e, flow.predicates.length);
                return {
                  id: e.event_id,
                  state: OUTCOME[o].bar,
                  label: `${runWhen(e.created_at)} · ${t(OUTCOME[o].label)}`,
                };
              })}
            />
          ) : (
            <span className="flowrow__muted">{runs ? t("flow.noRuns") : ""}</span>
          )}
        </span>
        <span className="flowrow__next">
          <span>
            {!flow.enabled
              ? t("flow.off")
              : schedule
                ? schedule.next_at
                  ? nextWhen(schedule.next_at, props.timeZone, t)
                  : t("flow.next.none")
                : t("flow.nextHook")}
          </span>
          {last && (
            <span className={lastOutcome === "failed" ? "flowrow__last is-failed" : "flowrow__last"}>
              {t("flow.last", { when: runWhen(last.created_at) })}
            </span>
          )}
        </span>
      </button>
      <span className="flowrow__actions">
        <Switch
          aria-label={t("flow.toggle", { name: flow.name })}
          checked={flow.enabled}
          disabled={busy}
          onCheckedChange={(on) => void toggle(on)}
        />
        <IconButton
          label={t("flow.edit")}
          icon={<Icons.Pencil size={14} />}
          variant="secondary"
          onClick={props.onEdit}
        />
      </span>
    </li>
  );
}
