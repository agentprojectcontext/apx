import type { FlowStepState, RunBar } from "@apx/ui";
import { formatNumber, formatSeconds, shortWhen } from "../common/format.ts";
import { currentLocale, isKey, type MessageKey } from "../i18n/index.ts";
import type { RunDetail } from "./data.ts";
import {
  chainOrder,
  dotted,
  type FlowGraph,
  type FlowNode,
  type FlowRun,
  hookPath,
  isTrigger,
  literal,
  presetOf,
} from "./steps.tsx";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** How a whole run ended, from what the core recorded: the event's state and its linked run. */
export type RunOutcome =
  | "done"
  | "saved"
  | "cut"
  | "empty"
  | "failed"
  | "live"
  | "pending"
  | "waiting"
  | "uncertain"
  | "timeout"
  | "stopped";
export function outcomeOf(e: FlowRun, checks: number): RunOutcome {
  if (e.executor === "graph") {
    if (e.state === "pending") return "live";
    if (e.state === "ignored") return "empty";
    if (e.state === "succeeded") return e.stopped_by ? "cut" : "done";
    if (e.state === "uncertain") return "uncertain";
    if (e.state === "cancelled") return e.cancelled_by_owner ? "stopped" : "timeout";
    return "failed";
  }
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
  uncertain: { label: "flow.run.uncertain", bar: "failed", tone: "warning" },
  timeout: { label: "flow.run.timeout", bar: "failed", tone: "danger" },
  stopped: { label: "flow.run.stopped", bar: "cut", tone: "neutral" },
};

/** A run's next time in the owner's zone: "In 4 min", "Today · 08:30", "Tomorrow · 03:00", "Mon · 08:30". */
export function nextWhen(iso: string, timeZone: string, t: T, now = new Date()): string {
  const at = new Date(iso);
  const mins = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (mins < 1) return t("flow.next.soon");
  if (mins < 60) return t("flow.next.inMin", { count: mins });
  const locale = currentLocale();
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const hm = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    at,
  );
  if (day(at) === day(now)) return t("flow.next.today", { time: hm });
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return t("flow.next.tomorrow", { time: hm });
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" })
    .format(at)
    .replace(".", "");
  return t("flow.next.day", { day: weekday, time: hm });
}

/** "08:30" in the owner's zone, for a time a schedule had due. */
export const dueTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(currentLocale(), { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
/** A scheduled run that started more than a minute after its time: the core was off then, and it ran once. */
export const ranLate = (e: { scheduled_at: string | null; created_at: string }) =>
  e.scheduled_at !== null && Date.parse(e.created_at) - Date.parse(e.scheduled_at) > 60_000;

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
      case "condition": {
        // The core records the first check the data did not pass: those before it passed, those after never ran.
        const at = checks.indexOf(n);
        const stop = e.stopped_at;
        const passed = matched || (stop !== null && at < stop);
        const unknown = !matched && stop === null;
        if (outcome === "empty" || (!matched && stop !== null && at > stop)) {
          put(n, { state: "skipped", badge: t("flow.legend.stepSkipped"), input, output: t("flow.notRun") });
          break;
        }
        put(n, {
          state: "ran",
          ...(unknown ? {} : { badge: t(passed ? "flow.log.yes" : "flow.log.no") }),
          input,
          output: t(passed ? "flow.out.matched" : unknown ? "flow.out.noMatch" : "flow.out.thisNo"),
        });
        if (n === checks[0])
          log.push({
            at: e.created_at,
            node: n.id,
            text: t("flow.log.checks", { count: checks.length, result: t(matched ? "flow.log.yes" : "flow.log.no") }),
            tone: matched ? "ok" : undefined,
          });
        break;
      }
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
    case "schedule": {
      const preset = presetOf(n.cron);
      return preset ? `${t(preset.label)} · ${n.cron}` : n.cron;
    }
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
    case "notify":
      return `${who(n)}\n\n${n.text}`;
    case "http":
      return `${n.method} ${n.url}`;
  }
}

/** A JSON body laid out to read; any other text as it is. */
const pretty = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

/** What a notify or HTTP step sent or asked, from its record (secrets show as their secret://name). */
function outwardInput(n: FlowNode, text: string | null, t: T): string | undefined {
  if (text === null || (n.kind !== "notify" && n.kind !== "http")) return undefined;
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (n.kind === "notify")
      return `${String(v.channel)} → ${v.owner === true ? t("flow.f.toYou") : String(v.to)}\n\n${String(v.text)}`;
    const headers = (v.headers as { name: string; value: string }[] | undefined) ?? [];
    return [
      `${String(v.method)} ${String(v.url)}`,
      ...headers.map((h) => `${h.name}: ${h.value}`),
      ...(typeof v.body === "string" ? ["", pretty(v.body)] : []),
    ].join("\n");
  } catch {
    return text;
  }
}

/** What came back: who got the message, or the service's status and answer. */
function outwardOutput(n: FlowNode, text: string | null, t: T): string | undefined {
  if (text === null || (n.kind !== "notify" && n.kind !== "http")) return undefined;
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (n.kind === "notify")
      return v.owner === true
        ? t("flow.out.sentYou", { channel: String(v.channel) })
        : t("flow.out.sent", { to: String(v.to), channel: String(v.channel) });
    const answer =
      v.json !== undefined
        ? JSON.stringify(v.json, null, 2)
        : typeof v.body === "string"
          ? v.body
          : v.location
            ? `Location: ${String(v.location)}`
            : "";
    return [t("flow.out.status", { status: String(v.status) }), answer].filter(Boolean).join("\n\n");
  } catch {
    return text;
  }
}

