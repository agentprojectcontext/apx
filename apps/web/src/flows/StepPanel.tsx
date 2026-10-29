// A Flow page's panel under the canvas: the chosen step's input and output, and the run's log (DECISIONS.md#d-178).
import { Button, FlowStepTile, IconButton, Icons, SegmentedControl } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import type { RunDetail } from "./data.ts";
import { RunLog, useRunLog } from "./RunLog.tsx";
import { logClock, type viewRun } from "./run-view.ts";
import { type Flow, type FlowNode, type FlowRun, pathOf, STEP } from "./steps.tsx";
import { useTables } from "./tables-data.ts";

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
  const lines = (tab === "step" && node ? view?.log.filter((l) => l.node === node.id) : view?.log) ?? [];
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
          {graphRun && tab === "run" && (
            <div className="fd__logwrap">
              <span className="fd__label">{t("flow.log")}</span>
              <div className="fd__runlog">
                <RunLog entries={entries} />
              </div>
            </div>
          )}
          {run && !(graphRun && tab === "run") && (
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
  // A draft may name a table the project doesn't have yet: it has no rows to read.
  const tables = useTables(table ? project : undefined);
  const made = !table || tables?.some((x) => x.name === table);
  useEffect(() => {
    let live = true;
    if (!made) {
      setRows(tables ? [] : undefined);
      return;
    }
    void (
      table ? client.call("tables.get", { project, table, limit: 20 }) : client.call("flows.rows", { flow, limit: 20 })
    ).then(
      (r) => live && setRows(r.rows),
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [flow, project, table, made, tables]);
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
