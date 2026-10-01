// One run, start to end: context in, harness loop, every tool call through one executor, an honest end state.
import path from "node:path";
import type { HarnessId, MethodName, Params, Result, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { engineOf, harnessOf } from "../domain/refs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { Canceled, errorMessage } from "../errors.ts";
import type { Harnesses, TurnIO, TurnOutcome } from "../harness/index.ts";
import type { Log } from "../log.ts";
import { candidates, modelSettings } from "../models/choice.ts";
import type { ChatItem } from "../providers/types.ts";
import { agentSkills, skillCatalog, skillsFor } from "../skills/skills.ts";
import { inherit } from "../tools/policy.ts";
import { UNTRUSTED_MARK } from "../tools/result.ts";
import { type Tool, toSpec } from "../tools/types.ts";
import { callersOf } from "./ancestry.ts";
import { type Audience, audienceOf, contactPrompt, SEALED_HARNESSES } from "./audience.ts";
import { gitChanges } from "./changes.ts";
import { HISTORY_BUDGET_CHARS, project, rosterBlock, systemPrompt, turnInput } from "./context.ts";
import type { Caller, DelegateTo } from "./delegation.ts";
import { type Display, openDisplay } from "./display.ts";
import { createExecutor, type Executor } from "./executor.ts";
import type { Inputs } from "./inputs.ts";
import type { Jobs } from "./jobs.ts";
import { MAX_DEPTH } from "./limits.ts";
import { recallFor } from "./recall.ts";
import { recapFor, sessionKey } from "./recap.ts";
import { closeTurnLog } from "./recovery.ts";

const HARNESS_LABEL: Record<HarnessId, string> = { native: "APX", claude: "Claude Code", codex: "Codex", acp: "ACP" };

/** Consecutive provider refs go together (the native loop walks its list per call); every other ref is one attempt. */
function byHarness(refs: string[]): Array<{ harness: HarnessId; refs: string[] }> {
  const out: Array<{ harness: HarnessId; refs: string[] }> = [];
  for (const ref of refs) {
    const harness = harnessOf(ref);
    const last = out.at(-1);
    // Our loop walks its list per call; Claude Code and Codex get one model per attempt.
    if (last && harness === "native" && last.harness === "native") last.refs.push(ref);
    else out.push({ harness, refs: [ref] });
  }
  return out;
}

export type TurnDeps = {
  store: Store;
  harnesses: Harnesses;
  tools: Tool[];
  log: Log;
  inputs: Inputs;
  jobs: Jobs;
  /** APX's home: the owner's skills live under it. */
  home: string;
  apxPort: () => number;
  mcpTools?: ((thread: Thread) => Promise<Tool[]>) | undefined;
  /** Owner text steered into this turn since the last call. */
  takeSteered(): string[];
  /** A protocol method through the router, as the agent of `as.run`. */
  call: ToolCall;
  delegate(caller: Caller, to: DelegateTo, task: string, waitMs: number): Promise<string>;
};

export type ToolCall = <M extends MethodName>(
  method: M,
  params: Params<M>,
  as: { run: RunRecord; callId: string },
) => Promise<Result<M>>;

type Turn = { agent: AgentRecord; thread: Thread; input: NonNullable<RunRecord["input"]>; audience: Audience };
type Groups = Array<{ harness: HarnessId; refs: string[] }>;

export async function runTurn(deps: TurnDeps, start: RunRecord, signal: AbortSignal): Promise<RunRecord> {
  const { store } = deps;
  const thread = store.threads.get(start.thread_id);
  const agent = store.agents.get(start.agent_id);
  if (!thread || !agent || !start.input)
    return store.runs.setState(start, "failed", !start.input ? "run has no input" : "thread or agent is gone");
  const turn: Turn = { agent, thread, input: start.input, audience: audienceOf(store, thread) };

  let run = store.runs.setState(start, "working");
  store.threads.patch(thread.id, { state: "working" });
  const display = openDisplay(
    store,
    store.messages.add({ thread_id: thread.id, author: { kind: "agent", id: agent.id }, parts: [], run_id: run.id }),
  );
  run = store.runs.patch(run, { message_id: display.message.id });

  const { history, input, skills } = buildContext(deps, turn, run);
  const { policy, tools } = await turnTools(deps, turn);
  let harness: HarnessId = "native";
  const exec = createExecutor({
    store,
    inputs: deps.inputs,
    tools,
    agent: policy.agent,
    thread,
    run: () => run,
    display,
    signal,
    untrusted: [...history, input].some((m) => String(m.content ?? "").includes(UNTRUSTED_MARK)),
    external: () => harness !== "native",
    call: deps.call,
    jobs: deps.jobs,
    apxPort: deps.apxPort,
    workDir: path.join(deps.home, "work"),
    delegate: (to, task, waitMs) => deps.delegate({ run, agent, display }, to, task, waitMs),
  });
  const io = (): TurnIO => ({
    agent,
    thread,
    run,
    system: systemFor(store, turn, skills),
    sealed: turn.audience.kind === "contact",
    history,
    input,
    tools: tools.map(toSpec),
    models: [],
    signal,
    sessionId: undefined,
    onText: display.text,
    execute: exec.execute,
    approve: exec.approve,
    observe: exec.observe,
    takeSteered: deps.takeSteered,
    log: (items) => store.modelLog.append(thread.id, run.id, items),
  });

  try {
    const groups = await engineGroups(deps, turn, start, history);
    const outcome = await runEngines(deps, groups, {
      io,
      input,
      signal,
      exec,
      display,
      thread,
      run: () => run,
      onHarness: (h) => {
        harness = h;
        run = store.runs.patch(run, { harness: h });
      },
    });
    run = await finishRun(store, { run, thread, display, exec, outcome });
    return run;
  } catch (err) {
    return failRun(deps, { run, turn, display, signal, err });
  }
}

/** The model's view of the thread and this turn's framed input (with notes and the roster when they apply). */
function buildContext(deps: TurnDeps, turn: Turn, run: RunRecord) {
  const { store } = deps;
  const { agent, thread } = turn;
  // A contact's turn knows nothing of the owner's: no notes, no roster, no skills.
  const sealed = turn.audience.kind === "contact";
  const ctxState = store.threads.context(thread.id);
  const { items: history, from } = project(store.modelLog.list(thread.id), HISTORY_BUDGET_CHARS, ctxState.compaction);
  const roster = rosterBlock(agent, store.agents.list(), thread);
  const rosterChanged = !sealed && (ctxState.roster_hash !== roster.hash || ctxState.roster_agent !== agent.id);
  const recalled = sealed ? {} : recallFor(store, agent.id, thread, turn.input.text, ctxState, from);
  const input: ChatItem & { role: "user" } = {
    role: "user",
    content: turnInput({
      origin: turn.input.origin,
      text: turn.input.text,
      now: new Date(),
      roster: rosterChanged ? roster.text : undefined,
      memory: recalled.text,
    }),
  };
  const at = store.modelLog.append(thread.id, run.id, [input]);
  if (rosterChanged || recalled.shown)
    store.threads.mergeContext(thread.id, {
      ...(rosterChanged ? { roster_hash: roster.hash, roster_agent: agent.id } : {}),
      ...(recalled.shown ? recalled.shown(at) : {}),
    });
  const skills = sealed ? "" : skillCatalog(agentSkills(agent, skillsFor(store, deps.home, thread.project_id)));
  return { history, input, skills };
}

/** The tools this turn may use: the agent's, narrowed by whoever asked for it up the chain; none for a contact. */
async function turnTools(deps: TurnDeps, turn: Turn) {
  const sealed = turn.audience.kind === "contact";
  const callers = callersOf(deps.store, turn.thread.id);
  // MCP tools join the built-in ones for this turn; a server that does not start just adds none.
  const mcpTools = !sealed && deps.mcpTools ? await deps.mcpTools(turn.thread).catch(() => []) : [];
  const policy = inherit(turn.agent, callers, sealed ? [] : [...deps.tools, ...mcpTools]);
  const tools = policy.tools.filter(
    (t) => callers.length < MAX_DEPTH || (t.name !== "delegate" && t.name !== "list_sessions"),
  );
  return { policy, tools };
}

function systemFor(store: Store, turn: Turn, skills: string): string {
  const lang = store.settings.get("owner_language") ?? "es";
  if (turn.audience.kind === "contact") return contactPrompt(turn.agent, turn.audience, lang);
  // The thread's project when it has one (a global agent working there needs its AGENTS.md too).
  const projectId = turn.thread.project_id ?? turn.agent.project_id;
  return systemPrompt(turn.agent, turn.thread, lang, projectId ? store.projects.get(projectId) : undefined, skills);
}

/** The engines to try, in the router's order; a sealed turn only where no tool of the engine's own can run. */
async function engineGroups(deps: TurnDeps, turn: Turn, start: RunRecord, history: ChatItem[]): Promise<Groups> {
  const settings = modelSettings(deps.store);
  const refs = candidates(turn.agent.model_choice ?? settings.defaultChoice(), settings.router(), {
    text: turn.input.text,
    context_chars: history.reduce((n, m) => n + String(m.content ?? "").length, 0),
    has_image: false,
    channel: turn.thread.channel?.id ?? "app",
    trigger: start.trigger,
    agent_kind: turn.agent.kind,
  });
  // Nothing chosen anywhere yet (a fresh install): the engines signed in on this machine, in their own order.
  const ready = refs.length
    ? refs
    : (await deps.harnesses.status()).filter((e) => e.id !== "native" && e.installed && e.logged_in).map((e) => e.id);
  const sealed = turn.audience.kind === "contact";
  const groups = byHarness(sealed ? ready.filter((r) => SEALED_HARNESSES.has(harnessOf(r))) : ready);
  if (!groups.length && sealed)
    throw new Error(
      "no engine here can answer a contact without tools: add an API model or Claude Code to this agent's models",
    );
  if (!groups.length)
    throw new Error(
      "no model chosen for this agent, the router has none and no engine is signed in; pick one in Settings → Engines and models",
    );
  return groups;
}

/**
 * Tries each engine in turn. One that is out of quota or logged out before doing anything hands over to the next;
 * once a tool ran, a retry could repeat its effect, so the failure stands.
 */
async function runEngines(
  deps: TurnDeps,
  groups: Groups,
  t: {
    io: () => TurnIO;
    input: ChatItem & { role: "user" };
    signal: AbortSignal;
    exec: Executor;
    display: Display;
    thread: Thread;
    run: () => RunRecord;
    onHarness(h: HarnessId): void;
  },
): Promise<TurnOutcome> {
  const { store } = deps;
  for (const [i, g] of groups.entries()) {
    try {
      t.onHarness(g.harness);
      const external = g.harness !== "native";
      // Each ACP agent keeps its own sessions; Claude Code and Codex one each.
      const key = sessionKey(g.harness, g.refs[0]);
      const sessionId = external ? store.harnessSessions.get(t.thread.id, key) : undefined;
      const recap = external ? recapFor(store, t.thread.id, key, t.run().id) : "";
      const outcome = await deps.harnesses.get(g.harness).run({
        ...t.io(),
        models: g.refs,
        sessionId,
        input: recap ? { ...t.input, content: `${recap}${t.input.content}` } : t.input,
      });
      if (external) {
        if (outcome.sessionId) store.harnessSessions.set(t.thread.id, key, outcome.sessionId);
        // External harnesses keep their own transcript; ours keeps the answer so a switch back has context.
        store.modelLog.append(t.thread.id, t.run().id, [{ role: "assistant", content: outcome.text || null }]);
      }
      t.signal.throwIfAborted();
      return outcome;
    } catch (err) {
      const next = groups[i + 1];
      if (t.signal.aborted || t.exec.toolsRan > 0 || !next) throw err;
      const reason = errorMessage(err).split("\n")[0]?.slice(0, 160);
      deps.log.warn(
        { thread: t.thread.id, harness: g.harness, err: reason },
        "engine unavailable, trying the next one",
      );
      t.display.notice(
        "warn",
        "engine.fallback",
        `${g.harness === "acp" ? engineOf(g.refs[0] ?? "") : HARNESS_LABEL[g.harness]} is not available (${reason}); trying ${next.refs[0]}.`,
      );
    }
  }
  throw new Error("no engine answered");
}

/** The answer is in: final text (or an honest notice), the code changes card, usage, and the thread back to idle. */
async function finishRun(
  store: Store,
  t: { run: RunRecord; thread: Thread; display: Display; exec: Executor; outcome: TurnOutcome },
): Promise<RunRecord> {
  const { display, thread, outcome } = t;
  display.close();
  display.setModel(outcome.model);
  if (thread.kind === "code" && thread.cwd) {
    const changes = await gitChanges(thread.cwd);
    if (changes) display.upsert((p) => p.type === "changes", changes);
  }
  const text = outcome.text.trim();
  const empty = t.exec.toolsRan ? "Finished without a message." : "The model gave no answer.";
  if (text) display.finalText(text);
  else display.notice("info", "run.empty", empty);
  let run = store.runs.patch(t.run, { model: outcome.model, ...(outcome.usage ? { usage: outcome.usage } : {}) });
  run = store.runs.setState(run, "completed");
  store.threads.patch(thread.id, {
    state: "idle",
    preview: previewOf(text || (t.exec.toolsRan ? "Finished without a message." : "No answer.")),
    unread: (store.threads.get(thread.id)?.unread ?? 0) + 1,
  });
  return run;
}

/** Canceled or failed: a notice saying why, the model log closed honestly, the run and thread marked. */
function failRun(
  deps: TurnDeps,
  t: { run: RunRecord; turn: Turn; display: Display; signal: AbortSignal; err: unknown },
): RunRecord {
  const { store } = deps;
  t.display.close();
  const canceled = t.signal.reason instanceof Canceled;
  const reason = t.err instanceof Error ? t.err.message : String(t.err);
  const short = reason.split("\n")[0]?.slice(0, 200) ?? reason;
  const message = canceled ? "Canceled." : `Could not finish: ${short}`;
  if (!canceled) deps.log.warn({ thread: t.turn.thread.id, agent: t.turn.agent.id, err: reason }, "run failed");
  t.display.notice(canceled ? "info" : "error", canceled ? "run.canceled" : "run.failed", message);
  closeTurnLog(store, t.run, canceled ? "The owner canceled this turn." : `This turn failed: ${reason}`);
  const run = store.runs.setState(t.run, canceled ? "canceled" : "failed", message);
  store.threads.patch(t.turn.thread.id, { state: canceled ? "canceled" : "failed", preview: previewOf(message) });
  return run;
}
