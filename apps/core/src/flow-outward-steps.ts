// Notify and HTTP steps of a graph run (DECISIONS.md#d-169). Both act outside APX, so each goes out at most once: a
// send or a non-GET request commits `dispatched` right before it can reach the other side, and anything after that
// without a clear answer is left uncertain for the owner, never repeated. Destinations are the revision's own fields.
import type { FlowBinding, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import type { FlowGraphRun, FlowStepKey } from "./domain/flow-graph-runs.ts";
import {
  boundedFlowValue,
  type FlowNodeSnapshot,
  flowVarIndex,
  resolveFlowInput,
} from "./domain/flow-graph-semantics.ts";
import { flowSecretVars, secretTemplate } from "./domain/flow-secret-vars.ts";
import { type FlowApx, parseFlowTemplate, renderFlowTemplate } from "./domain/flow-template.ts";
import type { Store } from "./domain/store.ts";
import type { RunTimers } from "./engine/engine.ts";
import { type FlowHttpAnswer, FlowHttpError, type FlowHttpPolicy, flowHttpRequest } from "./flow-http.ts";
import { notifyDestination, SECRET_REF } from "./flow-outward.ts";

type Notify = Extract<FlowNode, { kind: "notify" }>;
type Http = Extract<FlowNode, { kind: "http" }>;

/** Messages a Flow may send as the owner in an hour; the next one fails, unsent. */
export const FLOW_SENDS_PER_HOUR = 20;
/** Requests that may change something (POST, PUT) a Flow makes in an hour; the next one fails, unsent. */
export const FLOW_CALLS_PER_HOUR = 60;
/** How long a send waits for its channel to say how it went before it is left to look at. */
const SEND_WAIT_MS = 60_000;
const BODY_LIMIT = 32 * 1024;
const SHOWN_BODY = 16 * 1024;
const SHOWN_JSON = 24 * 1024;

export const OUTWARD_WHY = {
  nothing: "nothing_to_tell",
  limited: "rate_limited",
  destination: "destination_unavailable",
  sendFailed: "send_failed",
  sendUnknown: "send_uncertain",
  channelDown: "channel_unavailable",
  refused: "destination_refused",
  requestFailed: "request_failed",
  requestUnknown: "request_uncertain",
  invalid: "value_invalid",
  secret: "secret_missing",
  missing: "missing_value",
  value: "value_too_large",
  start: "not_started",
} as const;

/** Sends a notify step's text through the owner's channels. */
export type FlowNotifier = {
  /** Sends as the owner to the step's fixed destination; throws when it is gone. Returns the outbox item. */
  send(node: Notify, text: string, flow: string): { outbox: string };
  /** How the send went, waiting up to `ms`: sent, failed, uncertain or still queued. */
  settled(outbox: string, ms: number): Promise<{ state: string }>;
  /** Takes back a send no channel has taken yet; false once it may have gone out. */
  withdraw(outbox: string): boolean;
};

/**
 * What a payload put in a message can't become a link or a ping in the owner's name: a Markdown link loses its form
 * and an @handle its mention (a zero-width space after an @ that starts a word; an email stays as it is).
 */
export const plainBound = (text: string) => text.replace(/\]\(/g, "] (").replace(/(^|[^\w.+-])@(?=\w)/g, "$1@\u200b");
export type FlowHttpDeps = { policy: FlowHttpPolicy; secret(ref: string, project: string): string | undefined };

class StepRefused extends Error {
  readonly why: string;
  constructor(why: string) {
    super(why);
    this.why = why;
  }
}

/** What `$apx.…` reads in a run's templates: its project's name, the moment and the run's id. */
export function flowApx(store: Store, run: Pick<FlowGraphRun, "flow" | "event">, at: Date): FlowApx {
  const project = store.flows.get(run.flow)?.projectId;
  return {
    project: (project && store.projects.get(project)?.name) || "",
    now: at.toISOString(),
    run: run.event,
  };
}

/** A request body: JSON stays JSON, a placeholder alone in a string takes the bound value's type. */
function renderBody(
  template: string,
  resolve: (b: FlowBinding) => unknown,
  apx: FlowApx,
): { text: string; json: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(template);
  } catch {}
  if (parsed === null || typeof parsed !== "object")
    return { text: renderFlowTemplate(parseFlowTemplate(template), resolve, { apx }).text, json: false };
  const fill = (v: unknown): unknown => {
    if (typeof v === "string") {
      const parts = parseFlowTemplate(v);
      const only = parts.length === 1 ? parts[0] : undefined;
      return only && "binding" in only ? resolve(only.binding) : renderFlowTemplate(parts, resolve, { apx }).text;
    }
    if (Array.isArray(v)) return v.map(fill);
    // Keys are the owner's; fromEntries keeps a "__proto__" key as data.
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return { text: JSON.stringify(boundedFlowValue(fill(parsed))), json: true };
}

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|problem\+json)|[^;]*\+(json|xml))/i;

