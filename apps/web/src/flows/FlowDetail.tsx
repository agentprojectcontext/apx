import type { Result } from "@apx/protocol";
import {
  Badge,
  Button,
  FlowStepTile,
  IconButton,
  Icons,
  ResizeHandle,
  RunBars,
  SegmentedControl,
  Skeleton,
  Switch,
} from "@apx/ui";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { loadRuns, type Shown, setEnabled, shownGraph, whoOf } from "./data.ts";
import { FlowCanvas, type StepLook } from "./FlowCanvas.tsx";
import { stepDetail } from "./look.tsx";
import { logClock, OUTCOME, outcomeOf, runFacts, runWhen, tokens, viewRun } from "./run-view.ts";
import { type Flow, type FlowNode, type FlowRun, hookPath, STEP } from "./steps.tsx";
import "./detail.css";

type Cursor = Result<"flows.events">["nextCursor"];
const RAIL = { min: 260, max: 640, initial: 360 };

/** One flow: its steps as they ran in the chosen run, what each step did, and its runs at the right. */
export function FlowDetail({
  flow,
  onBack,
  onEdit,
  onChanged,
}: {
  flow: Flow;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const agents = useData((s) => s.agents);
  const routines = useRoutines((s) => s.routines);
  const [shown, setShown] = useState<Shown>();
  const [runs, setRuns] = useState<FlowRun[]>();
  const [cursor, setCursor] = useState<Cursor>(null);
  const [runId, setRunId] = useState<string>();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"step" | "run">("step");
  const [rail, setRail] = useState({ open: true, width: RAIL.initial });
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void shownGraph(flow, t).then((s) => live && setShown(s));
    return () => {
      live = false;
    };
  }, [flow, t]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new revision reads the runs again
  useEffect(() => {
    let live = true;
    void loadRuns(flow.id, 50).then(
      (page) => {
        if (!live) return;
        setRuns(page.events);
        setCursor(page.nextCursor);
        setRunId((cur) => (cur && page.events.some((e) => e.event_id === cur) ? cur : page.events[0]?.event_id));
      },
      () => live && setRuns([]),
    );
    return () => {
      live = false;
    };
  }, [flow.id, revision]);
  // A run still going is read again until it ends.
  const going = runs?.some((e) => e.state === "pending" || (e.state === "admitted" && !e.run_ended_at));
  // biome-ignore lint/correctness/useExhaustiveDependencies: each load of the runs arms the next read
  useEffect(() => {
    if (!going) return;
    const timer = setTimeout(() => setRevision((n) => n + 1), 3000);
    return () => clearTimeout(timer);
  }, [going, runs]);
  const run = runs?.find((e) => e.event_id === runId);
  const who = useCallback((n: FlowNode) => whoOf(n, agents, routines), [agents, routines]);
  const view = useMemo(
    () => (shown ? viewRun(shown.graph, flow.id, run, t, who) : undefined),
    [shown, flow.id, run, t, who],
  );
  const look = useCallback(
    (n: FlowNode): StepLook => {
      const v = view?.steps.get(n.id);
      return {
        title: n.label,
        ...stepDetail(n, flow.id, agents, routines),
        ...(v?.state ? { state: v.state } : {}),
        ...(v?.order ? { order: v.order } : {}),
        ...(v?.badge ? { badge: v.badge } : {}),
      };
    },
    [view, flow.id, agents, routines],
  );
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await setEnabled(flow, on);
      onChanged();
    } catch {
      notify(t("flow.ed.saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  const older = async () => {
    if (!cursor) return;
    const page = await loadRuns(flow.id, 50, cursor);
    setRuns((cur) => [...(cur ?? []), ...page.events]);
    setCursor(page.nextCursor);
  };
  const project = projects.find((p) => p.id === flow.projectId)?.name ?? flow.projectId;
  const outcome = run ? outcomeOf(run, flow.predicates.length) : undefined;
  const facts = run ? runFacts(run, t) : undefined;
  // Until one is chosen, the step that hands work to the crew (or the last one) is open.
  const node =
    shown?.graph.nodes.find((n) => n.id === nodeId) ??
    shown?.graph.nodes.find((n) => n.kind === "agent" || n.kind === "routine") ??
    shown?.graph.nodes.at(-1);
  return (
    <div className="fd">
      <div className="fd__main">
        <header className="fd__head">
          <IconButton label={t("flow.back")} icon={<Icons.ArrowLeft size={16} />} onClick={onBack} />
          <FlowStepTile icon={STEP.webhook.icon} tone="warning" size="lg" />
          <div className="fd__name">
            <h1>{flow.name}</h1>
            <span>
              {project} · {t("flow.triggerHook", { path: hookPath(flow.id) })} ·{" "}
              {t("flow.steps", { count: shown?.graph.nodes.length ?? "…" })}
            </span>
          </div>
          <div className="fd__tools">
            <span className="fd__on">{t(flow.enabled ? "flow.on" : "flow.off")}</span>
            <Switch
              aria-label={t("flow.toggle", { name: flow.name })}
              checked={flow.enabled}
              disabled={busy}
              onCheckedChange={(on) => void toggle(on)}
            />
            <Button variant="primary" leadingIcon={<Icons.Pencil size={14} />} onClick={onEdit}>
              {t("flow.edit")}
            </Button>
          </div>
        </header>
        {run && outcome && (
          <div className="fd__runline">
            <strong>{t("flow.runAt", { when: runWhen(run.created_at) })}</strong>
            <Badge tone={OUTCOME[outcome].tone === "neutral" ? "neutral" : OUTCOME[outcome].tone}>
              {t(OUTCOME[outcome].label)}
            </Badge>
            {facts?.took && <span>{facts.took}</span>}
            {facts?.tokens && <span>{facts.tokens}</span>}
            {view && shown && <span>{t("flow.stepsRan", { ran: view.ran, total: shown.graph.nodes.length })}</span>}
          </div>
        )}
        {shown?.draftPending && <p className="fd__draft">{t("flow.draftPending")}</p>}
        <div className="fd__canvas">
          {shown ? (
            <FlowCanvas
              graph={shown.graph}
              look={look}
              selected={node?.id ?? null}
              onSelect={(id) => {
                if (!id) return;
                setNodeId(id);
                setTab("step");
              }}
              fitKey={flow.id}
            >
              {run && (
                <div className="fd__legend" aria-hidden="true">
                  <span className="is-ran">{t("flow.legend.stepRan")}</span>
                  <span className="is-skipped">{t("flow.legend.stepSkipped")}</span>
                  <span className="is-failed">{t("flow.legend.stepFailed")}</span>
                </div>
              )}
              <span className="fd__version">{t("flow.current")}</span>
            </FlowCanvas>
          ) : (
            <Skeleton width="100%" height="100%" />
          )}
        </div>
        <StepPanel
          flow={flow}
          nodes={shown?.graph.nodes ?? []}
          node={node}
          run={run}
          view={view}
          tab={tab}
          setTab={setTab}
          reload={() => setRevision((n) => n + 1)}
        />
      </div>
      {rail.open ? (
        <aside
          className="fd__rail"
          style={{ "--fd-rail": `${rail.width}px` } as CSSProperties}
          aria-label={t("flow.runs")}
        >
          <ResizeHandle
            edge="left"
            width={rail.width}
            min={RAIL.min}
            max={RAIL.max}
            onResize={(width) => setRail({ open: true, width })}
            onReset={() => setRail({ open: true, width: RAIL.initial })}
            label={t("flow.resizeRuns")}
          />
          <div className="fd__railhead">
            <div className="fd__railtitle">
              <h2>{t("flow.runs")}</h2>
              <span>{runs?.length ?? ""}</span>
              <span className="fd__spacer" />
              <IconButton
                label={t("flow.hideRuns")}
                icon={<Icons.ChevronRight size={16} />}
                onClick={() => setRail((r) => ({ ...r, open: false }))}
              />
            </div>
            <span className="fd__railnext">{flow.enabled ? t("flow.nextWhen") : t("flow.off")}</span>
            {runs && runs.length > 0 && (
              <RunBars
                size="lg"
                label={t("flow.runsLast")}
                selected={runId}
                onSelect={setRunId}
                runs={runs
                  .slice(0, 24)
                  .reverse()
                  .map((e) => {
                    const o = outcomeOf(e, flow.predicates.length);
                    return {
                      id: e.event_id,
                      state: OUTCOME[o].bar,
                      label: `${runWhen(e.created_at)} · ${t(OUTCOME[o].label)}`,
                    };
                  })}
              />
            )}
          </div>
          <div className="fd__runs">
            {runs?.length === 0 && <p className="fd__none">{t(flow.enabled ? "flow.noRunsOn" : "flow.noRunsOff")}</p>}
            {runs?.map((e) => {
              const o = outcomeOf(e, flow.predicates.length);
              const f = runFacts(e, t);
              return (
                <button
                  key={e.event_id}
                  type="button"
                  className={e.event_id === runId ? "fd__run is-on" : "fd__run"}
                  aria-current={e.event_id === runId}
                  onClick={() => setRunId(e.event_id)}
                >
                  <span className="fd__runwhen">
                    <span className={`fd__runmark is-${OUTCOME[o].bar}`} />
                    {runWhen(e.created_at)}
                  </span>
                  <span className="fd__runtags">
                    <Badge tone={OUTCOME[o].tone === "neutral" ? "neutral" : OUTCOME[o].tone}>
                      {t(OUTCOME[o].label)}
                    </Badge>
                    {e.run_tokens ? (
                      <Badge tone="violet">{t("flow.tokensShort", { count: tokens(e.run_tokens) })}</Badge>
                    ) : null}
                  </span>
                  <span className="fd__runtook">{f.took ?? ""}</span>
                  <Icons.ChevronRight size={14} aria-hidden="true" />
                </button>
              );
            })}
            {cursor && (
              <Button variant="ghost" size="sm" onClick={() => void older()}>
                {t("flow.olderRuns")}
              </Button>
            )}
          </div>
        </aside>
      ) : (
        <aside className="fd__railclosed" aria-label={t("flow.runs")}>
          <IconButton
            label={t("flow.showRuns")}
            icon={<Icons.List size={16} />}
            onClick={() => setRail((r) => ({ ...r, open: true }))}
          />
        </aside>
      )}
    </div>
  );
}

function StepPanel({
  flow,
  nodes,
  node,
  run,
  view,
  tab,
  setTab,
  reload,
}: {
  flow: Flow;
  nodes: FlowNode[];
  node: FlowNode | undefined;
  run: FlowRun | undefined;
  view: ReturnType<typeof viewRun> | undefined;
  tab: "step" | "run";
  setTab: (tab: "step" | "run") => void;
  reload: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const step = node ? view?.steps.get(node.id) : undefined;
  const lines = (tab === "step" && node ? view?.log.filter((l) => l.node === node.id) : view?.log) ?? [];
  const openChat = async (id: string) => {
    try {
      const info = await client.call("runs.get", { run: id });
      go.thread(info.thread_id);
    } catch {
      notify(t("flow.ed.saveFailed"));
    }
  };
  const retry = async () => {
    if (!run) return;
    try {
      const r = await client.call("flows.retry", { flow: flow.id, event: run.event_id });
      notify(t(r.queued ? "flow.retried" : "flow.notRetried"), "info");
      reload();
    } catch {
      notify(t("flow.notRetried"));
    }
  };
  return (
    <section className="fd__panel" aria-label={t("flow.panel")}>
      <div className="fd__panelhead">
        <SegmentedControl
          size="sm"
          label={t("flow.panel")}
          value={tab}
          onValueChange={(v) => setTab(v as "step" | "run")}
          options={[
            { value: "step", label: t("flow.tab.step") },
            { value: "run", label: t("flow.tab.run") },
          ]}
        />
        {tab === "step" && node && (
          <span className="fd__panelstep">
            <FlowStepTile icon={STEP[node.kind].icon} tone={STEP[node.kind].tone} />
            <strong>{node.label}</strong>
            <span>{t(STEP[node.kind].label)}</span>
          </span>
        )}
        <span className="fd__spacer" />
        <IconButton
          label={t(open ? "flow.collapse" : "flow.expand")}
          icon={open ? <Icons.Minus size={14} /> : <Icons.Plus size={14} />}
          onClick={() => setOpen(!open)}
        />
      </div>
      {open && (
        <>
          {!run && <p className="fd__none">{t("flow.pickRun")}</p>}
          {tab === "step" && node && (
            <div className="fd__io">
              <div>
                <span className="fd__label">{t("flow.input")}</span>
                <span className="fd__value">{step?.input}</span>
              </div>
              {run && (
                <div>
                  <span className="fd__label">{t("flow.output")}</span>
                  <span
                    className={
                      step?.state === "failed"
                        ? "fd__value is-failed"
                        : step?.state === "skipped"
                          ? "fd__value is-muted"
                          : "fd__value"
                    }
                  >
                    {step?.output}
                  </span>
                  <span className="fd__actions">
                    {step?.run && (
                      <Button size="sm" variant="secondary" onClick={() => void openChat(step.run as string)}>
                        {t("flow.openChat")}
                      </Button>
                    )}
                    {step?.retry && (
                      <Button size="sm" variant="secondary" onClick={() => void retry()}>
                        {t("common.retry")}
                      </Button>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
          {tab === "step" && node?.kind === "table_write" && <Rows flow={flow.id} />}
          {run && (
            <div className="fd__logwrap">
              <span className="fd__label">{t("flow.log")}</span>
              <div className="fd__log" role="log">
                {lines.length === 0 && step && <div className="fd__logline is-muted">— {step.output}</div>}
                {lines.map((l, i) => (
                  // Lines are a fixed sequence for the chosen run.
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional
                  <div key={i} className={`fd__logline${l.tone ? ` is-${l.tone}` : ""}`}>
                    <span>{logClock(l.at)}</span>
                    {tab === "run" && <span>{nodes.find((n) => n.id === l.node)?.label}</span>}
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** What the save step keeps now, read from the flow's table. */
function Rows({ flow }: { flow: string }) {
  const t = useT();
  const [rows, setRows] = useState<{ key: string; value: unknown }[]>();
  useEffect(() => {
    let live = true;
    void client.call("flows.rows", { flow, limit: 20 }).then(
      (r) => live && setRows(r.rows),
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [flow]);
  return (
    <div className="fd__rows">
      <span className="fd__label">{t("flow.rows")}</span>
      {rows?.length === 0 && <span className="fd__value is-muted">{t("flow.noRows")}</span>}
      {rows?.map((r) => (
        <div key={r.key} className="fd__row">
          <code>{r.key}</code>
          <pre>{JSON.stringify(r.value, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
