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
import { blobOf } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { FlowDetail, FlowEditor } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { agentOf, loadFlows, loadRuns, setEnabled } from "./data.ts";
import { OUTCOME, outcomeOf, runWhen } from "./run-view.ts";
import { STARTERS, type Starter } from "./starters.ts";
import { chipsOf, type Flow, type FlowRun, STEP } from "./steps.tsx";
import "@apx/ui/flow.css";
import "./flows.css";

type Screen = { kind: "list" } | { kind: "detail"; id: string } | { kind: "editor"; id?: string; starter?: Starter };

/** Flows across projects: a list, a flow's runs, and the full-screen editor, all on this one screen. */
export default function FlowsScreen({ projectId }: { projectId?: string | undefined }) {
  const ready = usePack("flow");
  const [flows, setFlows] = useState<Flow[]>();
  const [failed, setFailed] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    void loadRoutines();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new revision reads the flows again
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadFlows().then(
      (list) => live && setFlows(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [revision]);
  if (!ready) return <Skeleton width="100%" height={80} />;
  const open = screen.kind !== "list" && screen.id ? flows?.find((f) => f.id === screen.id) : undefined;
  return (
    <>
      {open ? (
        <Suspense fallback={<Skeleton width="100%" height="100%" />}>
          <FlowDetail
            key={open.id}
            flow={open}
            onBack={() => setScreen({ kind: "list" })}
            onEdit={() => setScreen({ kind: "editor", id: open.id })}
            onChanged={refresh}
          />
        </Suspense>
      ) : (
        <FlowList
          flows={flows}
          failed={failed}
          projectId={projectId}
          revision={revision}
          retry={refresh}
          onOpen={(id) => setScreen({ kind: "detail", id })}
          onEdit={(id) => setScreen({ kind: "editor", id })}
          onNew={(starter) => setScreen({ kind: "editor", starter })}
          onChanged={refresh}
        />
      )}
      {screen.kind === "editor" && (
        <Suspense fallback={null}>
          <FlowEditor
            flow={open}
            starter={screen.starter}
            projectId={projectId}
            onClose={() => setScreen(open ? { kind: "detail", id: open.id } : { kind: "list" })}
            onSaved={(id) => {
              refresh();
              setScreen({ kind: "editor", id });
            }}
          />
        </Suspense>
      )}
    </>
  );
}

function FlowList(props: {
  flows: Flow[] | undefined;
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
  const shape = shapeOfDefinition(flow);
  const agent = agentOf(flow.action, agents, routines);
  const who =
    flow.action.kind === "agent"
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
    } catch {
      notify(t("flow.ed.saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={flow.enabled ? "flowrow" : "flowrow is-off"}>
      <button type="button" className="flowrow__open" onClick={props.onOpen}>
        <span className="flowrow__name">
          <FlowStepTile icon={STEP.webhook.icon} tone="warning" size="lg" />
          <span className="flowrow__text">
            <strong>{flow.name}</strong>
            <span>
              {project} · {t("flow.kind.webhook")}
            </span>
          </span>
        </span>
        <span className="flowrow__chips">
          {chipsOf(shape).map((k, i) => (
            // Chips are positions in the chain.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional
            <FlowStepTile key={i} icon={STEP[k].icon} tone={STEP[k].tone} size="sm" label={t(STEP[k].label)} />
          ))}
        </span>
        <span className="flowrow__model">
          {who ? (
            <>
              <AgentAvatar name={agent?.name ?? who} blob={blobOf(agent)} size={20} animated={false} />
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
          <span>{t(flow.enabled ? "flow.nextHook" : "flow.off")}</span>
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
