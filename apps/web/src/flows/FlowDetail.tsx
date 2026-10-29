import type { Result } from "@apx/protocol";
import {
  Badge,
  Button,
  Dialog,
  FlowStepTile,
  IconButton,
  Icons,
  ResizeHandle,
  RunBars,
  SegmentedControl,
  Skeleton,
  Switch,
  Textarea,
} from "@apx/ui";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { useFlowDraft } from "../data/flowDrafts.ts";
import { notify } from "../data/notices.ts";
import { useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import {
  issueText,
  legacyGraph,
  loadRun,
  loadRuns,
  type RunDetail,
  type Schedules,
  type Shown,
  setEnabled,
  shownGraph,
  useKnown,
  whoOf,
} from "./data.ts";
import { FlowCanvas, type StepLook } from "./FlowCanvas.tsx";
import { stepDetail } from "./look.tsx";
import {
  dueTime,
  logClock,
  nextWhen,
  OUTCOME,
  outcomeOf,
  ranLate,
  runFacts,
  runWhen,
  tokens,
  viewGraphRun,
  viewRun,
} from "./run-view.ts";
import { type Flow, type FlowNode, type FlowRun, hookPath, isTrigger, STEP, scheduleName } from "./steps.tsx";
import "./detail.css";

type Cursor = Result<"flows.events">["nextCursor"];
const RAIL = { min: 260, max: 640, initial: 360 };

/** One flow: its steps as they ran in the chosen run, what each step did, and its runs at the right. */
export function FlowDetail({
  flow,
  schedule,
  timeZone,
  onBack,
  onEdit,
  onChanged,
}: {
  flow: Flow;
  /** Its schedule and next time, when it starts on one. */
  schedule: Schedules[string] | undefined;
  timeZone: string;
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
  // An agent's draft, or one saved in another window, is drawn as soon as it is saved.
  const drawn = useFlowDraft(flow.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed drawing is read again
  useEffect(() => {
    let live = true;
    void shownGraph(flow, t).then((s) => live && setShown(s));
    return () => {
      live = false;
    };
  }, [flow, t, drawn]);
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
  const run = runs?.find((e) => e.event_id === runId);
  // A graph run's steps come one by one from the core; read again with the runs while it goes on.
  const [detail, setDetail] = useState<RunDetail>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: each read of the runs reads the chosen one again
  useEffect(() => {
    let live = true;
    if (run?.executor !== "graph") {
      setDetail(undefined);
      return;
    }
    void loadRun(flow.id, run.event_id).then(
      (d) => live && setDetail(d),
      () => live && setDetail(undefined),
    );
    return () => {
      live = false;
    };
  }, [flow.id, run?.event_id, run?.executor, runs]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each load of the runs arms the next read
  useEffect(() => {
    // A run going is followed closely; a flow that is on is looked at now and then for new runs.
    if (!going && !flow.enabled) return;
    const timer = setTimeout(() => setRevision((n) => n + 1), going ? 3000 : 10_000);
    return () => clearTimeout(timer);
  }, [going, runs, flow.enabled]);
  const known = useKnown();
  const who = useCallback((n: FlowNode) => whoOf(n, agents, routines, t, known), [agents, routines, t, known]);
  // What the chosen run ran: its own revision, the old definition for a legacy run of a published flow, or now.
  const graph = useMemo(() => {
    if (run?.executor === "graph") return detail?.event === run.event_id ? detail.graph : undefined;
    if (run && !run.current) return legacyGraph(flow, t);
    return shown?.graph;
  }, [run, detail, flow, t, shown]);
  const view = useMemo(() => {
    if (!graph) return undefined;
    if (run?.executor === "graph") return detail ? viewGraphRun(detail, flow.id, t, who) : undefined;
    return viewRun(graph, flow.id, run, t, who);
  }, [graph, detail, flow.id, run, t, who]);
  const look = useCallback(
    (n: FlowNode): StepLook => {
      const v = view?.steps.get(n.id);
      return {
        title: n.label,
        ...stepDetail(n, flow.id, agents, routines, t, known),
        ...(v?.state ? { state: v.state } : {}),
        ...(v?.order ? { order: v.order } : {}),
        ...(v?.badge ? { badge: v.badge } : {}),
      };
    },
    [view, flow.id, agents, routines, t, known],
  );
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await setEnabled(flow, on);
      onChanged();
    } catch (e) {
      notify(issueText(e, shown?.draft ?? undefined, t) ?? t("flow.ed.saveFailed"));
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
  const [asking, setAsking] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const published = shown?.publishedRevision != null;
  /** A webhook flow asks for a body, prefilled with the last one kept; a schedule flow runs at once. */
  const runNow = async () => {
    if (schedule) return void start({});
    setAsking(await lastBody(flow.id, runs));
  };
  const start = async (data: unknown) => {
    setBusy(true);
    try {
      const r = await client.call("flows.run_now", { flow: flow.id, data });
      setAsking(undefined);
      notify(t(r.state === "ignored" ? "flow.now.empty" : "flow.now.started"), "info");
      setRunId(r.event);
      setRevision((n) => n + 1);
    } catch {
      notify(t("flow.now.failed"));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const r = await client.call("flows.cancel_run", { flow: flow.id, event: run.event_id });
      notify(
        t(r.cancelled ? (r.state === "uncertain" ? "flow.stop.uncertain" : "flow.stop.done") : "flow.stop.ended"),
        "info",
      );
      setStopping(false);
      setRevision((n) => n + 1);
    } catch {
      notify(t("flow.stop.failed"));
    } finally {
      setBusy(false);
    }
  };
  const live = run?.executor === "graph" && run.state === "pending";
  const outcome = run ? outcomeOf(run, flow.predicates.length) : undefined;
  const facts = run ? runFacts(run, t) : undefined;
  // Until one is chosen, the step that hands work to the crew (or the last one) is open.
  const node =
    graph?.nodes.find((n) => n.id === nodeId) ??
    graph?.nodes.find((n) => n.kind === "agent" || n.kind === "routine" || n.kind === "llm") ??
    graph?.nodes.at(-1);
  return (
    <div className="fd">
      <div className="fd__main">
        <header className="fd__head">
          <IconButton label={t("flow.back")} icon={<Icons.ArrowLeft size={16} />} onClick={onBack} />
          <FlowStepTile icon={STEP[schedule ? "schedule" : "webhook"].icon} tone="warning" size="lg" />
          <div className="fd__name">
            <h1>{flow.name}</h1>
            <span>
              {project} ·{" "}
              {schedule ? scheduleName(schedule.cron, t) : t("flow.triggerHook", { path: hookPath(flow.id) })} ·{" "}
              {t("flow.steps", { count: graph?.nodes.length ?? "…" })}
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
            {published && (
              <Button
                variant="secondary"
                leadingIcon={<Icons.Play size={14} />}
                disabled={busy || !flow.enabled}
                title={flow.enabled ? undefined : t("flow.now.off")}
                onClick={() => void runNow()}
              >
                {t("flow.now.run")}
              </Button>
            )}
            <Button variant="primary" leadingIcon={<Icons.Pencil size={14} />} onClick={onEdit}>
              {t("flow.edit")}
            </Button>
          </div>
        </header>
        {schedule?.skipped && schedule.skipped_at ? (
          <p className="fd__skipped">
            {schedule.skipped === 1
              ? t("flow.skippedOne", { time: dueTime(schedule.skipped_at, timeZone) })
              : t("flow.skipped", { count: schedule.skipped, time: dueTime(schedule.skipped_at, timeZone) })}
          </p>
        ) : null}
        {run && outcome && (
          <div className="fd__runline">
            <strong>{t("flow.runAt", { when: runWhen(run.created_at) })}</strong>
            <Badge tone={OUTCOME[outcome].tone === "neutral" ? "neutral" : OUTCOME[outcome].tone}>
              {t(OUTCOME[outcome].label)}
            </Badge>
            {facts?.took && <span>{facts.took}</span>}
            {facts?.tokens && <span>{facts.tokens}</span>}
            {view && graph && <span>{t("flow.stepsRan", { ran: view.ran, total: graph.nodes.length })}</span>}
            {run.source === "owner" && <Badge tone="neutral">{t("flow.byYou")}</Badge>}
            {run.scheduled_at && ranLate(run) && (
              <span className="fd__late">{t("flow.late", { time: dueTime(run.scheduled_at, timeZone) })}</span>
            )}
            {live && (
              <Button
                size="sm"
                variant="secondary"
                className="fd__stop"
                leadingIcon={<Icons.Square size={12} />}
                disabled={busy}
                onClick={() => setStopping(true)}
              >
                {t("flow.stop.button")}
              </Button>
            )}
          </div>
        )}
        {shown?.draftPending && <p className="fd__draft">{t(flow.enabled ? "flow.draftBlocked" : "flow.draftOff")}</p>}
        <div className="fd__canvas">
          {graph ? (
            <FlowCanvas
              graph={graph}
              look={look}
              selected={node?.id ?? null}
              onSelect={(id) => {
                if (!id) return;
                setNodeId(id);
                setTab("step");
              }}
              fitKey={`${flow.id}:${run?.executor === "graph" ? `r${detail?.revision ?? ""}` : run?.current === false ? "old" : "now"}`}
            >
              {run && (
                <div className="fd__legend" aria-hidden="true">
                  <span className="is-ran">{t("flow.legend.stepRan")}</span>
                  <span className="is-skipped">{t("flow.legend.stepSkipped")}</span>
                  <span className="is-failed">{t("flow.legend.stepFailed")}</span>
                </div>
              )}
              <span className={run && !run.current ? "fd__version is-old" : "fd__version"}>
                {t(run && !run.current ? "flow.previous" : "flow.current")}
              </span>
            </FlowCanvas>
          ) : (
            <Skeleton width="100%" height="100%" />
          )}
        </div>
        <StepPanel
          flow={flow}
          nodes={graph?.nodes ?? []}
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
            <span className="fd__railnext">
              {!flow.enabled
                ? t("flow.off")
                : schedule
                  ? schedule.next_at
                    ? t("flow.nextAt", { when: nextWhen(schedule.next_at, timeZone, t) })
                    : t("flow.next.none")
                  : t("flow.nextWhen")}
            </span>
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
      <RunNowDialog
        body={asking}
        busy={busy}
        onClose={() => setAsking(undefined)}
        onStart={(data) => void start(data)}
      />
      <Dialog
        open={stopping}
        onOpenChange={setStopping}
        title={t("flow.stop.title")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStopping(false)}>
              {t("flow.stop.keep")}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void cancel()}>
              {t("flow.stop.button")}
            </Button>
          </>
        }
      >
        {t("flow.stop.body")}
      </Dialog>
    </div>
  );
}

/** The body of the last run that kept one, as editable JSON; an empty object when none did. */
async function lastBody(flow: string, runs: FlowRun[] | undefined): Promise<string> {
  const last = runs?.find((e) => e.executor === "graph" && e.state !== "ignored" && e.source !== "schedule");
  if (!last) return "{}";
  try {
    const d = await loadRun(flow, last.event_id);
    const start = d.steps.find((s) => d.graph.nodes.some((n) => n.id === s.node && isTrigger(n.kind)));
    // A body kept with credentials blanked out would send the placeholders: start from an empty one instead.
    if (!start?.output || start.truncated || start.output.includes("[redacted]")) return "{}";
    return JSON.stringify(JSON.parse(start.output), null, 2);
  } catch {
    return "{}";
  }
}

/** A webhook flow run by hand: the person writes (or keeps) the body it gets, as if it had been POSTed. */
function RunNowDialog(props: {
  body: string | undefined;
  busy: boolean;
  onClose: () => void;
  onStart: (data: unknown) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (props.body !== undefined) {
      setText(props.body);
      setBad(false);
    }
  }, [props.body]);
  const go = () => {
    try {
      props.onStart(JSON.parse(text));
    } catch {
      setBad(true);
    }
  };
  return (
    <Dialog
      open={props.body !== undefined}
      onOpenChange={(o) => !o && props.onClose()}
      title={t("flow.now.title")}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={props.busy} leadingIcon={<Icons.Play size={14} />} onClick={go}>
            {t("flow.now.run")}
          </Button>
        </>
      }
    >
      <div className="fd__now">
        <p>{t("flow.now.body")}</p>
        <Textarea
          aria-label={t("flow.now.sample")}
          rows={8}
          className="fd__mono"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setBad(false);
          }}
        />
        {bad && (
          <p className="fd__nowerr" role="alert">
            {t("flow.ed.tryBadJson")}
          </p>
        )}
      </div>
    </Dialog>
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
                  {step?.answered && <span className="fd__answered">{step.answered}</span>}
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
          {tab === "step" && node?.kind === "table_write" && (
            <Rows flow={flow.id} project={flow.projectId} table={node.table} />
          )}
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

/** What the save step keeps now: its project table's latest rows, or the flow's own table. */
function Rows({ flow, project, table }: { flow: string; project: string; table: string | undefined }) {
  const t = useT();
  const [rows, setRows] = useState<{ key: string; value: unknown }[]>();
  useEffect(() => {
    let live = true;
    void (
      table ? client.call("tables.get", { project, table, limit: 20 }) : client.call("flows.rows", { flow, limit: 20 })
    ).then(
      (r) => live && setRows(r.rows),
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [flow, project, table]);
  return (
    <div className="fd__rows">
      <span className="fd__label">{t("flow.rows")}</span>
      {table && (
        <Button size="sm" variant="link" onClick={() => go.tables(project, table)}>
          {t("flow.tables.open", { name: table })}
        </Button>
      )}
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
