// A Flow page's panel under the canvas: the chosen step's input and output, and the run's log (DECISIONS.md#d-178).
import type { TableRow } from "@apx/protocol";
import { Button, FlowStepTile, IconButton, Icons, SegmentedControl } from "@apx/ui";
import { Fragment, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import type { RunDetail } from "./data.ts";
import { RunLog, useRunLog } from "./RunLog.tsx";
import { lasted, logClock, type StepView, type viewRun } from "./run-view.ts";
import { StepValue } from "./StepValue.tsx";
import { rowColumns } from "./step-value.ts";
import { type Flow, type FlowNode, type FlowRun, pathOf, STEP } from "./steps.tsx";
import { gridRows } from "./table-grid.ts";
import { useTables } from "./tables-data.ts";
import "./tables.css";

/** Rows a save step shows: the newest few; the rest are in Tables. */
const ROWS = 10;

export function StepPanel({
  flow,
  nodes,
  node,
  run,
  detail,
  who,
  view,
  tab,
  setTab,
  reload,
}: {
  flow: Flow;
  nodes: FlowNode[];
  node: FlowNode | undefined;
  run: FlowRun | undefined;
  /** A drawn Flow's run, step by step: its log is the one the editor's test shows. */
  detail: RunDetail | undefined;
  who: (n: FlowNode) => string;
  view: ReturnType<typeof viewRun> | undefined;
  tab: "step" | "run";
  setTab: (tab: "step" | "run") => void;
  reload: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const step = node ? view?.steps.get(node.id) : undefined;
  const lines = view?.log ?? [];
  const graphRun = run?.executor === "graph" && detail?.event === run.event_id ? detail : undefined;
  const entries = useRunLog(graphRun, pathOf(flow), who);
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
        {tab === "step" && run && step && <When step={step} />}
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
              {/* With no run picked, what shows is how the step is set up, not what it received. */}
              <StepValue key={`${node.id}:in`} label={t(run ? "flow.input" : "flow.setup")} text={step?.input ?? ""} />
              {run && (
                <div className="fd__out">
                  <StepValue
                    key={`${node.id}:out`}
                    label={t("flow.output")}
                    text={step?.output ?? ""}
                    tone={step?.state === "failed" ? "failed" : step?.state === "skipped" ? "muted" : undefined}
                  />
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
          {graphRun && tab === "run" && (
            <div className="fd__logwrap">
              <span className="fd__label">{t("flow.log")}</span>
              <div className="fd__runlog">
                <RunLog entries={entries} />
              </div>
            </div>
          )}
          {run && tab === "run" && !graphRun && (
            <div className="fd__logwrap">
              <span className="fd__label">{t("flow.log")}</span>
              <div className="fd__log" role="log">
                {lines.map((l, i) => (
                  // Lines are a fixed sequence for the chosen run.
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional
                  <div key={i} className={`fd__logline${l.tone ? ` is-${l.tone}` : ""}`}>
                    <span>{logClock(l.at)}</span>
                    <span>{nodes.find((n) => n.id === l.node)?.label}</span>
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

/** When the chosen step started and how long it took, or that it is still at work. */
function When({ step }: { step: StepView }) {
  const t = useT();
  if (!step.started || step.state === "skipped") return null;
  const took = lasted(step.started, step.ended ?? null);
  return (
    <span className="fd__when">
      {took
        ? t("flow.when.took", { at: logClock(step.started), took })
        : t("flow.when.working", { at: logClock(step.started) })}
    </span>
  );
}

/** What the save step keeps now: its project table's latest rows, or the flow's own table, as the Tables grid. */
function Rows({ flow, project, table }: { flow: string; project: string; table: string | undefined }) {
  const t = useT();
  const [got, setGot] = useState<{ columns: string[]; rows: Pick<TableRow, "key" | "value">[] }>();
  const [open, setOpen] = useState<string | null>(null);
  // A draft may name a table the project doesn't have yet: it has no rows to read.
  const tables = useTables(table ? project : undefined);
  const made = !table || tables?.some((x) => x.name === table);
  useEffect(() => {
    let live = true;
    if (!made) {
      setGot(tables ? { columns: [], rows: [] } : undefined);
      return;
    }
    const read = table
      ? client
          .call("tables.get", { project, table, limit: ROWS })
          .then((r) => ({ columns: r.table.columns, rows: r.rows }))
      : client.call("flows.rows", { flow, limit: ROWS }).then((r) => ({ columns: [], rows: r.rows }));
    void read.then(
      (r) => live && setGot({ columns: rowColumns(r.columns, r.rows), rows: r.rows }),
      () => live && setGot({ columns: [], rows: [] }),
    );
    return () => {
      live = false;
    };
  }, [flow, project, table, made, tables]);
  const grid = got ? gridRows({ columns: got.columns }, got.rows) : [];
  return (
    <div className="fd__rows">
      <div className="fd__rowshead">
        <span className="fd__label">{table ? t("flow.rowsOf", { name: table }) : t("flow.rows")}</span>
        {table && (
          <Button size="sm" variant="link" onClick={() => go.tables(project, table)}>
            {t("flow.tables.openShort")}
          </Button>
        )}
      </div>
      {got?.rows.length === 0 && (
        <span className="fd__value is-muted">{t(made ? "flow.noRows" : "flow.tableNotMade")}</span>
      )}
      {grid.length > 0 && got && (
        <section className="ft-grid fd__grid" aria-label={table ?? t("flow.rows")}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t("flow.f.key")}</th>
                {got.columns.map((c) => (
                  <th key={c} scope="col" className="fd__mono">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((r, i) => (
                <Fragment key={r.key}>
                  <tr className={open === r.key ? "is-open" : undefined}>
                    <th scope="row">
                      <button
                        type="button"
                        className="ft-grid__key fd__mono"
                        aria-expanded={open === r.key}
                        onClick={() => setOpen(open === r.key ? null : r.key)}
                      >
                        {r.key}
                      </button>
                    </th>
                    {r.cells.map((c, j) => (
                      <td key={got.columns[j]} title={c}>
                        {c}
                      </td>
                    ))}
                  </tr>
                  {open === r.key && (
                    <tr className="fd__rowopen">
                      <td colSpan={got.columns.length + 1}>
                        <StepValue
                          label={t("flow.rowOf", { key: r.key })}
                          text={JSON.stringify(got.rows[i]?.value ?? null, null, 2)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
