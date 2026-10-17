// The one executor every tool call goes through, whatever harness made it: check the arguments, ask the policy,
// wait for the owner when it says so, record the step, run with a deadline, keep the full output and hand the
// model a capped copy.
import type { MethodName, Params, Result, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { strictApproval } from "../domain/approvals.ts";
import type { JobRecord } from "../domain/jobs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { worksInFolder } from "../domain/threads.ts";
import { errorMessage } from "../errors.ts";
import type { TurnIO } from "../harness/index.ts";
import { insideReal } from "../paths.ts";
import { MCP_CALL, MCP_SEARCH, unwrapCall } from "../tools/mcp-bridge.ts";
import { authorize, decide } from "../tools/policy.ts";
import { cap, UNTRUSTED_MARK } from "../tools/result.ts";
import { commandRisk } from "../tools/shell.ts";
import type { CheckContext, Confirm, Tool, ToolContext } from "../tools/types.ts";
import type { Display } from "./display.ts";
import type { Inputs } from "./inputs.ts";
import type { Jobs } from "./jobs.ts";
import { confirmPrompt } from "./owner-words.ts";
import { guarded, pathsOf } from "./paths.ts";
import { toolTitle } from "./tool-titles.ts";

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
    return { ok: false, text: failure(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** A tool's failure as the model reads it: a method's own code and message, or the error's. */
function failure(err: unknown): string {
  const shape = (err as { shape?: { code: string; message: string } }).shape;
  return shape ? `${shape.code}: ${shape.message}` : errorMessage(err);
}

/** The tool's own pre-check (the task exists, the column is real): why the call cannot run, or undefined. */
async function precheck(tool: Tool, args: Record<string, unknown>, ctx: CheckContext): Promise<string | undefined> {
  try {
    await tool.check?.(args, ctx);
    return undefined;
  } catch (err) {
    return failure(err);
  }
}

/** How much of a call the confirmation card shows: the owner must see everything they approve. */
const CONFIRM_DETAIL_CHARS = 20_000;
/** A foreground command's output handed back to the model (the rest stays in the job's file). */
const FOREGROUND_OUTPUT_CHARS = 60_000;
/** A step's full output kept for read_output, its short summary, and the line shown on its card. */
const STORED_OUTPUT_CHARS = 2_000_000;
const STEP_SUMMARY_CHARS = 4000;
const CARD_DETAIL_CHARS = 300;

/** The call's arguments for the confirmation card, whole. */
function describe(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")
    .slice(0, CONFIRM_DETAIL_CHARS);
}

export type Executor = {
  execute: TurnIO["execute"];
  approve: TurnIO["approve"];
  observe: TurnIO["observe"];
  readonly toolsRan: number;
  /** Whether outside content is in the turn so far. */
  readonly untrusted: boolean;
};

/** Tool kinds (Agent Client Protocol's names) that only read: inside the agent's folder they run without asking. */
const READING = new Set(["read", "search", "think"]);
/** Kinds that only look (reading, or fetching a page): shown as cards, recorded as steps without effects. */
const LOOKING = new Set([...READING, "fetch"]);

export function createExecutor(o: {
  store: Store;
  inputs: Inputs;
  tools: Tool[];
  /** Tools that join on first use (MCP's): mcp_call names one, and grant_tool may grant one. */
  late?: () => Promise<Tool[]>;
  agent: AgentRecord;
  thread: Thread;
  run: () => RunRecord;
  display: Display;
  signal: AbortSignal;
  /** Whether untrusted text is already in the context when the turn starts (history or the input itself). */
  untrusted: boolean;
  /** The harness running the turn reaches tools over a deadline-bound call (Claude Code, Codex). */
  external: () => boolean;
  call<M extends MethodName>(
    method: M,
    params: Params<M>,
    as: { run: RunRecord; callId: string; owner?: boolean },
  ): Promise<Result<M>>;
  delegate: ToolContext["delegate"];
  jobs: Jobs;
  /** APX's own port: a command that reaches it always asks. */
  apxPort: () => number;
  /** Where an outside agent works (harnessDir): its tools are checked against this folder. */
  workDir: string;
}): Executor {
  const { store, display, signal, agent, thread } = o;
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  let joined = false;
  const join = async () => {
    if (joined || !o.late) return;
    joined = true;
    for (const t of await o.late()) if (!byName.has(t.name)) byName.set(t.name, t);
  };
  let untrusted = o.untrusted;
  let toolsRan = 0;

  /**
   * A command as a terminal job of this run, stopped at its timeout. Foreground: waits, and also stops when the turn
   * stops; background: returns at once.
   */
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
    if (c.background) {
      // A background job outlives the turn, not its deadline (rule 9).
      const timer = setTimeout(() => o.jobs.cancel(job.id), c.timeoutMs);
      timer.unref();
      const clear = () => clearTimeout(timer);
      done.then(clear, clear);
      return { job, output: "" };
    }
    const stop = () => o.jobs.cancel(job.id);
    const timer = setTimeout(stop, c.timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    try {
      const ended = await done;
      return { job: ended, output: o.jobs.read(job.id, undefined, FOREGROUND_OUTPUT_CHARS).output };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
  };

  const execute: TurnIO["execute"] = async (callId, called, given) => {
    const run = o.run();
    // mcp_call runs the tool it names, through every check below as if the model had called that tool itself.
    const { name, args: raw } = called === MCP_CALL ? unwrapCall(given) : { name: called, args: given };
    if (called === MCP_CALL || name === "grant_tool" || (name.startsWith("mcp_") && !byName.has(name))) await join();
    const bridged = called !== MCP_CALL || (name.startsWith("mcp_") && name !== MCP_CALL && name !== MCP_SEARCH);
    const tool = bridged ? byName.get(name) : undefined;
    const title = tool ? toolTitle(store, tool, raw) : name;
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
    signal.throwIfAborted();
    if (!tool) {
      card("error", "unknown tool");
      return {
        ok: false,
        text: `unknown tool ${name}${called === MCP_CALL ? `; ${MCP_CALL} runs a tool ${MCP_SEARCH} found` : ""}`,
      };
    }
    const parsed = tool.parse(raw);
    if (!parsed.ok) {
      card("error", "invalid arguments");
      return { ok: false, text: parsed.error };
    }
    const args = parsed.args;
    // Before anyone is asked: a call that could only fail ends here, and the model learns which argument is wrong.
    const problem = await precheck(tool, args, { agent, thread });
    if (problem !== undefined) {
      card("error", problem.slice(0, CARD_DETAIL_CHARS));
      return { ok: false, text: `not run, nothing was asked of the owner: ${problem}` };
    }

    // A read-only code thread refuses anything that would need an OK, before anyone is asked.
    const level = tool.confirm(args);
    if (worksInFolder(thread) && thread.write === "read-only" && (level === "ask" || level === "always")) {
      card("error", "read-only thread");
      const why =
        tool.name === "shell"
          ? "this command is not a plain read (see [workspace] in the turn's context for what runs)"
          : "only actions that read may run here";
      return { ok: false, text: `refused: this code thread is read-only; ${why}` };
    }
    const decision = authorize(tool, args, agent, untrusted);
    if (decision.kind === "deny") {
      card("error", "turned off");
      return {
        ok: false,
        text: `not run: ${decision.reason}. Do not retry it; tell the owner or continue without it.`,
      };
    }
    // A call that always asks has its own grant, apart from the tool's ordinary one (DECISIONS.md#d-089).
    const target = level === "always" && tool.approval ? strictApproval(tool.approval) : tool.approval;
    if (
      decision.kind === "confirm" &&
      !(target && store.approvals.allows(target, thread.id, agent.id, args)) &&
      !o.inputs.takeGrant(thread.id, agent.id, name, raw, target?.key)
    ) {
      const answer = await o.inputs.ask({
        run,
        agent,
        display,
        callId,
        kind: "confirm",
        prompt: confirmPrompt(store, decision.why, agent.name, name),
        tool: name,
        approval: target,
        args: raw,
        detail: describe(args),
        // A preview that fails only costs the patch: the owner still sees the arguments.
        change: await tool.preview?.(args, { agent, thread }).catch(() => undefined),
        external: o.external(),
        stays: true,
        signal,
      });
      signal.throwIfAborted();
      if (answer.state === "pending") {
        card("error", "waiting for the owner");
        return {
          ok: false,
          text: "not run yet: the owner has not answered. The request stays open in the chat; if they approve it, a new turn tells you and the same call then runs without asking. End this turn now: say briefly what you are waiting for and do not go on with work that depends on it.",
        };
      }
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
    const seen: Array<{ media_id: string; mime: string }> = [];
    const ctx: Omit<ToolContext, "runCommand"> = {
      agent,
      thread,
      run,
      signal,
      untrusted: () => untrusted,
      approvalFor: (n) => byName.get(n)?.approval,
      approvalTools: () => [...byName.values()].filter((t) => t.approval).map((t) => t.name),
      // What this agent may run without asking, with no outside content in the turn: by its autonomy, or by an
      // owner's grant for good (a grant for this chat only does not pass on).
      usesFreely: (n) => {
        const t = byName.get(n);
        if (!t) return false;
        if (authorize(t, {} as never, agent, false).kind === "allow") return true;
        return !!t.approval && store.approvals.allows(t.approval, undefined, agent.id);
      },
      see: (image) => {
        seen.push(image);
      },
      upsertPart: display.upsert,
      call: (method, params) => o.call(method, params, { run, callId }),
      // Only after the owner's OK on a tool that always asks for it (the confirmation above ran for this call).
      ...(level === "always"
        ? { callAsOwner: (method, params) => o.call(method, params, { run, callId, owner: true }) }
        : {}),
      delegate: o.delegate,
      askOwner: (prompt, options, canContinue) =>
        o.inputs.ask({
          run,
          agent,
          display,
          callId,
          kind: "question",
          prompt,
          options,
          external: o.external(),
          stays: !canContinue,
          signal,
        }),
      withdrawQuestion: (inputId) => o.inputs.withdraw(inputId, agent.id),
    };
    const out = await runTool(tool, args, { ...ctx, runCommand: (c) => runCommand(c, run) });
    const images = out.ok && seen.length ? { images: seen } : {};
    if (out.text.includes(UNTRUSTED_MARK) && !tool.local?.(args)) untrusted = true;
    const full = out.text.slice(0, STORED_OUTPUT_CHARS);
    store.runs.endStep(run.id, callId, out.ok ? "ok" : "error", out.text.slice(0, STEP_SUMMARY_CHARS), full);
    signal.throwIfAborted();
    card(out.ok ? "ok" : "error", out.text.slice(0, CARD_DETAIL_CHARS));
    // The model gets a capped copy; the whole text stays in the step for read_output.
    const shown = cap(out.text);
    return {
      ok: out.ok,
      text: shown === out.text ? shown : `${shown}\n[full output: ${out.text.length} chars; read_output ref=${stepId}]`,
      ...images,
    };
  };

  /**
   * An external agent's own tool, judged by the same rule as ours: reading inside its folder runs, a command is
   * classified like the shell tool's, fetching and anything that changes something ask (unless autonomy allows it).
   */
  /** How much an external agent's own tool kind needs the owner, before the thread's write policy and autonomy. */
  function externalLevel(kind: string, inside: boolean, command: unknown): Confirm {
    if (READING.has(kind)) return inside ? "never" : "ask";
    // Fetching sends something out; in a code thread it could carry the code with it.
    if (kind === "fetch") return worksInFolder(thread) ? "ask" : "untrusted";
    if (kind === "execute" && typeof command === "string") return commandRisk(command, o.apxPort());
    return "ask";
  }

  const approve: TurnIO["approve"] = async (req) => {
    const base = o.workDir;
    const paths = pathsOf(req.input);
    const command = (req.input as { command?: unknown } | undefined)?.command;
    const inside = paths.every((p) => insideReal(base, p));
    const reading = READING.has(req.kind);
    const level = externalLevel(req.kind, inside, command);
    // A code thread's write policy comes first: read-only lets only reading run; auto lets edits inside its folder,
    // never to git's config, APC files or AGENTS.md.
    if (worksInFolder(thread) && level !== "never") {
      if (thread.write === "read-only") return false;
      const editable = paths.length > 0 && inside && !paths.some((p) => guarded(base, p));
      if (thread.write === "auto" && req.kind === "edit" && editable) return true;
    }
    const workspace = inside && (req.kind === "edit" || req.kind === "execute") && !paths.some((p) => guarded(base, p));
    const decision = decide(level, reading ? "none" : "external", agent, untrusted, workspace);
    if (decision.kind === "allow") return true;
    if (decision.kind === "deny") return false;
    const answer = await o.inputs.ask({
      run: o.run(),
      agent,
      display,
      callId: req.callId,
      kind: "confirm",
      prompt: confirmPrompt(store, decision.why, agent.name, req.title),
      tool: req.kind,
      ...(req.detail ? { detail: req.detail } : {}),
      // The external agent's own tool is not ours to run later: past the wait it counts as no.
      external: false,
      stays: false,
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
    get untrusted() {
      return untrusted;
    },
  };
}
