import type { FlowStepState, RunBar } from "@apx/ui";
import { formatNumber, formatSeconds, shortWhen } from "../common/format.ts";
import { currentLocale, type MessageKey } from "../i18n/index.ts";
import { chainOrder, dotted, type FlowGraph, type FlowNode, type FlowRun, hookPath, literal } from "./steps.tsx";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** How a whole run ended, from what the core recorded: the event's state and its linked run. */
export type RunOutcome = "done" | "saved" | "cut" | "empty" | "failed" | "live" | "pending" | "waiting";
export function outcomeOf(e: FlowRun, checks: number): RunOutcome {
  if (e.state === "ignored") return checks ? "cut" : "empty";
  if (e.state === "written") return "saved";
  if (e.state === "pending") return "pending";
  if (e.state === "failed") return "failed";
  if (e.run_state === "completed") return "done";
  if (e.run_state === "failed" || e.run_state === "canceled") return "failed";
  if (e.run_state === "input-required") return "waiting";
  return "live";
}
export const OUTCOME: Record<
  RunOutcome,
  { label: MessageKey; bar: RunBar["state"]; tone: "brand" | "neutral" | "danger" | "info" | "warning" }
> = {
  done: { label: "flow.run.done", bar: "ran", tone: "brand" },
  saved: { label: "flow.run.saved", bar: "ran", tone: "brand" },
  cut: { label: "flow.run.cut", bar: "cut", tone: "neutral" },
  empty: { label: "flow.run.empty", bar: "cut", tone: "neutral" },
  failed: { label: "flow.run.failed", bar: "failed", tone: "danger" },
  live: { label: "flow.run.live", bar: "live", tone: "info" },
  pending: { label: "flow.run.pending", bar: "live", tone: "info" },
  waiting: { label: "flow.run.waiting", bar: "live", tone: "warning" },
};

// Same clock as the rest of the panel: 24 h in Spanish, the locale's own otherwise.
const time = (iso: string) => {
  const locale = currentLocale();
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: locale.startsWith("es") ? "h23" : undefined,
  }).format(new Date(iso));
};
const clock = (iso: string) =>
  new Intl.DateTimeFormat(currentLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
/** "08:12" today, "Yesterday 22:03", "Mon 18:40", "Sep 3 10:00". */
export function runWhen(iso: string, now = new Date()) {
  const at = time(iso);
  return new Date(iso).toDateString() === now.toDateString() ? at : `${shortWhen(iso, now)} ${at}`;
}
const seconds = (from: string, to: string) => Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);
/** "0,8 s", "1 min 12 s". */
export function lasted(from: string, to: string | null) {
  if (!to) return undefined;
  const s = seconds(from, to);
  return s < 60 ? formatSeconds(s) : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}
/** "7,4k" above a thousand. */
export const tokens = (n: number) =>
  n >= 1000 ? `${formatNumber(n / 1000, { maximumFractionDigits: 1 })}k` : formatNumber(n);

export type StepView = {
  state?: FlowStepState;
  order?: number;
  badge?: string;
  input: string;
  output: string;
  /** Pointing at the agent's chat or a retry, when the step has one. */
  run?: string;
  retry?: boolean;
};
export type LogLine = { at: string; node: string; text: string; tone?: "ok" | "err" };
export type RunView = { steps: Map<string, StepView>; log: LogLine[]; ran: number };

