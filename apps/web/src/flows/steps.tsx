import type { Params, Result } from "@apx/protocol";
import type { FlowShape } from "@apx/protocol/flow-shape";
import { type FlowStepTone, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import type { MessageKey } from "../i18n/index.ts";

export type Flow = Result<"flows.set">;
export type FlowRun = Result<"flows.events">["events"][number];
export type FlowDraftParams = Params<"flows.set">;
export type FlowBinding = import("../../../../packages/protocol/src/flow-graph.ts").FlowBinding;
export type { FlowGraph, FlowNode };

/** Kinds the current executor runs, and the ones the palette shows as coming soon (never added or saved). */
export type StepKind = FlowNode["kind"];
export type SoonKind = "sql" | "http" | "cmd" | "notify";

type Meta = { icon: ReactNode; tone: FlowStepTone; label: MessageKey; body?: MessageKey };
export const STEP: Record<StepKind | SoonKind, Meta> = {
  webhook: { icon: <Icons.Zap />, tone: "warning", label: "flow.kind.webhook", body: "flow.kind.webhookBody" },
  schedule: { icon: <Icons.Clock />, tone: "warning", label: "flow.kind.schedule", body: "flow.kind.scheduleBody" },
  condition: {
    icon: <Icons.Filter />,
    tone: "neutral",
    label: "flow.kind.condition",
    body: "flow.kind.conditionBody",
  },
  table_read: {
    icon: <Icons.Database />,
    tone: "info",
    label: "flow.kind.table_read",
    body: "flow.kind.table_readBody",
  },
  table_write: {
    icon: <Icons.Database />,
    tone: "info",
    label: "flow.kind.table_write",
    body: "flow.kind.table_writeBody",
  },
  sql: { icon: <Icons.Layers />, tone: "info", label: "flow.kind.sql", body: "flow.kind.sqlBody" },
  http: { icon: <Icons.Globe />, tone: "info", label: "flow.kind.http", body: "flow.kind.httpBody" },
  cmd: { icon: <Icons.Terminal />, tone: "neutral", label: "flow.kind.cmd", body: "flow.kind.cmdBody" },
  agent: { icon: <Icons.Sparkles />, tone: "violet", label: "flow.kind.agent", body: "flow.kind.agentBody" },
  routine: { icon: <Icons.Repeat />, tone: "violet", label: "flow.kind.routine", body: "flow.kind.routineBody" },
  llm: { icon: <Icons.Brain />, tone: "violet", label: "flow.kind.llm", body: "flow.kind.llmBody" },
  notify: { icon: <Icons.Send />, tone: "brand", label: "flow.kind.notify", body: "flow.kind.notifyBody" },
};

export const PALETTE: { group: MessageKey; kinds: (StepKind | SoonKind)[] }[] = [
  { group: "flow.group.trigger", kinds: ["webhook", "schedule"] },
  { group: "flow.group.steps", kinds: ["condition", "table_read", "table_write", "sql", "http", "cmd"] },
  { group: "flow.group.crew", kinds: ["agent", "routine", "llm"] },
  { group: "flow.group.output", kinds: ["notify"] },
];
export const isSoon = (kind: string): kind is SoonKind =>
  kind === "sql" || kind === "http" || kind === "cmd" || kind === "notify";
/** A run starts at its one trigger: an incoming POST or a schedule. */
export const isTrigger = (kind: string): kind is "webhook" | "schedule" => kind === "webhook" || kind === "schedule";
/** The drawing's trigger, if it has one. */
export const triggerOf = (graph: FlowGraph) => graph.nodes.find((n) => isTrigger(n.kind));

/** Schedules people pick by name; any other is written as a cron. */
export const SCHEDULE_PRESETS: { cron: string; label: MessageKey }[] = [
  { cron: "*/5 * * * *", label: "flow.cron.every5" },
  { cron: "0 * * * *", label: "flow.cron.hourly" },
  { cron: "30 8 * * 1-5", label: "flow.cron.weekdays" },
  { cron: "0 3 * * *", label: "flow.cron.daily" },
];
/** A schedule as people say it: its preset's name, else its cron. */
export const scheduleName = (cron: string, t: (key: MessageKey) => string) => {
  const preset = presetOf(cron);
  return preset ? t(preset.label) : cron;
};
export const presetOf = (cron: string) => SCHEDULE_PRESETS.find((p) => p.cron === cron.trim().replace(/\s+/g, " "));

export const hookPath = (flow: string) => `/flows/${flow}`;

/** A field path as people write it: form.tier. */
export const dotted = (path: readonly string[]) => path.join(".");
export const literal = (v: string | number | boolean | null) => (typeof v === "string" ? `"${v}"` : String(v));

/** Steps after the trigger, as chips in a list row. */
export const chipsOf = (shape: FlowShape): StepKind[] => [
  ...shape.predicates.map(() => "condition" as const),
  ...(shape.readKeys.length ? (["table_read"] as const) : []),
  "table_write",
  ...(shape.action.kind === "none" ? [] : [shape.action.kind]),
];

/** Steps in the order they run: along the path from the trigger, then any step not on it. */
export function chainOrder(graph: FlowGraph): FlowNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: FlowNode[] = [];
  const visit = (n: FlowNode | undefined) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    for (const e of graph.edges) if (e.source === n.id) visit(byId.get(e.target));
  };
  for (const n of graph.nodes) if (isTrigger(n.kind)) visit(n);
  for (const n of graph.nodes) visit(n);
  return out;
}