/** Cuts secrets a step used from text it keeps: as sent, URL-encoded or JSON-escaped. */
export function secretScrubber(secrets: readonly string[]): (text: string) => string {
  const forms = secrets
    .filter((s) => s.length >= 4)
    .flatMap((s) => [s, encodeURIComponent(s), JSON.stringify(s).slice(1, -1), s.replaceAll("/", "\\/")]);
  return (t) => forms.reduce((x, s) => x.split(s).join("[secret]"), t);
}

/** What a step keeps of an answer: status, a bounded text or JSON body, binary only said, the secrets it used cut. */
export function answerOutput(a: FlowHttpAnswer, secrets: readonly string[]) {
  const scrub = secretScrubber(secrets);
  const deep = (v: unknown): unknown =>
    typeof v === "string"
      ? scrub(v)
      : Array.isArray(v)
        ? v.map(deep)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), deep(x)]))
          : v;
  const type = String(a.headers["content-type"] ?? "").slice(0, 200);
  const out: Record<string, unknown> = {
    status: a.status,
    ok: a.status >= 200 && a.status < 300,
    bytes: a.bytes.length,
    truncated: a.truncated,
  };
  if (type) out.content_type = type;
  const location = a.headers.location;
  if (typeof location === "string") out.location = scrub(location).slice(0, 2000);
  if (!a.bytes.length) return out;
  let text: string | undefined;
  if ((!type || TEXTUAL.test(type)) && !a.bytes.includes(0)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(a.bytes, { stream: a.truncated });
    } catch {}
  }
  if (text === undefined) {
    out.binary = true;
    return out;
  }
  const clean = scrub(text);
  if (!a.truncated && (/json/i.test(type) || /^\s*[[{]/.test(clean))) {
    try {
      const json = deep(boundedFlowValue(JSON.parse(clean)));
      if (Buffer.byteLength(JSON.stringify(json)) <= SHOWN_JSON) {
        out.json = json;
        return out;
      }
    } catch {}
  }
  const body = Buffer.from(clean, "utf8");
  if (body.length > SHOWN_BODY) {
    out.body = new TextDecoder().decode(body.subarray(0, SHOWN_BODY), { stream: true });
    out.truncated = true;
  } else out.body = clean;
  return out;
}

export function createOutwardSteps(deps: {
  store: Store;
  timers: RunTimers;
  notifier?: FlowNotifier | undefined;
  http?: FlowHttpDeps | undefined;
  /** Registers a call in flight so a stop or the deadline aborts it. */
  track(ac: AbortController, run: FlowGraphRun): () => void;
}) {
  const { store } = deps;
  const runs = store.flowGraphRuns;
  const now = () => new Date(deps.timers.now());
  const W = OUTWARD_WHY;
  const fail = (k: FlowStepKey, from: "pending" | "running", why: string, to: "failed" | "uncertain" = "failed") =>
    runs.settle(k, [from], to, now(), why);

  async function notify(run: FlowGraphRun, node: Notify, k: FlowStepKey, snapshots: Map<string, FlowNodeSnapshot>) {
    const resolve = (b: FlowBinding) => resolveFlowInput(b, run.payload, snapshots);
    let text: string;
    try {
      const out = renderFlowTemplate(parseFlowTemplate(node.text), resolve, {
        missing: node.onlyIfContent ? "empty" : "throw",
        bound: plainBound,
        apx: flowApx(store, run, now()),
      });
      if (node.onlyIfContent && (out.empty || !out.text.trim())) {
        runs.settle(k, ["pending"], "skipped", now(), W.nothing);
        return;
      }
      text = out.text.trim().slice(0, 4000);
      if (!text) throw new StepRefused(W.missing);
    } catch (err) {
      fail(k, "pending", err instanceof StepRefused ? err.why : W.missing);
      return;
    }
    const dest = notifyDestination(store, node);
    if (!dest || !deps.notifier) {
      fail(k, "pending", W.destination);
      return;
    }
    const input = { channel: dest.channel.label, to: dest.to, ...(dest.owner ? { owner: true } : {}), text };
    try {
      if (!runs.claim(k, input, now(), "reserved")) return;
    } catch {
      fail(k, "pending", W.value);
      return;
    }
    // Rate, record and the commit that it may go out: one transaction, before the channel is asked.
    const at = now();
    const go = store.tx(() => {
      const since = new Date(at.getTime() - 3600_000);
      if (store.flowSends.count(run.flow, "message", since) >= FLOW_SENDS_PER_HOUR) return "limited";
      if (!runs.dispatch(k, at, run.deadline)) return "ended";
      store.flowSends.add(run.flow, "message", at);
      return "go";
    });
    if (go === "limited") fail(k, "running", W.limited);
    if (go !== "go") return;
    let outbox: string;
    try {
      outbox = deps.notifier.send(node, text, store.flows.get(run.flow)?.name ?? run.flow).outbox;
    } catch {
      // Refused before anything was queued: the contact or room is no longer there.
      fail(k, "running", W.destination);
      return;
    }
    // Stopped or closing while it waits: the step is left as it stands (a restart marks it uncertain).
    const ac = new AbortController();
    const untrack = deps.track(ac, run);
    const d = await Promise.race([
      deps.notifier.settled(outbox, Math.max(0, Math.min(SEND_WAIT_MS, run.deadline - deps.timers.now()))),
      new Promise<{ state: "stopped" }>((resolve) =>
        ac.signal.addEventListener("abort", () => resolve({ state: "stopped" }), { once: true }),
      ),
    ]).finally(untrack);
    // Not taken by its channel yet (it isn't running): taken back, so it never goes out later in the owner's name. A
    // core closing leaves it queued: it goes out after the restart, and the step says to look.
    const closing = (ac.signal.reason as Error | undefined)?.message === "closing";
    const withdrawn = d.state !== "sent" && !closing && deps.notifier.withdraw(outbox);
    if (d.state === "stopped") return;
    if (withdrawn) fail(k, "running", W.channelDown);
    else if (d.state === "sent") runs.succeed(k, "running", { ...input, delivery: "sent" }, now(), run.deadline);
    else if (d.state === "failed") fail(k, "running", W.sendFailed);
    else fail(k, "running", W.sendUnknown, "uncertain");
  }

  async function http(run: FlowGraphRun, node: Http, k: FlowStepKey, snapshots: Map<string, FlowNodeSnapshot>) {
    const project = store.flows.get(run.flow)?.projectId ?? "";
    const resolve = (b: FlowBinding) => resolveFlowInput(b, run.payload, snapshots);
    const used: string[] = [];
    const apx = flowApx(store, run, now());
    const headers: Record<string, string> = {};
    const shown: { name: string; value: string }[] = [];
    let body: { text: string; json: boolean } | undefined;
    try {
      if (!deps.http) throw new StepRefused(W.start);
      const http = deps.http;
      const secretVars = flowSecretVars(run.graph);
      for (const h of node.headers) {
        const parts = secretTemplate(h.value, flowVarIndex(run.graph), secretVars);
        if (!parts) throw new StepRefused(W.invalid);
        // Secret references are read only in the owner's own text, never in a value the payload brought.
        const real = renderFlowTemplate(parts, resolve, {
          apx,
          literal: (t) =>
            t.replace(SECRET_REF, (ref) => {
              const value = http.secret(ref, project);
              if (value === undefined) throw new StepRefused(W.secret);
              used.push(value);
              return value;
            }),
        }).text;
        if (/[\r\n\0]/.test(real)) throw new StepRefused(W.invalid);
        headers[h.name.toLowerCase()] = real;
        shown.push({ name: h.name, value: renderFlowTemplate(parts, resolve, { apx }).text });
      }
      if (node.method !== "GET" && node.body.trim()) {
        body = renderBody(node.body, resolve, apx);
        if (Buffer.byteLength(body.text) > BODY_LIMIT) throw new StepRefused(W.value);
        headers["content-type"] ??= body.json ? "application/json" : "text/plain; charset=utf-8";
      }
      headers["user-agent"] ??= "APX-Flow";
    } catch (err) {
      fail(k, "pending", err instanceof StepRefused ? err.why : W.missing);
      return;
    }
    const input = {
      method: node.method,
      url: node.url,
      headers: shown,
      ...(body ? { body: body.text.length > SHOWN_BODY ? `${body.text.slice(0, SHOWN_BODY)}…` : body.text } : {}),
    };
    const retryable = node.method === "GET";
    try {
      // A GET changes nothing: after a restart it can start over, so it never commits that it went out.
      if (!runs.claim(k, input, now(), retryable ? null : "reserved")) return;
    } catch {
      fail(k, "pending", W.value);
      return;
    }
    if (!retryable) {
      const at = now();
      const limited = store.tx(() => {
        if (store.flowSends.count(run.flow, "request", new Date(at.getTime() - 3600_000)) >= FLOW_CALLS_PER_HOUR)
          return true;
        store.flowSends.add(run.flow, "request", at);
        return false;
      });
      if (limited) {
        fail(k, "running", W.limited);
        return;
      }
    }
    const ac = new AbortController();
    const untrack = deps.track(ac, run);
    const stop = deps.timers.after(Math.max(0, Math.min(node.timeoutMs, run.deadline - deps.timers.now())), () =>
      ac.abort(),
    );
    let dispatched = false;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const answer = await flowHttpRequest(
            { method: node.method, url: node.url, headers, ...(body ? { body: body.text } : {}) },
            {
              policy: deps.http.policy,
              signal: ac.signal,
              onSend: () => {
                if (retryable) return !ac.signal.aborted;
                dispatched = runs.dispatch(k, now(), run.deadline);
                return dispatched;
              },
            },
          );
          try {
            runs.succeed(k, "running", answerOutput(answer, used), now(), run.deadline);
          } catch {
            fail(k, "running", W.value);
          }
          return;
        } catch (err) {
          const stage = err instanceof FlowHttpError ? err.stage : "unsent";
          if (stage === "refused") {
            fail(k, "running", W.refused);
            return;
          }
          // A GET that got no answer may try once more; any other request that may have gone out is left to look at.
          if (retryable && attempt === 0 && !ac.signal.aborted) continue;
          if (dispatched || (stage === "sent" && !retryable)) fail(k, "running", W.requestUnknown, "uncertain");
          else fail(k, "running", W.requestFailed);
          return;
        }
      }
    } finally {
      stop();
      untrack();
    }
  }

  return { notify, http };
}