/** What each step of the drawn flow did in one run. Steps follow the chain the definition runs in. */
export function viewRun(
  graph: FlowGraph,
  flow: string,
  e: FlowRun | undefined,
  t: T,
  who: (n: FlowNode) => string,
): RunView {
  const steps = new Map<string, StepView>();
  const log: LogLine[] = [];
  const checks = graph.nodes.filter((n) => n.kind === "condition");
  const outcome = e ? outcomeOf(e, checks.length) : undefined;
  const matched = outcome !== undefined && outcome !== "cut" && outcome !== "empty";
  let order = 0;
  let ran = 0;
  const put = (n: FlowNode, v: Omit<StepView, "order">) => {
    const counted = v.state && v.state !== "skipped";
    if (counted) ran++;
    steps.set(n.id, { ...v, ...(counted ? { order: ++order } : {}) });
  };
  for (const n of chainOrder(graph)) {
    const input = inputOf(n, flow, t, who);
    if (!e) {
      steps.set(n.id, { input, output: "" });
      continue;
    }
    const skipped = (why: MessageKey) =>
      put(n, { state: "skipped", badge: t("flow.legend.stepSkipped"), input, output: t(why) });
    switch (n.kind) {
      case "webhook":
        put(n, {
          state: "ran",
          badge: "ok",
          input,
          output: t(outcome === "empty" ? "flow.out.empty" : "flow.out.arrived", { id: e.event_id }),
        });
        log.push({
          at: e.created_at,
          node: n.id,
          text: t("flow.log.arrived", { path: hookPath(flow), id: e.event_id }),
        });
        break;
      case "condition":
        put(n, {
          state: outcome === "empty" ? "skipped" : "ran",
          badge: outcome === "empty" ? t("flow.legend.stepSkipped") : t(matched ? "flow.log.yes" : "flow.log.no"),
          input,
          output: outcome === "empty" ? t("flow.notRun") : t(matched ? "flow.out.matched" : "flow.out.noMatch"),
        });
        if (n === checks[0] && outcome !== "empty")
          log.push({
            at: e.created_at,
            node: n.id,
            text: t("flow.log.checks", { count: checks.length, result: t(matched ? "flow.log.yes" : "flow.log.no") }),
            tone: matched ? "ok" : undefined,
          });
        break;
      case "table_read":
        if (!matched) skipped(checks.length ? "flow.notRunCheck" : "flow.notRun");
        else put(n, { state: "ran", badge: "ok", input, output: t("flow.out.read", { keys: n.keys.join(", ") }) });
        break;
      case "table_write":
        if (!matched) skipped(checks.length ? "flow.notRunCheck" : "flow.notRun");
        else {
          put(n, { state: "ran", badge: "ok", input, output: t("flow.out.saved", { key: n.key }) });
          log.push({ at: e.created_at, node: n.id, text: t("flow.log.saved", { key: n.key }), tone: "ok" });
        }
        break;
      default:
        if (!matched) skipped(checks.length ? "flow.notRunCheck" : "flow.notRun");
        else actionStep(n, e, outcome, input, t, who(n), put, log);
    }
  }
  log.sort((a, b) => a.at.localeCompare(b.at));
  return { steps, log, ran };
}

function actionStep(
  n: FlowNode,
  e: FlowRun,
  outcome: RunOutcome | undefined,
  input: string,
  t: T,
  name: string,
  put: (n: FlowNode, v: Omit<StepView, "order">) => void,
  log: LogLine[],
) {
  const run = e.run_id ?? undefined;
  const took = e.run_started_at ? lasted(e.run_started_at, e.run_ended_at) : undefined;
  if (e.state === "failed") {
    put(n, {
      state: "failed",
      badge: t("flow.legend.stepFailed"),
      input,
      output: t("flow.out.notStarted"),
      retry: !run,
    });
    log.push({ at: e.created_at, node: n.id, text: t("flow.log.notStarted"), tone: "err" });
    return;
  }
  if (e.state === "pending") {
    put(n, { state: "live", badge: t("flow.run.pending"), input, output: t("flow.out.waiting") });
    log.push({ at: e.created_at, node: n.id, text: t("flow.log.queued") });
    return;
  }
  const done = outcome === "done";
  const failed = outcome === "failed";
  const output = done
    ? t("flow.out.answered")
    : e.run_state === "canceled"
      ? t("flow.out.canceled")
      : failed
        ? t("flow.out.failedRun")
        : outcome === "waiting"
          ? t("flow.out.waitingYou")
          : t("flow.out.working");
  put(n, {
    state: done ? "ran" : failed ? "failed" : "live",
    badge: done ? (took ? `ok · ${took}` : "ok") : t(OUTCOME[outcome ?? "live"].label),
    input,
    output,
    ...(run ? { run } : {}),
  });
  if (e.run_started_at) log.push({ at: e.run_started_at, node: n.id, text: t("flow.log.started", { who: name }) });
  if (e.run_ended_at)
    log.push({
      at: e.run_ended_at,
      node: n.id,
      text: [
        t(failed ? "flow.log.failed" : "flow.log.ended", { who: name }),
        ...(e.run_tokens ? [t("flow.tokens", { count: tokens(e.run_tokens) })] : []),
      ].join(" · "),
      tone: failed ? "err" : "ok",
    });
}

/** The step's settings as one readable line: what it was given. */
export function inputOf(n: FlowNode, flow: string, t: T, who: (n: FlowNode) => string): string {
  switch (n.kind) {
    case "webhook":
      return `POST ${hookPath(flow)}`;
    case "condition":
      return n.input.kind === "event"
        ? t("flow.in.check", { field: dotted(n.input.path), value: literal(n.equals) })
        : literal(n.equals);
    case "table_read":
      return t("flow.in.keys", { keys: n.keys.join(", ") });
    case "table_write":
      return t("flow.in.key", { key: n.key });
    case "agent":
      return `${who(n)} · ${n.prompt}`;
    case "routine":
      return who(n);
    case "llm":
      return `${n.model} · ${n.prompt}`;
  }
}

export const logClock = clock;
/** Whole-run summary under the header: duration from arrival to the end of its run, and tokens it spent. */
export function runFacts(e: FlowRun, t: T) {
  return {
    took: e.run_ended_at ? lasted(e.created_at, e.run_ended_at) : undefined,
    tokens: e.run_tokens ? t("flow.tokens", { count: tokens(e.run_tokens) }) : undefined,
  };
}
