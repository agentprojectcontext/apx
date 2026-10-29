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
import { useFlowRunMoved } from "../data/flowTests.ts";
import { notify } from "../data/notices.ts";
import { useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
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
import { HistoryList, type Looked, loadVersion, RestoreDialog, useFlowHistory } from "./FlowHistory.tsx";
import { entryLabel, type HistoryEntry } from "./history.ts";
import { stepDetail } from "./look.tsx";
import {
  dueTime,
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
import { StepPanel } from "./StepPanel.tsx";
import { type Flow, type FlowNode, type FlowRun, hookPath, isTrigger, pathOf, STEP, scheduleName } from "./steps.tsx";
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
  // A run moving (a test from the editor too) is read again at once.
  const moved = useFlowRunMoved(flow.id);
  const path = pathOf(flow);
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
  }, [flow.id, revision, moved?.seq]);
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
  // While a saved draft waits the page shows it; what runs (a run's own revision) when chosen (DECISIONS.md#d-177).
  const [which, setWhich] = useState<"draft" | "runs">("draft");
  const draft = shown?.draftPending ? shown.draft : null;
  // A drawn run carries its drawing, so a Flow never published still shows its tests (DECISIONS.md#d-178).
  const runsToo = Boolean(shown && (!shown.placeholder || runs?.some((e) => e.executor === "graph")));
  const onDraft = Boolean(draft) && (which === "draft" || !runsToo);
  // The rail lists runs or saved versions; a version picked is drawn read-only (DECISIONS.md#d-179).
  const [list, setList] = useState<"runs" | "history">("runs");
  const [looked, setLooked] = useState<Looked>();
  const [restoring, setRestoring] = useState<HistoryEntry>();
  const entries = useFlowHistory(flow.id, list === "history");
  const pick = (id: string) => {
    setRunId(id);
    setWhich("runs");
    setLooked(undefined);
  };
  const openVersion = async (e: HistoryEntry) => {
    try {
      setLooked(await loadVersion(flow.id, e.entry));
      // On a phone the list sits under the canvas: back to the top, where the version and Restore show.
      document.querySelector(".fd")?.scrollTo({ top: 0 });
    } catch {
      notify(t("flow.hist.loadFailed"));
    }
  };
  // What the chosen run ran: its own revision, the old definition for a legacy run of a published flow, or now.
  const graph = useMemo(() => {
    if (looked) return looked.graph;
    if (onDraft && draft) return draft;
    if (run?.executor === "graph") return detail?.event === run.event_id ? detail.graph : undefined;
    if (run && !run.current) return legacyGraph(flow, t);
    return shown?.graph;
  }, [run, detail, flow, t, shown, onDraft, draft, looked]);
  const view = useMemo(() => {
    if (!graph) return undefined;
    if (onDraft || looked) return viewRun(graph, path, undefined, t, who);
    if (run?.executor === "graph") return detail ? viewGraphRun(detail, path, t, who) : undefined;
    return viewRun(graph, path, run, t, who);
  }, [graph, detail, path, run, t, who, onDraft, looked]);
  const look = useCallback(
    (n: FlowNode): StepLook => {
      const v = view?.steps.get(n.id);
      return {
        title: n.label,
        ...stepDetail(n, path, agents, routines, t, known),
        ...(v?.state ? { state: v.state } : {}),
        ...(v?.order ? { order: v.order } : {}),
        ...(v?.badge ? { badge: v.badge } : {}),
      };
    },
    [view, path, agents, routines, t, known],
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
              {project} · {schedule ? scheduleName(schedule.cron, t) : t("flow.triggerHook", { path: hookPath(path) })}{" "}
              · {t("flow.steps", { count: graph?.nodes.length ?? "…" })}
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
        {run && outcome && !onDraft && !looked && (
          <div className="fd__runline">
            <strong>{t("flow.runAt", { when: runWhen(run.created_at) })}</strong>
            <Badge tone={OUTCOME[outcome].tone === "neutral" ? "neutral" : OUTCOME[outcome].tone}>
              {t(OUTCOME[outcome].label)}
            </Badge>
            {facts?.took && <span>{facts.took}</span>}
            {facts?.tokens && <span>{facts.tokens}</span>}
            {view && graph && <span>{t("flow.stepsRan", { ran: view.ran, total: graph.nodes.length })}</span>}
            {run.test && <Badge tone="warning">{t("flow.test.badge")}</Badge>}
            {run.source === "owner" && !run.test && <Badge tone="neutral">{t("flow.byYou")}</Badge>}
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
        {looked && (
          <div className="fd__drafts">
            <p className="fd__draft">{t("flow.hist.looking")}</p>
            <Button size="sm" leadingIcon={<Icons.RotateCcw size={14} />} onClick={() => setRestoring(looked.entry)}>
              {t("flow.hist.restore")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLooked(undefined)}>
              {t("flow.hist.closeVersion")}
            </Button>
          </div>
        )}
        {draft && !looked && (
          <div className="fd__drafts">
            {runsToo && (
              <SegmentedControl
                size="sm"
                label={t("flow.drawingShown")}
                value={onDraft ? "draft" : "runs"}
                onValueChange={(v) => setWhich(v as "draft" | "runs")}
                options={[
                  { value: "draft", label: t("flow.card.draft") },
                  { value: "runs", label: t("flow.whatRuns") },
                ]}
              />
            )}
            <p className="fd__draft">{t(flow.enabled ? "flow.draftBlocked" : "flow.draftOff")}</p>
          </div>
        )}
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
              fitKey={`${flow.id}:${looked ? `v${looked.entry.entry}` : ""}${onDraft ? `d${shown?.draftVersion ?? ""}` : run?.executor === "graph" ? `r${detail?.revision ?? ""}` : run?.current === false ? "old" : "now"}`}
            >
              {run && !onDraft && !looked && (
                <div className="fd__legend" aria-hidden="true">
                  <span className="is-ran">{t("flow.legend.stepRan")}</span>
                  <span className="is-skipped">{t("flow.legend.stepSkipped")}</span>
                  <span className="is-failed">{t("flow.legend.stepFailed")}</span>
                </div>
              )}
              <span
                className={
                  looked
                    ? "fd__version is-old"
                    : onDraft
                      ? "fd__version is-draft"
                      : run?.test
                        ? "fd__version is-test"
                        : run && !run.current
                          ? "fd__version is-old"
                          : "fd__version"
                }
              >
                {looked
                  ? entryLabel(looked.entry, t, runWhen(looked.entry.at))
                  : t(
                      onDraft
                        ? "flow.card.draft"
                        : run?.test
                          ? "flow.test.badge"
                          : run && !run.current
                            ? "flow.previous"
                            : "flow.current",
                    )}
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
          run={onDraft || looked ? undefined : run}
          detail={detail}
          who={who}
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
              <SegmentedControl
                size="sm"
                label={t("flow.hist.showing")}
                value={list}
                onValueChange={(v) => setList(v as "runs" | "history")}
                options={[
                  { value: "runs", label: `${t("flow.runs")}${runs?.length ? ` ${runs.length}` : ""}` },
                  { value: "history", label: t("flow.hist.tab") },
                ]}
              />
              <span className="fd__spacer" />
              <IconButton
                label={t("flow.hideRuns")}
                icon={<Icons.ChevronRight size={16} />}
                onClick={() => setRail((r) => ({ ...r, open: false }))}
              />
            </div>
            {list === "runs" && (
              <span className="fd__railnext">
                {!flow.enabled
                  ? t("flow.off")
                  : schedule
                    ? schedule.next_at
                      ? t("flow.nextAt", { when: nextWhen(schedule.next_at, timeZone, t) })
                      : t("flow.next.none")
                    : t("flow.nextWhen")}
              </span>
            )}
            {list === "runs" && runs && runs.length > 0 && (
              <RunBars
                size="lg"
                label={t("flow.runsLast")}
                selected={runId}
                onSelect={pick}
                runs={runs
                  .slice(0, 24)
                  .reverse()
                  .map((e) => {
                    const o = outcomeOf(e, flow.predicates.length);
                    return {
                      id: e.event_id,
                      state: OUTCOME[o].bar,
                      label: `${runWhen(e.created_at)} · ${t(OUTCOME[o].label)}${e.test ? ` · ${t("flow.test.badge")}` : ""}`,
                    };
                  })}
              />
            )}
          </div>
          {list === "history" ? (
            <div className="fd__runs">
              <HistoryList
                entries={entries}
                selected={looked?.entry.entry}
                running={shown?.publishedRevision ?? null}
                onPick={(e) => void openVersion(e)}
              />
            </div>
          ) : (
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
                    onClick={() => pick(e.event_id)}
                  >
                    <span className="fd__runwhen">
                      <span className={`fd__runmark is-${OUTCOME[o].bar}`} />
                      {runWhen(e.created_at)}
                    </span>
                    <span className="fd__runtags">
                      <Badge tone={OUTCOME[o].tone === "neutral" ? "neutral" : OUTCOME[o].tone}>
                        {t(OUTCOME[o].label)}
                      </Badge>
                      {e.test && <Badge tone="warning">{t("flow.test.badge")}</Badge>}
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
          )}
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
      <RestoreDialog
        flow={flow.id}
        entry={restoring}
        version={async () => (await client.call("flows.graph_get", { flow: flow.id })).draftVersion}
        onClose={() => setRestoring(undefined)}
        onRestored={() => {
          setLooked(undefined);
          setWhich("draft");
          onChanged();
        }}
      />
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
