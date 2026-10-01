// The one executor every tool call goes through, whatever harness made it: check the arguments, ask the policy,
// wait for the owner when it says so, record the step, run with a deadline, keep the full output and hand the
// model a capped copy.
import type { MethodName, Params, Result, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { JobRecord } from "../domain/jobs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { TurnIO } from "../harness/index.ts";
import { authorize, decide, UNTRUSTED_MARK } from "../tools/policy.ts";
import { cap } from "../tools/result.ts";
import { commandRisk } from "../tools/shell.ts";
import type { Confirm, Tool, ToolContext } from "../tools/types.ts";
import type { Display } from "./display.ts";
import { EXTERNAL_INPUT_WAIT_MS, INPUT_WAIT_MS, type Inputs } from "./inputs.ts";
import type { Jobs } from "./jobs.ts";
import { insideReal } from "../paths.ts";
import { guarded, pathsOf } from "./paths.ts";

/** Runs a tool with its own deadline; a canceled turn stops waiting for it. */
async function runTool(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; text: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${tool.name} took longer than ${tool.deadlineMs / 1000}s`)),
      tool.deadlineMs,
    );
    if (ctx.signal.aborted) reject(ctx.signal.reason);
    ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
  });
  limit.catch(() => {});
  try {
    return { ok: true, text: await Promise.race([tool.run(args, ctx), limit]) };
  } catch (err) {
    const shape = (err as { shape?: { code: string; message: string } }).shape;
    return {
      ok: false,
      text: shape ? `${shape.code}: ${shape.message}` : err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The call's arguments for the confirmation card, whole: the owner must see everything they approve. */
function describe(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")
    .slice(0, 20_000);
}

export type Executor = {
  execute: TurnIO["execute"];
  approve: TurnIO["approve"];
  observe: TurnIO["observe"];
  readonly toolsRan: number;
};

/** Tool kinds (Agent Client Protocol's names) that only look: an external agent uses them without asking. */
const LOOKING = new Set(["read", "search", "think", "fetch"]);

export function createExecutor(o: {
  store: Store;
  inputs: Inputs;
  tools: Tool[];
  agent: AgentRecord;
  thread: Thread;
  run: () => RunRecord;
  display: Display;
  signal: AbortSignal;
  /** Whether untrusted text is already in the context when the turn starts (history or the input itself). */
  untrusted: boolean;
  /** The harness running the turn reaches tools over a deadline-bound call (Claude Code, Codex). */
  external: () => boolean;
  call<M extends MethodName>(method: M, params: Params<M>, as: { run: RunRecord; callId: string }): Promise<Result<M>>;
  delegate: ToolContext["delegate"];
  jobs: Jobs;
  /** APX's own port: a command that reaches it always asks. */
  apxPort?: number | undefined;
  /** Where an external agent works outside code threads. */
  workDir: string;
}): Executor {
  const { store, display, signal, agent, thread } = o;
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  let untrusted = o.untrusted;
  let toolsRan = 0;

  /** A command as a terminal job of this run. Foreground: waits, stops it at the timeout or when the turn stops. */
  const runCommand = async (
    c: { command: string; cwd: string; background: boolean; timeoutMs: number },
    run: RunRecord,
  ): Promise<{ job: JobRecord; output: string }> => {
    const { job, done } = o.jobs.start({
      command: c.command,
      cwd: c.cwd,
      thread_id: thread.id,
      run_id: run.id,
      agent_id: agent.id,
      background: c.background,
    });
    if (c.background) return { job, output: "" };
    const stop = () => o.jobs.cancel(job.id);
    const timer = setTimeout(stop, c.timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    try {
      const ended = await done;
      return { job: ended, output: o.jobs.read(job.id, undefined, 60_000).output };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
  };

  const execute: TurnIO["execute"] = async (callId, name, raw) => {
    const run = o.run();
    const tool = byName.get(name);
    const title = tool ? tool.title(raw) : name;
    const card = (status: "running" | "ok" | "error", detail?: string) =>
      display.upsert((p) => p.type === "tool" && p.call_id === callId, {
        type: "tool",
        call_id: callId,
        tool: name,
        title,
        status,
        ...(detail ? { detail } : {}),
      });
    card("running");
    if (signal.aborted) throw signal.reason ?? new Error("canceled");
    if (!tool) {
      card("error", "unknown tool");
      return { ok: false, text: `unknown tool ${name}` };
    }
    const parsed = tool.parse(raw);
    if (!parsed.ok) {
      card("error", "invalid arguments");
      return { ok: false, text: parsed.error };
    }
    const args = parsed.args;

    // A read-only code thread refuses anything that would need an OK, before anyone is asked.
    const level = tool.confirm(args);
    if (thread.kind === "code" && thread.write === "read-only" && (level === "ask" || level === "always")) {
      card("error", "read-only thread");
      return { ok: false, text: "refused: this code thread is read-only; only actions that read may run here" };
    }
    const decision = authorize(tool, args, agent, untrusted);
    if (decision.kind === "confirm" && !o.inputs.takeGrant(thread.id, agent.id, name, raw)) {
      const answer = await o.inputs.ask({
        run,
        agent,
        display,
        callId,
        kind: "confirm",
        prompt: `${agent.name} wants to use ${name}: ${decision.reason}.`,
        tool: name,
        args: raw,
        detail: describe(args),
        waitMs: o.external() ? EXTERNAL_INPUT_WAIT_MS : INPUT_WAIT_MS,
        signal,
      });
      if (signal.aborted) throw signal.reason ?? new Error("canceled");
      if (answer.state !== "approved") {
        const why = answer.state === "denied" ? "the owner declined" : "the owner did not answer in time";
        card("error", why);
        return {
          ok: false,
          text: `not run: ${why}${answer.answer ? ` (their note: ${answer.answer})` : ""}. Do not retry it; tell the owner or continue without it.`,
        };
      }
    }

    toolsRan++;
    const stepId = store.runs.beginStep(run.id, { call_id: callId, tool: name, args, effect: tool.effect });
    store.runs.setActivity(run.id, title, true);
    const ctx: Omit<ToolContext, "runCommand"> = {
      agent,
      thread,
      run,
      signal,
      untrusted: () => untrusted,
      upsertPart: display.upsert,
      call: (method, params) => o.call(method, params, { run, callId }),
      delegate: o.delegate,
      askOwner: (prompt, options) =>
        o.inputs.ask({
          run,
          agent,
          display,
          callId,
          kind: "question",
          prompt,
          options,
          waitMs: o.external() ? EXTERNAL_INPUT_WAIT_MS : INPUT_WAIT_MS,
          signal,
        }),
    };
    const out = await runTool(tool, args, { ...ctx, runCommand: (c) => runCommand(c, run) });
    if (out.text.includes(UNTRUSTED_MARK)) untrusted = true;
    const full = out.text.slice(0, 2_000_000);
    store.runs.endStep(run.id, callId, out.ok ? "ok" : "error", out.text.slice(0, 4000), full);
    if (signal.aborted) throw signal.reason ?? new Error("canceled");
    card(out.ok ? "ok" : "error", out.text.slice(0, 300));
    // The model gets a capped copy; the whole text stays in the step for read_output.
    const shown = cap(out.text);
    return {
      ok: out.ok,
      text: shown === out.text ? shown : `${shown}\n[full output: ${out.text.length} chars; read_output ref=${stepId}]`,
    };
  };

  /**
   * An external agent's own tool, judged by the same rule as ours: reading inside its folder runs, a command is
   * classified like the shell tool's, fetching and anything that changes something ask (unless autonomy allows it).
   */
  const approve: TurnIO["approve"] = async (req) => {
    const base = thread.cwd ?? o.workDir;
    const paths = pathsOf(req.input);
    const command = (req.input as { command?: unknown } | undefined)?.command;
    const inside = paths.every((p) => insideReal(base, p));
    const reading = req.kind === "read" || req.kind === "search" || req.kind === "think";
    const level: Confirm = reading
      ? inside
        ? "never"
        : "ask"
      : req.kind === "fetch"
        ? thread.kind === "code"
          ? "ask"
          : "untrusted"
        : req.kind === "execute" && typeof command === "string"
          ? commandRisk(command, o.apxPort)
          : "ask";
    // A code thread's write policy comes first: read-only lets only reading run; auto lets edits inside its folder,
    // never to git's config, APC files or AGENTS.md.
    if (thread.kind === "code" && level !== "never") {
      if (thread.write === "read-only") return false;
      const editable = paths.length > 0 && inside && !paths.some((p) => guarded(base, p));
      if (thread.write === "auto" && req.kind === "edit" && editable) return true;
    }
    const decision = decide(level, reading ? "none" : "external", agent, untrusted);
    if (decision.kind === "allow") return true;
    const answer = await o.inputs.ask({
      run: o.run(),
      agent,
      display,
      callId: req.callId,
      kind: "confirm",
      prompt: `${agent.name} wants to ${req.kind === "other" ? "use a tool" : req.kind}: ${req.title}. ${decision.reason}.`,
      tool: req.kind,
      ...(req.detail ? { detail: req.detail } : {}),
      waitMs: INPUT_WAIT_MS,
      signal,
    });
    return answer.state === "approved";
  };

  const seen = new Set<string>();
  const observe: TurnIO["observe"] = (ev) => {
    const run = o.run();
    // What an external agent fetched from the web is now in its context.
    if (ev.kind === "fetch") untrusted = true;
    if (!seen.has(ev.callId)) {
      seen.add(ev.callId);
      const looks = LOOKING.has(ev.kind);
      if (!looks) toolsRan++;
      store.runs.beginStep(run.id, {
        call_id: ev.callId,
        tool: `external:${ev.kind}`,
        args: { title: ev.title },
        effect: looks ? "none" : "external",
      });
      store.runs.setActivity(run.id, ev.title, true);
    }
    if (ev.status !== "running")
      store.runs.endStep(run.id, ev.callId, ev.status === "ok" ? "ok" : "error", ev.detail ?? ev.status);
    display.upsert((p) => p.type === "tool" && p.call_id === ev.callId, {
      type: "tool",
      call_id: ev.callId,
      tool: ev.kind,
      title: ev.title,
      status: ev.status,
      ...(ev.detail ? { detail: ev.detail } : {}),
    });
  };

  return {
    execute,
    approve,
    observe,
    get toolsRan() {
      return toolsRan;
    },
  };
}
