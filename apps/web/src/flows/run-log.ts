// A drawn Flow's run as a log, the way a terminal would print it: what arrived, then each step as it starts and ends
// with what it was given and gave back (DECISIONS.md#d-178). The editor's test and a Flow's page show the same one.
// Values are the core's stored previews (redacted, capped); here they are cut again for a screen and stay text.
// No .tsx or runtime imports: it is tested on its own.
import type { MessageKey } from "../i18n/index.ts";
import type { RunDetail } from "./data.ts";
import { isTrigger } from "./graph-edit.ts";
import type { RunView } from "./run-view.ts";

/** The words a log is said in: the language, how long a step took and why one didn't run. */
export type LogWords = {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  took: (from: string, to: string) => string | undefined;
  why: (code: string | null) => string;
};
/** How much of a value one block shows; the step's card shows the whole preview. */
export const LOG_CAP = 2000;
export type LogBlock = { label: string; text: string; cut: boolean };
export type LogEntry = {
  key: string;
  at: string;
  /** The step it is about; null for the run's own lines. */
  node: string | null;
  tone: "ok" | "err" | "live" | "muted" | undefined;
  title: string;
  blocks: LogBlock[];
};

/** At most `cap` characters, and whether it was cut. */
export function capText(text: string, cap = LOG_CAP): { text: string; cut: boolean } {
  return text.length > cap ? { text: `${text.slice(0, cap)}…`, cut: true } : { text, cut: false };
}
const block = (label: string, text: string, cut = false): LogBlock[] => {
  if (!text.trim()) return [];
  const c = capText(text);
  return [{ label, text: c.text, cut: cut || c.cut }];
};
/** JSON laid out to read; any other text as it is. */
const pretty = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

/**
 * Every line of one run, oldest first. `view`: what each step was given and gave back, in words; `address`: where the
 * event arrived ("POST /flows/test/leads").
 */
export function runLog(run: RunDetail, view: Pick<RunView, "steps">, address: string, w: LogWords): LogEntry[] {
  const { t } = w;
  const entries: LogEntry[] = [];
  const trigger = run.graph.nodes.find((n) => isTrigger(n.kind));
  if (run.arrived) {
    const headers = Object.entries(run.arrived.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    entries.push({
      key: "arrived",
      at: run.created_at,
      node: trigger?.id ?? null,
      tone: undefined,
      title: t("flow.tlog.arrived", { address }),
      blocks: [
        ...block(t("flow.tlog.headers"), headers),
        ...block(t("flow.tlog.data"), pretty(run.arrived.body), run.arrived.truncated),
      ],
    });
  } else
    entries.push({
      key: "arrived",
      at: run.created_at,
      node: trigger?.id ?? null,
      tone: undefined,
      title: t(run.source === "schedule" ? "flow.tlog.due" : "flow.tlog.byYou"),
      blocks: [],
    });
  if (run.state === "ignored")
    entries.push({
      key: "ignored",
      at: run.created_at,
      node: null,
      tone: "muted",
      title: t("flow.out.empty"),
      blocks: [],
    });
  for (const record of run.steps) {
    const n = run.graph.nodes.find((x) => x.id === record.node);
    const step = view.steps.get(record.node);
    if (!n || !step || isTrigger(n.kind)) continue;
    const name = n.label;
    if (record.started_at)
      entries.push({
        key: `${n.id}:start`,
        at: record.started_at,
        node: n.id,
        tone: record.ended_at ? undefined : "live",
        title: t("flow.tlog.started", { step: name }),
        blocks: block(t("flow.input"), step.input),
      });
    if (!record.ended_at) continue;
    const took = record.started_at ? w.took(record.started_at, record.ended_at) : undefined;
    const end = (tone: LogEntry["tone"], title: string, blocks: LogBlock[]) =>
      entries.push({ key: `${n.id}:end`, at: record.ended_at as string, node: n.id, tone, title, blocks });
    if (record.state === "succeeded")
      end(
        "ok",
        took ? t("flow.tlog.doneIn", { step: name, took }) : t("flow.tlog.done", { step: name }),
        block(t("flow.output"), step.output),
      );
    else if (record.state === "failed" || record.state === "uncertain")
      end("err", t("flow.tlog.failed", { step: name }), block(t("flow.output"), step.output));
    else
      end(
        "muted",
        t("flow.tlog.skipped", { step: name, why: record.error ? w.why(record.error) : t("flow.notRunBranch") }),
        [],
      );
  }
  if (run.state !== "pending" && run.state !== "ignored")
    entries.push({
      key: "end",
      at: run.ended_at ?? run.created_at,
      node: null,
      tone: run.state === "succeeded" ? "ok" : run.state === "cancelled" ? "muted" : "err",
      title: t(`flow.tlog.end.${run.state}`),
      blocks: [],
    });
  // A stable order by time: lines at the same instant keep the order they were made in.
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i)
    .map((x) => x.e);
}
