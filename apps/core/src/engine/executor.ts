// The one executor every tool call goes through, whatever harness made it: check the arguments, ask the policy,
// wait for the owner when it says so, record the step, run with a deadline, keep the full output and hand the
// model a capped copy.

import type { MethodName, Params, Result, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { strictApproval } from "../domain/approvals.ts";
import type { InputRecord } from "../domain/inputs.ts";
import type { JobRecord } from "../domain/jobs.ts";
import { ownerAsked, type RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { worksInFolder } from "../domain/threads.ts";
import { errorMessage } from "../errors.ts";
import type { TurnIO } from "../harness/index.ts";
import { MCP_CALL, MCP_SEARCH, unwrapCall } from "../tools/mcp-bridge.ts";
import { authorize, decide, keepsCard } from "../tools/policy.ts";
import { cap, UNTRUSTED_MARK } from "../tools/result.ts";
import { commandRisk, judgeCommand } from "../tools/shell.ts";
import type { CheckContext, Confirm, ScopedThread, Tool, ToolContext } from "../tools/types.ts";
import type { Display } from "./display.ts";
import { fanOut, LOOK_FIRST } from "./fan-out.ts";
import { folderBinding, type Inputs } from "./inputs.ts";
import type { Jobs } from "./jobs.ts";
import { confirmPrompt, fanOutPrompt, folderPrompt } from "./owner-words.ts";
import { guarded, pathsOf } from "./paths.ts";
import type { Permissions } from "./permissions.ts";
import { handedOff } from "./task-handoff.ts";
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

/** What the model reads when the owner has not said yes: still waiting, or declined (or never answered). */
function unanswered(answer: InputRecord): { card: string; text: string } | undefined {
  if (answer.state === "pending")
    return {
      card: "waiting for the owner",
      text: "not run yet: the owner has not answered. The request stays open in the chat; if they approve it, a new turn tells you and the same call then runs without asking. End this turn now: say briefly what you are waiting for and do not go on with work that depends on it.",
    };
  if (answer.state === "approved") return undefined;
  const why = answer.state === "denied" ? "the owner declined" : "the owner did not answer in time";
  return {
    card: why,
    text: `not run: ${why}${answer.answer ? ` (their note: ${answer.answer})` : ""}. Do not retry it; tell the owner or continue without it.`,
  };
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
  /** The thread's runs in the model's projected history, and this one (ToolContext.inView). */
  inView?: ReadonlySet<string>;
  /** The harness running the turn reaches tools over a deadline-bound call (Claude Code, Codex). */
  external: () => boolean;
  call<M extends MethodName>(
    method: M,
    params: Params<M>,
    as: { run: RunRecord; callId: string; owner?: boolean },
  ): Promise<Result<M>>;
  delegate: ToolContext["delegate"];
  jobs: Jobs;
  /** Work in progress the turn waits on: its idle deadline is held until the returned function is called. */
  busy?: (() => () => void) | undefined;
  /** APX's own port: a command that reaches it always asks. */
  apxPort: () => number;
  /** Where an outside agent works (harnessDir): its tools are checked against this folder. */
  workDir: string;
  /** How the agent acts and how far its files reach: asked for each call, never worked out here. */
  permissions: Permissions;
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
  /** The owner let this turn hand work to many agents (engine/fan-out.ts): it is not asked again. */
  let wideOk = false;

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
    // A long command (a render, a build) is the turn at work, bounded by its own timeout (DECISIONS.md#d-105).
    const idle = o.busy?.();
    signal.addEventListener("abort", stop, { once: true });
    try {
      const ended = await done;
      return { job: ended, output: o.jobs.read(job.id, undefined, FOREGROUND_OUTPUT_CHARS).output };
    } finally {
      clearTimeout(timer);
      idle?.();
      signal.removeEventListener("abort", stop);
    }
  };

  /**
   * The thread a call runs with, by how far its agent reaches (DECISIONS.md#d-106): every folder, every folder to read,
   * or its own; and the folders outside those the call needs lent to it for this call once the owner lets it (a card:
   * once, or for good as the project's read-only folders when it only reads).
   */
  const lend = async (
    tool: Tool,
    name: string,
    args: Record<string, unknown>,
    raw: Record<string, unknown>,
    callId: string,
    run: RunRecord,
  ): Promise<{ thread: ScopedThread; asked?: true } | { card: string; text: string }> => {
    // Asked per call: a folder granted for good mid-turn counts from the next call.
    const base = o.permissions.scope(agent, thread);
    if (base.reach === "all" || base.reach === "fenced") return { thread: base };
    // Reading anywhere, what a call may still need lent is a folder to change; asking to read, first one to read.
    const toRead = base.reach === "card" ? (tool.outside?.(args, { agent, thread: base }) ?? []) : [];
    const write = !toRead.length;
    const folders = toRead.length
      ? toRead
      : (tool.outside?.(args, { agent, thread: { ...base, lentWrite: true } }) ?? []);
    if (!folders.length) return { thread: base };
    const lent: ScopedThread = { ...base, lent: folders, ...(write ? { lentWrite: true } : {}) };
    if (o.inputs.takeGrant(thread.id, agent.id, name, raw, folderBinding(folders, write))) return { thread: lent };
    const answer = await o.inputs.ask({
      run,
      agent,
      display,
      callId,
      kind: "confirm",
      prompt: folderPrompt(store, agent.name, folders, write),
      tool: name,
      args: raw,
      detail: describe(args),
      folders,
      write,
      external: o.external(),
      stays: true,
      signal,
    });
    signal.throwIfAborted();
    return unanswered(answer) ?? { thread: lent, asked: true };
  };

  const execute: TurnIO["execute"] = async (callId, called, given) => {
    const run = o.run();
    const transfer = handedOff(store, run);
    if (transfer) return { ok: false, text: transfer, endTurn: true };
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
    const decision = authorize(tool, args, agent, untrusted);
    if (decision.kind === "deny") {
      card("error", "turned off");
      return {
        ok: false,
        text: `not run: ${decision.reason}. Do not retry it; tell the owner or continue without it.`,
      };
    }
    // What the owner set up changes at their own word: not at another agent's, a contact's or a job's (DECISIONS.md#d-140).
    const askedIn = (id: string) => store.runs.get(store.inputs.get(id)?.run_id ?? "")?.input?.origin;
    if (tool.ownerSetting?.(args) && !ownerAsked(run.input?.origin, askedIn)) {
      card("error", "only when the owner asks");
      return {
        ok: false,
        text: "not run, nothing was asked of the owner: changes to what the owner set up happen only when they ask you themselves. Tell whoever asked that the owner has to ask for it.",
      };
    }
    // A path outside the agent's folders asks the owner to let it, instead of being refused (DECISIONS.md#d-099).
    const lent = await lend(tool, name, args, raw, callId, run);
    if ("card" in lent) {
      card("error", lent.card);
      return { ok: false, text: lent.text };
    }
    const callThread = lent.thread;
    // Before anyone is asked: a call that could only fail ends here, and the model learns which argument is wrong.
    const problem = await precheck(tool, args, { agent, thread: callThread });
    if (problem !== undefined) {
      card("error", problem.slice(0, CARD_DETAIL_CHARS));
      return { ok: false, text: `not run, nothing was asked of the owner: ${problem}` };
    }

    // A read-only code thread refuses anything that would need an OK, and any change to files, before anyone is asked;
    // its temp files are not the code.
    const level = tool.confirm(args);
    const changesFiles = Boolean(tool.workspace) && !tool.reads?.(args) && !tool.scratch?.(args);
    if (
      worksInFolder(thread) &&
      thread.write === "read-only" &&
      (level === "ask" || level === "always" || changesFiles)
    ) {
      card("error", "read-only thread");
      const why =
        tool.name === "shell"
          ? 'this command is not a plain read (see "Your folder" in your instructions for what runs)'
          : "only actions that read may run here";
      return { ok: false, text: `refused: this code thread is read-only; ${why}` };
    }
    // A delegated session capped at ask (its caller could do no more) asks before changing files on our own loop too,
    // as an outside engine does under it. The owner's own chats follow the agent's mode (DECISIONS.md#d-106).
    const gate: typeof decision =
      decision.kind === "allow" &&
      thread.kind === "a2a" &&
      worksInFolder(thread) &&
      thread.write === "ask" &&
      (level === "ask" || level === "always" || changesFiles)
        ? { kind: "confirm", why: "asks_every", reason: "this session asks before changing files" }
        : decision;
    const wide = wideOk ? undefined : fanOut(store, run, agent, name, args);
    // Tasks handed out wide become proposals the owner picks from, instead of a card that stops the turn.
    const proposes = wide && name === "task_create";
    if (proposes) (args as { propose?: boolean }).propose = true;
    if (wide && !proposes && !o.inputs.takeGrant(thread.id, agent.id, name, raw)) {
      const answer = await o.inputs.ask({
        run,
        agent,
        display,
        callId,
        kind: "confirm",
        prompt: fanOutPrompt(
          store,
          agent.name,
          wide.map((id) => store.agents.get(id)?.name ?? id),
        ),
        tool: name,
        args: raw,
        detail: describe(args),
        external: o.external(),
        stays: true,
        signal,
      });
      signal.throwIfAborted();
      if (answer.state === "denied") {
        card("error", "the owner wants a plan first");
        return { ok: false, text: `${LOOK_FIRST}${answer.answer ? ` Their note: ${answer.answer}` : ""}` };
      }
      const no = unanswered(answer);
      if (no) {
        card("error", no.card);
        return { ok: false, text: no.text };
      }
    }
    if (wide && !proposes) wideOk = true;
    const keeps = keepsCard(tool, args, agent);
    // A call that always asks has its own grant, apart from the tool's ordinary one (DECISIONS.md#d-089); one that
    // keeps its card whatever is granted offers none (DECISIONS.md#d-143).
    const target =
      keeps === "card"
        ? undefined
        : level === "always" && tool.approval
          ? strictApproval(tool.approval)
          : tool.approval;
    if (
      gate.kind === "confirm" &&
      // The owner just said yes to this very call on its folder card: manual's ask for every change is answered.
      !(lent.asked && gate.why === "asks_every" && !keeps) &&
      !(target && store.approvals.allows(target, thread.id, agent.id, args)) &&
      !o.inputs.takeGrant(thread.id, agent.id, name, raw, target?.key)
    ) {
      const answer = await o.inputs.ask({
        run,
        agent,
        display,
        callId,
        kind: "confirm",
        prompt: confirmPrompt(store, gate.why, agent.name, name),
        tool: name,
        approval: target,
        args: raw,
        detail: tool.explain?.(args) ?? describe(args),
        // A preview that fails only costs the patch: the owner still sees the arguments.
        change: await tool.preview?.(args, { agent, thread: callThread }).catch(() => undefined),
        external: o.external(),
        stays: true,
        appOnly: tool.ownerSetting?.(args),
        signal,
      });
      signal.throwIfAborted();
      const no = unanswered(answer);
      if (no) {
        card("error", no.card);
        return { ok: false, text: no.text };
      }
    }

    const transferred = handedOff(store, run);
    if (transferred) {
      card("error", "execution transferred");
      return { ok: false, text: transferred, endTurn: true };
    }
    toolsRan++;
    const stepId = store.runs.beginStep(run.id, { call_id: callId, tool: name, args, effect: tool.effect });
    store.runs.setActivity(run.id, title, true);
    const seen: Array<{ media_id: string; mime: string }> = [];
    const ctx: Omit<ToolContext, "runCommand"> = {
      agent,
      thread: callThread,
      run,
      signal,
      untrusted: () => untrusted,
      ...(o.inView ? { inView: () => o.inView as ReadonlySet<string> } : {}),
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
      // A tool that always asks acts as the owner once this call passed its card (answered or granted above), or
      // where the mode or rule let it run unasked and it keeps no card (DECISIONS.md#d-143).
      ...(level === "always" && (gate.kind === "confirm" || !keeps)
        ? { callAsOwner: (method, params) => o.call(method, params, { run, callId, owner: true }) }
        : {}),
      delegate: o.delegate,
      askOwner: (prompt, options, canContinue, multi) =>
        o.inputs.ask({
          run,
          agent,
          display,
          callId,
          kind: "question",
          prompt,
          options,
          multi,
          external: o.external(),
          stays: !canContinue,
          signal,
        }),
      // No tool on the card: the owner accepts the action itself, and the calls it takes still pass their own checks.
      proposeAction: (action, canContinue) =>
        o.inputs.ask({
          run,
          agent,
          display,
          callId,
          kind: "confirm",
          prompt: action,
          external: o.external(),
          stays: !canContinue,
          signal,
        }),
      withdrawQuestion: (inputId) => o.inputs.withdraw(inputId, agent.id),
      async requestGrant(prompt, approval) {
        if (store.approvals.allows(approval, thread.id, agent.id)) return undefined;
        const answer = await o.inputs.ask({
          run,
          agent,
          display,
          callId,
          kind: "confirm",
          prompt,
          tool: name,
          approval,
          args: raw,
          detail: describe(args),
          external: o.external(),
          stays: true,
          signal,
        });
        signal.throwIfAborted();
        const no = unanswered(answer);
        if (!no) return undefined;
        card("error", no.card);
        return no.text;
      },
    };
    // What the call was let use reaches the methods it calls (media.attach), never re-derived narrower there.
    const release = o.permissions.hold(run.id, callId, callThread);
    const out = await runTool(tool, args, { ...ctx, runCommand: (c) => runCommand(c, run) }).finally(release);
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
      ...(handedOff(store, run) ? { endTurn: true } : {}),
    };
  };

  /** How much an external agent's own tool kind needs the owner, before the thread's write policy and autonomy. */
  function externalLevel(kind: string, inside: boolean, command: unknown): Confirm {
    if (READING.has(kind)) return inside ? "never" : "ask";
    // Fetching sends something out; in a code thread it could carry the code with it.
    if (kind === "fetch") return worksInFolder(thread) ? "ask" : "untrusted";
    if (kind === "execute" && typeof command === "string") return commandRisk(command, o.apxPort());
    return "ask";
  }

  /**
   * An external agent's own tool, judged by the same folder rule and reach as ours: what it reads must be readable and
   * what it changes changeable; outside those the owner is asked, and only a read-only folder or APX's own is refused.
   */
  const approve: TurnIO["approve"] = async (req) => {
    const allow = () => {
      const run = o.run();
      if (handedOff(store, run)) return false;
      store.threads.mergeContext(thread.id, { external_grant_run: run.id });
      return true;
    };
    if (handedOff(store, o.run())) return false;
    const base = o.workDir;
    const scope = o.permissions.scope(agent, thread);
    const paths = pathsOf(req.input);
    const command = (req.input as { command?: unknown } | undefined)?.command;
    const reading = READING.has(req.kind);
    const judged = paths.map((p) => o.permissions.harnessPath(scope, p, !reading));
    // A command is held to the shell tool's folder rule: what it reads readable, what it writes writable.
    const ran = req.kind === "execute" && typeof command === "string";
    const refusedCommand = ran ? judgeCommand(o.permissions.harnessRoots(scope), command, base) : undefined;
    if (refusedCommand) judged.push(refusedCommand);
    // No answer of the owner's opens a read-only folder or APX's own.
    if (judged.some((r) => "refused" in r && !r.offer)) return false;
    const inside = judged.every((r) => !("refused" in r));
    const own = externalLevel(req.kind, inside, command);
    // Outside the folders it may use, the owner says yes unless its mode lets it on its own.
    const level = inside || own === "always" ? own : "ask";
    // A read-only code thread lets only reading run. Otherwise the agent's mode decides, as for our own tools: an edit
    // where it may write is a local change like file_edit, never to git's config, APC files or AGENTS.md.
    if (worksInFolder(thread) && thread.write === "read-only" && level !== "never") return false;
    const workspace = inside && (req.kind === "edit" || req.kind === "execute") && !paths.some((p) => guarded(base, p));
    // A command that only reads here is risk read, as the shell tool's (DECISIONS.md#d-098).
    const reads = reading || (req.kind === "execute" && level === "never");
    const effect = reads ? "none" : req.kind === "edit" && workspace ? "local" : "external";
    const decision = decide(level, effect, agent, untrusted, workspace);
    if (decision.kind === "allow") return allow();
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
    return answer.state === "approved" && allow();
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
