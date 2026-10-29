import type { Params, Result } from "@apx/protocol";
import { FLOW_OTHERWISE, flowCases } from "@apx/protocol/flow-cases";
import type { FlowShape } from "@apx/protocol/flow-shape";
import { type FlowStepTone, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { currentLocale, type MessageKey } from "../i18n/index.ts";
import { isTrigger } from "./graph-edit.ts";
import { readCron, timesText } from "./schedule-form.ts";

export { chainOrder, dotted, isTrigger } from "./graph-edit.ts";

export type Flow = Result<"flows.set">;
export type FlowRun = Result<"flows.events">["events"][number];
export type FlowDraftParams = Params<"flows.set">;
export type FlowBinding = import("../../../../packages/protocol/src/flow-graph.ts").FlowBinding;
export type { FlowGraph, FlowNode };

/** The kinds of step a drawing can have; every one runs. */
export type StepKind = FlowNode["kind"];

type Meta = { icon: ReactNode; tone: FlowStepTone; label: MessageKey; body?: MessageKey };
export const STEP: Record<StepKind, Meta> = {
  webhook: { icon: <Icons.Zap />, tone: "warning", label: "flow.kind.webhook", body: "flow.kind.webhookBody" },
  schedule: { icon: <Icons.Clock />, tone: "warning", label: "flow.kind.schedule", body: "flow.kind.scheduleBody" },
  condition: {
    icon: <Icons.Filter />,
    tone: "neutral",
    label: "flow.kind.condition",
    body: "flow.kind.conditionBody",
  },
  vars: { icon: <Icons.Tag />, tone: "neutral", label: "flow.kind.vars", body: "flow.kind.varsBody" },
  js: { icon: <Icons.Code />, tone: "neutral", label: "flow.kind.js", body: "flow.kind.jsBody" },
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

export const PALETTE: { group: MessageKey; kinds: StepKind[] }[] = [
  { group: "flow.group.trigger", kinds: ["webhook", "schedule"] },
  {
    group: "flow.group.steps",
    kinds: ["condition", "vars", "js", "table_read", "table_write", "sql", "http", "cmd"],
  },
  // A direct model call stays in drawings that have one; new ones use the AI model step.
  { group: "flow.group.crew", kinds: ["agent", "routine"] },
  { group: "flow.group.output", kinds: ["notify"] },
];
type Condition = Extract<FlowNode, { kind: "condition" }>;
type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * A check's ways out, named for the person: a case by its name, else "Yes" for the first and "Case 2"… for the
 * others; otherwise is "No" beside one case and "Otherwise" beside more.
 */
export function branchesOf(n: Condition, t: T): { id: string; label: string }[] {
  const cases = flowCases(n);
  return [
    ...cases.map((c, i) => ({
      id: c.id,
      label: c.label.trim() || (i === 0 ? t("flow.f.yes") : t("flow.f.caseN", { n: i + 1 })),
    })),
    { id: FLOW_OTHERWISE, label: cases.length === 1 ? t("flow.f.no") : t("flow.f.otherwise") },
  ];
}
/** The name of the way out `id` of a check. */
export const branchName = (n: Condition, id: string, t: T) => branchesOf(n, t).find((b) => b.id === id)?.label ?? id;

/** The drawing's trigger, if it has one. */
export const triggerOf = (graph: FlowGraph) => graph.nodes.find((n) => isTrigger(n.kind));

/** Schedules people pick by name; any other is written as a cron. */
export const SCHEDULE_PRESETS: { cron: string; label: MessageKey }[] = [
  { cron: "*/5 * * * *", label: "flow.cron.every5" },
  { cron: "0 * * * *", label: "flow.cron.hourly" },
  { cron: "30 8 * * 1-5", label: "flow.cron.weekdays" },
  { cron: "0 3 * * *", label: "flow.cron.daily" },
];
/** A schedule as people say it: its preset's name, its days and times, else its cron. */
export const scheduleName = (cron: string, t: (key: MessageKey) => string) => {
  const preset = presetOf(cron);
  if (preset) return t(preset.label);
  const form = readCron(cron);
  return form.mode === "times" && cron.trim() ? timesText(form.days, currentLocale()) : cron;
};
/** The methods a webhook step takes, as its card and run log show them. */
export const hookVerbs = (n: Extract<FlowNode, { kind: "webhook" }>) => (n.methods ?? ["POST"]).join(", ");
export const presetOf = (cron: string) => SCHEDULE_PRESETS.find((p) => p.cron === cron.trim().replace(/\s+/g, " "));

/** A Flow's address, from its path (DECISIONS.md#d-178); a Flow from before paths has its identifier as its path. */
export const hookPath = (path: string) => `/flows/${path}`;
/** Where a test event goes while the owner listens for one. */
export const testPath = (path: string) => `/flows/test/${path}`;
/** The path of a saved Flow. */
export const pathOf = (flow: Flow) => flow.path ?? flow.id;

export const literal = (v: string | number | boolean | null) => (typeof v === "string" ? `"${v}"` : String(v));

/** Steps after the trigger, as chips in a list row. */
export const chipsOf = (shape: FlowShape): StepKind[] => [
  ...shape.predicates.map(() => "condition" as const),
  ...(shape.readKeys.length ? (["table_read"] as const) : []),
  "table_write",
  ...(shape.action.kind === "none" ? [] : [shape.action.kind]),
];