export const logClock = clock;
/** Whole-run summary under the header: duration from arrival to the end of its run, and tokens it spent. */
export function runFacts(e: FlowRun, t: T) {
  return {
    took: (e.ended_at ?? e.run_ended_at) ? lasted(e.created_at, e.ended_at ?? e.run_ended_at) : undefined,
    tokens: e.run_tokens ? t("flow.tokens", { count: tokens(e.run_tokens) }) : undefined,
  };
}

const JSON_TEXT = (text: string | null) => {
  if (text === null) return "";
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "string") return value;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "text" in value &&
      typeof value.text === "string"
    )
      return value.text;
    return JSON.stringify(value, null, 2);
  } catch {
    return text;
  }
};

/** What each step of a drawn flow did in one graph run, from the core's per-step records. */
export function viewGraphRun(run: RunDetail, flow: string, t: T, who: (n: FlowNode) => string): RunView {
  const steps = new Map<string, StepView>();
  const log: LogLine[] = [];
  const records = new Map(run.steps.map((s) => [s.node, s]));
  let order = 0;
  let ran = 0;
  for (const n of chainOrder(run.graph)) {
    const r = records.get(n.id);
    const settings = inputOf(n, flow, t, who);
    if (!r) {
      steps.set(n.id, { input: settings, output: run.state === "ignored" ? t("flow.out.empty") : "" });
      continue;
    }
    const took = r.started_at && r.ended_at ? lasted(r.started_at, r.ended_at) : undefined;
    const matched = n.kind === "condition" && r.state === "succeeded" ? r.output === '{"matched":true}' : undefined;
    const state: StepView["state"] =
      r.state === "succeeded"
        ? "ran"
        : r.state === "failed" || r.state === "uncertain"
          ? "failed"
          : r.state === "running" || r.state === "waiting_run"
            ? "live"
            : r.state === "pending"
              ? undefined
              : "skipped";
    const output =
      r.state === "succeeded" && isTrigger(n.kind)
        ? startedText(run, t)
        : r.state === "succeeded"
          ? matched === undefined
            ? (outwardOutput(n, r.output, t) ?? JSON_TEXT(r.output))
            : t(matched ? "flow.out.matched" : "flow.out.thisNo")
          : r.state === "skipped"
            ? r.error
              ? whyText(r.error, t)
              : t("flow.notRunBranch")
            : r.state === "blocked"
              ? t("flow.notRunFailed")
              : r.state === "pending"
                ? t("flow.out.waiting")
                : r.state === "running" || r.state === "waiting_run"
                  ? t("flow.out.working")
                  : whyText(r.error, t);
    const badge =
      matched !== undefined
        ? t(matched ? "flow.log.yes" : "flow.log.no")
        : r.state === "succeeded"
          ? took
            ? `ok · ${took}`
            : "ok"
          : r.state === "uncertain"
            ? t("flow.run.uncertain")
            : r.state === "failed"
              ? t("flow.legend.stepFailed")
              : r.state === "running" || r.state === "waiting_run"
                ? t("flow.run.live")
                : r.state === "pending"
                  ? undefined
                  : t("flow.legend.stepSkipped");
    const counted = state && state !== "skipped";
    if (counted) ran++;
    steps.set(n.id, {
      ...(state ? { state } : {}),
      ...(counted ? { order: ++order } : {}),
      ...(badge ? { badge } : {}),
      input: r.input === null ? settings : (outwardInput(n, r.input, t) ?? JSON_TEXT(r.input)),
      output,
      ...(r.run_id ? { run: r.run_id } : {}),
    });
    const name = n.label;
    if (
      r.started_at &&
      (n.kind === "agent" || n.kind === "routine" || n.kind === "llm" || n.kind === "notify" || n.kind === "http")
    )
      log.push({ at: r.started_at, node: n.id, text: t("flow.log.started", { who: name }) });
    if (r.ended_at && r.state !== "skipped" && r.state !== "blocked")
      log.push({
        at: r.ended_at,
        node: n.id,
        text:
          matched !== undefined
            ? t("flow.log.checked", { step: name, result: t(matched ? "flow.log.yes" : "flow.log.no") })
            : r.state === "succeeded"
              ? t("flow.log.ended", { who: name })
              : `${t("flow.log.failed", { who: name })} · ${whyText(r.error, t)}`,
        tone: r.state === "succeeded" ? "ok" : "err",
      });
  }
  log.push({
    at: run.created_at,
    node: run.graph.nodes.find((n) => isTrigger(n.kind))?.id ?? "",
    text:
      run.source === "webhook" ? t("flow.log.arrived", { path: hookPath(flow), id: run.event }) : startedText(run, t),
  });
  log.sort((a, b) => a.at.localeCompare(b.at));
  return { steps, log, ran };
}

/** How a run started, for its trigger step: by a POST (its body), by its schedule, or by the owner. */
function startedText(run: RunDetail, t: T): string {
  const trigger = run.steps.find((s) => run.graph.nodes.some((n) => n.id === s.node && isTrigger(n.kind)));
  if (run.source === "owner") return t("flow.out.byYou");
  if (run.source === "schedule" && run.scheduled_at) {
    const due = new Date(run.scheduled_at).toLocaleTimeString(currentLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return t(ranLate(run) ? "flow.out.dueLate" : "flow.out.due", { time: due });
  }
  return JSON_TEXT(trigger?.output ?? null);
}

/** A step's recorded reason, in the person's words. */
export function whyText(code: string | null, t: T): string {
  const key = `flow.why.${code ?? "other"}`;
  return isKey(key) ? t(key) : t("flow.why.other");
}
