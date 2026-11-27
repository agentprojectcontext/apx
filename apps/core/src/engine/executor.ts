// The one executor every tool call goes through, whatever harness made it: check the arguments, ask the policy,
// wait for the owner when it says so, record the step, run with a deadline, keep the full output and hand the
// model a capped copy.
import path from "node:path";

import type { AutoDeletionNote, MethodName, Params, Result, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type ApprovalTarget, DELETE_GRANT, deleteApproval, strictApproval } from "../domain/approvals.ts";
import { type Asked, HELD_ANSWER } from "../domain/inputs.ts";
import type { JobRecord } from "../domain/jobs.ts";
import { ownerAsked, type RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { worksInFolder } from "../domain/threads.ts";
import { errorMessage } from "../errors.ts";
import type { TurnIO } from "../harness/index.ts";
import { deletionTargets } from "../tools/command-deletions.ts";
import { foundLater, TOOL_RUN, TOOL_SEARCH, unwrapCall } from "../tools/mcp-bridge.ts";
import { authorize, type Decision, decide, keepsCard, modeOf, sessionGate } from "../tools/policy.ts";
import { cap, UNTRUSTED_MARK } from "../tools/result.ts";
import { commandRisk, deletionRoot, onlyDeletes } from "../tools/shell.ts";
import type { CheckContext, Confirm, ScopedThread, Tool, ToolContext } from "../tools/types.ts";
import { prepareBrowserConsent } from "./browser-consent.ts";
import { type AuxJudge, deletionRuns } from "./deletion-judge.ts";
import type { Display } from "./display.ts";
import { folderBinding, type Inputs } from "./inputs.ts";
import type { Jobs } from "./jobs.ts";
import { confirmPrompt, deletePrompt, deletionCard, folderPrompt, ownerCardPrompt } from "./owner-words.ts";
import { guarded, inGitFolder, namesAgentFiles, pathsOf } from "./paths.ts";
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

/** Longest the check of where a call acts may take: past it the owner's card is shown as before. */
const HERE_CHECK_MS = 5000;

/**
 * In Auto, a call that acts only on a page this computer serves runs unasked: no more than a command the agent may
 * already run there. The node checks the page again as it acts (DECISIONS.md#d-212).
 */
async function onThisComputer(
  tool: Tool,
  args: Record<string, unknown>,
  agent: AgentRecord,
  untrusted: boolean,
  asked: Decision,
  signal: AbortSignal,
  call: ToolContext["call"],
): Promise<Decision | undefined> {
  if (asked.kind !== "confirm" || modeOf(agent) !== "auto" || tool.confirm(args) !== "untrusted") return undefined;
  const stop = AbortSignal.any([signal, AbortSignal.timeout(HERE_CHECK_MS)]);
  if (!tool.onThisComputer || stop.aborted) return undefined;
  const local = await Promise.race([
    tool.onThisComputer(args, { agent, call }).catch(() => false),
    new Promise<false>((resolve) => stop.addEventListener("abort", () => resolve(false), { once: true })),
  ]);
  const here = local ? authorize(tool, args, agent, untrusted, "never") : undefined;
  return here?.kind === "allow" ? here : undefined;
}

/** How much of a call the confirmation card shows: the owner must see everything they approve. */
const CONFIRM_DETAIL_CHARS = 20_000;
/** A foreground command's output handed back to the model (the rest stays in the job's file). */
const FOREGROUND_OUTPUT_CHARS = 60_000;
/** A step's full output kept for read_output, its short summary, and the line shown on its card. */
const STORED_OUTPUT_CHARS = 2_000_000;
const STEP_SUMMARY_CHARS = 4000;
const CARD_DETAIL_CHARS = 300;

/** What the agent said just before a call: its reason, as the owner reads it on a deletion card (D-266). */
function lastWords(display: Display): string | undefined {
  const text = display.message.parts.findLast((p) => p.type === "text");
  return text?.type === "text" ? text.text.slice(-400) : undefined;
}

/** The call's arguments for the confirmation card, whole. */
function describe(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")
    .slice(0, CONFIRM_DETAIL_CHARS);
}

/** What the model reads when the owner has not said yes: still waiting, or declined (or never answered). */
/** A tool call the owner's "send now" stopped part way: the model reads their words next. */
const CUT_SHORT =
  "stopped part way: the owner sent you a message to read now. It may have done part of its work; check before repeating it.";

export function unanswered(answer: Asked): { card: string; text: string } | undefined {
  if (answer.held) return { card: "waiting for the task", text: HELD_ANSWER };
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
  refusal: NonNullable<TurnIO["refusal"]>;
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
  /** Clock for tool durations, independent of persisted wall-clock timestamps. */
  now?: () => number;
  inputs: Inputs;
  tools: Tool[];
  /** Tools that join on first use (MCP's): tool_run names one, and grant_tool may grant one. */
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
  workflow?: ToolContext["workflow"];
  jobs: Jobs;
  /** Work in progress the turn waits on: its idle deadline is held until the returned function is called. */
  busy?: (() => () => void) | undefined;
  /** APX's own port: a command that reaches it always asks. */
  apxPort: () => number;
  /** Where an outside agent works (harnessDir): its tools are checked against this folder. */
  workDir: string;
  /** The chat's temp folder: a deletion there is the agent's own scratch work. */
  scratchDir?: string | undefined;
  /** The auxiliary model's one-shot answer: whether a deletion in Auto runs without a card (DECISIONS.md#d-281). */
  judge?: AuxJudge | undefined;
  /** How the agent acts and how far its files reach: asked for each call, never worked out here. */
  permissions: Permissions;
}): Executor {
  const { store, display, signal, agent, thread } = o;
  const now = o.now ?? (() => performance.now());
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const offered = new Set(byName.keys());
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

  const execute: TurnIO["execute"] = async (callId, called, given, step) => {
    const run = o.run();
    const transfer = handedOff(store, run);
    if (transfer) return { ok: false, text: transfer, endTurn: true };
    // tool_run runs the tool it names, through every check below as if the model had called that tool itself.
    const { name, args: raw } = called === TOOL_RUN ? unwrapCall(given) : { name: called, args: given };
    // A tool found through the bridge (an MCP server's, a connected app's) joins on first use, named either way.
    if (called === TOOL_RUN || name === "grant_tool" || !byName.has(name)) await join();
    // Not offered directly: joined from `late`, which holds only what the turn's policy allows (an agent's focus).
    const bridged =
      called !== TOOL_RUN ||
      ((name.startsWith("mcp_") || foundLater(name) || !offered.has(name)) &&
        name !== TOOL_RUN &&
        name !== TOOL_SEARCH);
    const tool = bridged ? byName.get(name) : undefined;
    const title = tool ? toolTitle(store, tool, raw) : name;
    const began = now();
    // What Auto decided about the deletion, shown on the step from then on (DECISIONS.md#d-281).
    let auto: AutoDeletionNote | undefined;
    const card = (status: "running" | "ok" | "error", detail?: string) =>
      display.upsert((p) => p.type === "tool" && p.call_id === callId, {
        type: "tool",
        call_id: callId,
        tool: name,
        title,
        status,
        ...(detail ? { detail } : {}),
        ...(status === "running" ? {} : { ms: Math.max(0, Math.round(now() - began)) }),
        ...(auto ? { auto_deletion: auto } : {}),
      });
    card("running");
    signal.throwIfAborted();
    if (!tool) {
      card("error", "unknown tool");
      return {
        ok: false,
        text: `unknown tool ${name}${called === TOOL_RUN ? `; ${TOOL_RUN} runs a tool ${TOOL_SEARCH} found` : ""}`,
      };
    }
    const parsed = tool.parse(raw);
    if (!parsed.ok) {
      card("error", "invalid arguments");
      // A found tool was called without its schema in view: the next try has it.
      const schema = offered.has(name) ? "" : `\nargs: ${JSON.stringify(tool.parameters)}`;
      return { ok: false, text: `${parsed.error}${schema}` };
    }
    const args = parsed.args;
    const asked = authorize(
      tool,
      args,
      agent,
      untrusted,
      tool.confirm(args, { agent, thread: o.permissions.scope(agent, thread) }),
    );
    const here = await onThisComputer(tool, args, agent, untrusted, asked, signal, (method, params) =>
      o.call(method, params, { run, callId }),
    );
    const decision = here ?? asked;
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
    const level = tool.confirm(args, { agent, thread: callThread });
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
    // The owner's own chats follow the agent's mode (DECISIONS.md#d-106); a delegated session may ask before changes.
    const gate = sessionGate(thread, decision, level === "ask" || level === "always" || changesFiles);
    const keeps = keepsCard(tool, args, agent);
    // A call that always asks has its own grant, apart from the tool's ordinary one (DECISIONS.md#d-089); one that
    // keeps its card whatever is granted offers none (DECISIONS.md#d-143).
    let target: ApprovalTarget | undefined;
    try {
      target = tool.approvalForCall
        ? await tool.approvalForCall(args, {
            agent,
            thread: callThread,
            run,
            call: (method, params) => o.call(method, params, { run, callId }),
          })
        : keeps === "card"
          ? undefined
          : level === "always" && tool.approval
            ? strictApproval(tool.approval)
            : tool.approval;
    } catch (error) {
      return { ok: false, text: `not run: ${failure(error)}` };
    }
    const approvalVersion = target && store.approvals.browserVersion(target, thread.id, agent.id);
    // A server's tools opened by default stay behind the card while outside content is in the turn (DECISIONS.md#d-279).
    const outside = gate.kind === "confirm" && untrusted;
    const granted = !!target && store.approvals.allows(target, thread.id, agent.id, args, outside);
    let checkConsentAtDispatch = !!target?.browser && granted;
    let pendingBrowserScope: "tab" | "turn" | undefined;
    // A deletion shows what goes and why, in the agent's words just before the call (DECISIONS.md#d-266); in Auto what
    // is plainly the agent's own, or what the judge finds the work asked for, runs without it (DECISIONS.md#d-281).
    const deleted =
      gate.kind === "confirm" && target?.key === DELETE_GRANT
        ? tool.deletes?.(args, { agent, thread: callThread })
        : undefined;
    const decided =
      deleted?.place && !granted && modeOf(agent) === "auto"
        ? await deletionRuns({
            store,
            run,
            agentId: agent.id,
            thread,
            deletion: deleted,
            place: deleted.place,
            reason: lastWords(display),
            judge: o.judge,
            untrusted,
            callId,
            command: String(args.command ?? ""),
          })
        : undefined;
    if (decided) {
      auto = decided.note;
      card("running");
    }
    const judged = !!decided?.runs;
    if (
      !judged &&
      gate.kind === "confirm" &&
      // The owner just said yes to this very call on its folder card: manual's ask for every change is answered.
      !(lent.asked && gate.why === "asks_every" && !keeps) &&
      !granted &&
      (target?.browser || !o.inputs.takeGrant(thread.id, agent.id, name, raw, target?.key))
    ) {
      const gone = deleted && deletionCard(store, deleted, lastWords(display), String(args.command ?? ""));
      const answer = await o.inputs.ask({
        run,
        agent,
        display,
        callId,
        kind: "confirm",
        prompt: gone
          ? deletePrompt(store, agent.name)
          : tool.ownerSetting?.(args) && tool.explain
            ? ownerCardPrompt(store, agent.name)
            : confirmPrompt(store, gate.why, agent.name, name),
        tool: name,
        approval: target,
        args: raw,
        detail: gone ? gone.detail : (tool.explain?.(args) ?? describe(args)),
        // Its reason is its own message just above the card: the card does not say it twice (channels still do).
        ...(gone ? { deletion: { items: gone.deletion.items, command: gone.deletion.command } } : {}),
        // A preview that fails only costs the patch: the owner still sees the arguments.
        change: await tool.preview?.(args, { agent, thread: callThread }).catch(() => undefined),
        external: o.external(),
        stays: !target?.browser,
        appOnly: tool.ownerSetting?.(args) || tool.appOnly,
        signal,
      });
      signal.throwIfAborted();
      const no = unanswered(answer);
      if (no) {
        card("error", no.card);
        return { ok: false, text: no.text };
      }
      if (target?.browser) {
        try {
          const prepared = await prepareBrowserConsent({
            store,
            target,
            scope: answer.approval_scope,
            version: approvalVersion,
            thread: thread.id,
            agent: agent.id,
            signal,
            current: async () =>
              tool.approvalForCall?.(args, {
                agent,
                thread: callThread,
                run,
                call: (method, params) => o.call(method, params, { run, callId }),
              }),
          });
          if (prepared && (answer.approval_scope === "tab" || answer.approval_scope === "turn"))
            pendingBrowserScope = answer.approval_scope;
        } catch (error) {
          const detail = failure(error);
          card("error", detail);
          return { ok: false, text: `not run: ${detail}` };
        }
      }
    }

    const transferred = handedOff(store, run);
    if (transferred) {
      card("error", "execution transferred");
      return { ok: false, text: transferred, endTurn: true };
    }
    toolsRan++;
    // A command that only reads is recorded as a read, as the policy judged it: looking around is not progress.
    const effect = tool.reads?.(args) ? "none" : tool.effect;
    const stepId = store.runs.beginStep(run.id, { call_id: callId, tool: name, args, effect });
    store.runs.setActivity(run.id, title, true);
    const seen: Array<{ media_id: string; mime: string }> = [];
    const ctx: Omit<ToolContext, "runCommand"> = {
      agent,
      thread: callThread,
      run,
      // Only the tool's own work stops for the owner's words; their cards above still answer to the turn.
      signal: step ? AbortSignal.any([signal, step]) : signal,
      untrusted: () => untrusted,
      ...(here ? { onThisComputer: true as const } : {}),
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
      callId,
      upsertPart: display.upsert,
      call: (method, params) => o.call(method, params, { run, callId }),
      // A tool that always asks, or changes what the owner set up, acts as the owner once this call passed its card
      // (answered or granted above), or where the mode or rule let it run unasked and it keeps no card
      // (DECISIONS.md#d-143, DECISIONS.md#d-203).
      ...((level === "always" || tool.ownerSetting?.(args)) && (gate.kind === "confirm" || !keeps)
        ? {
            callAsOwner: async (method, params) => {
              if (target?.browser && store.approvals.browserVersion(target, thread.id, agent.id) !== approvalVersion)
                throw new Error("Browser approval was revoked or declined; request approval again");
              if (checkConsentAtDispatch && target && !store.approvals.allows(target, thread.id, agent.id, args))
                throw new Error("Browser consent was revoked or expired; request approval again");
              const result = await o.call(method, params, { run, callId, owner: true });
              if (pendingBrowserScope && target?.browser && method === "browser.evaluate") {
                const state = store.runs.get(run.id)?.state;
                // The first successful dispatch proves its context; revocation only prevents future consent.
                if (
                  !signal.aborted &&
                  (state === "working" || state === "input-required") &&
                  store.approvals.browserVersion(target, thread.id, agent.id) === approvalVersion
                )
                  store.approvals.grant(target, pendingBrowserScope, thread.id, agent.id, approvalVersion);
                pendingBrowserScope = undefined;
                checkConsentAtDispatch = true;
              }
              return result;
            },
          }
        : {}),
      delegate: o.delegate,
      ...(o.workflow ? { workflow: o.workflow } : {}),
      askOwner: (prompt, options, canContinue, multi, appOnly) =>
        o.inputs.ask({
          run,
          agent,
          display,
          callId,
          kind: "question",
          prompt,
          options,
          multi,
          ...(appOnly ? { appOnly: true as const } : {}),
          external: o.external(),
          stays: !canContinue,
          signal,
        }),
      askSignIn: (prompt, login, options) =>
        o.inputs.ask({
          run,
          agent,
          display,
          callId,
          kind: "question",
          prompt,
          tool: "browser_sign_in",
          args: login ? { login } : {},
          options,
          appOnly: true,
          external: o.external(),
          stays: false,
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
    // The model gets a capped copy; only a cut text is kept whole for read_output, as the model log holds the rest.
    const shown = cap(out.text);
    const full = shown === out.text ? undefined : out.text.slice(0, STORED_OUTPUT_CHARS);
    store.runs.endStep(run.id, callId, out.ok ? "ok" : "error", out.text.slice(0, STEP_SUMMARY_CHARS), full);
    signal.throwIfAborted();
    if (step?.aborted) {
      card("error", "stopped for your message");
      return { ok: false, text: tool.cut ? `${CUT_SHORT} ${tool.cut}` : CUT_SHORT };
    }
    card(out.ok ? "ok" : "error", out.text.slice(0, CARD_DETAIL_CHARS));
    return {
      ok: out.ok,
      text: shown === out.text ? shown : `${shown}\n[full output: ${out.text.length} chars; read_output ref=${stepId}]`,
      ...images,
      ...(handedOff(store, run) ? { endTurn: true } : {}),
    };
  };

  /** How much an external agent's own tool kind needs the owner, before the thread's write policy and autonomy. */
  function externalLevel(kind: string, inside: boolean, command: unknown, paths: string[]): Confirm {
    if (READING.has(kind)) return inside ? "never" : "ask";
    // Fetching sends something out; in a code thread it could carry the code with it.
    if (kind === "fetch") return worksInFolder(thread) ? "ask" : "untrusted";
    if (kind === "execute" && typeof command === "string") return commandRisk(command, o.apxPort(), () => o.workDir);
    // Agent files and AGENTS.md define agents and their modes: changing them is high impact, as file_write's.
    if (paths.some((p) => namesAgentFiles(p) || guarded(o.workDir, p))) return "always";
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
    const refusedCommand = ran ? o.permissions.harnessCommand(scope, command, base) : undefined;
    if (refusedCommand) judged.push(refusedCommand);
    // No answer of the owner's opens a read-only folder or APX's own, nor lets a file tool change git's folder.
    if (judged.some((r) => "refused" in r && !r.offer)) return false;
    if (!reading && paths.some((p) => inGitFolder(path.resolve(base, p)))) return false;
    const inside = judged.every((r) => !("refused" in r));
    const own = externalLevel(req.kind, inside, command, paths);
    // Outside the folders it may use, the owner says yes unless its mode lets it on its own.
    const level = inside || own === "always" ? own : "ask";
    // A read-only code thread lets only reading run. Otherwise the agent's mode decides, as for our own tools: an edit
    // where it may write is a local change like file_edit, never to git's config, agent files or AGENTS.md.
    if (worksInFolder(thread) && thread.write === "read-only" && level !== "never") return false;
    const workspace = inside && (req.kind === "edit" || req.kind === "execute") && !paths.some((p) => guarded(base, p));
    // A command that only reads here is risk read, as the shell tool's (DECISIONS.md#d-098).
    const reads = reading || (req.kind === "execute" && level === "never");
    const effect = reads ? "none" : req.kind === "edit" && workspace ? "local" : "external";
    const changes = !reads && (level === "ask" || level === "always" || req.kind === "edit" || req.kind === "execute");
    const decision = sessionGate(thread, decide(level, effect, agent, untrusted, workspace), changes);
    if (decision.kind === "allow") return allow();
    if (decision.kind === "deny") return false;
    // A deletion is the owner's to ask for: its card says what goes and why, and their OK for this chat covers the next
    // one in the folders it may change (a deletion elsewhere asks each time).
    const deletion = decision.why === "always" && ran && onlyDeletes(command, o.apxPort(), () => base);
    const grantable = deletion && inside;
    if (grantable && store.approvals.allows(deleteApproval, thread.id, agent.id)) return allow();
    const gone = deletion ? { ...deletionTargets(command, base), root: deletionRoot(store, thread, base) } : undefined;
    // In Auto, what is plainly the agent's own, or what the judge finds the work asked for, runs (DECISIONS.md#d-281).
    const decided =
      gone && modeOf(agent) === "auto"
        ? await deletionRuns({
            store,
            run: o.run(),
            agentId: agent.id,
            thread,
            deletion: gone,
            place: { roots: [...new Set([gone.root, base])], scratch: o.scratchDir ?? base },
            reason:
              typeof req.input === "object" && req.input && "description" in req.input
                ? String(req.input.description)
                : undefined,
            judge: o.judge,
            untrusted,
            callId: req.callId,
            command: String(command ?? ""),
          })
        : undefined;
    if (decided) noteDeletion(req.callId, decided.note);
    if (decided?.runs) return allow();
    // A change outside its folders is the same folder card as ours: once, or always for this agent (DECISIONS.md#d-108).
    const offered = [...new Set(judged.flatMap((r) => ("refused" in r && r.offer ? [r.offer] : [])))];
    // A command that only reads keeps the plain card, and so does one asking to read first (its offer may be a read).
    const changing = !reading && !deletion && own !== "always" && own !== "never" && (!ran || scope.reach === "read");
    const folders = changing && offered.length ? offered : undefined;
    const reason = (req.input as { description?: unknown } | undefined)?.description;
    const answer = await o.inputs.ask({
      run: o.run(),
      agent,
      display,
      callId: req.callId,
      kind: "confirm",
      prompt: deletion
        ? deletePrompt(store, agent.name)
        : folders
          ? folderPrompt(store, agent.name, folders, true)
          : confirmPrompt(store, decision.why, agent.name, req.title),
      tool: req.kind,
      ...(grantable ? { approval: deleteApproval } : {}),
      ...(folders ? { folders, write: true } : {}),
      ...(deletion
        ? deletionCard(
            store,
            gone ?? { ...deletionTargets(command, base), root: deletionRoot(store, thread, base) },
            typeof reason === "string" ? reason : undefined,
            command,
          )
        : req.detail
          ? { detail: req.detail }
          : {}),
      // The external agent's own tool is not ours to run later: past the wait it counts as no.
      external: false,
      stays: false,
      signal,
    });
    const no = unanswered(answer);
    // Past its wait the card counts as no: the agent reads why and goes on another way, the run never hangs on it.
    if (no)
      refused.set(
        req.callId,
        `Not approved: ${no.card}${answer.answer ? ` (their note: ${answer.answer})` : ""}. Do not retry it; continue another way that needs no approval, or end your answer saying what is left for the owner.`,
      );
    return answer.state === "approved" && allow();
  };
  /** Why the owner's answer was no, per external call (see approve). */
  const refused = new Map<string, string>();
  /** What Auto decided about an external call's deletion, for its step (DECISIONS.md#d-281). */
  const autoNotes = new Map<string, AutoDeletionNote>();
  const noteDeletion = (callId: string, note: AutoDeletionNote) => {
    autoNotes.set(callId, note);
    const shown = display.find((p) => p.type === "tool" && p.call_id === callId);
    if (shown?.type === "tool")
      display.upsert((p) => p.type === "tool" && p.call_id === callId, { ...shown, auto_deletion: note });
  };

  /** When each of an external agent's tool calls began. */
  const seen = new Map<string, number>();
  const observe: TurnIO["observe"] = (ev) => {
    const run = o.run();
    // What an external agent fetched from the web is now in its context.
    if (ev.kind === "fetch") untrusted = true;
    if (!seen.has(ev.callId)) {
      seen.set(ev.callId, now());
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
      ...(ev.status === "running" ? {} : { ms: Math.max(0, Math.round(now() - (seen.get(ev.callId) ?? now()))) }),
      ...(autoNotes.has(ev.callId) ? { auto_deletion: autoNotes.get(ev.callId) } : {}),
    });
  };

  return {
    execute,
    approve,
    refusal: (callId) => refused.get(callId),
    observe,
    get toolsRan() {
      return toolsRan;
    },
    get untrusted() {
      return untrusted;
    },
  };
}
