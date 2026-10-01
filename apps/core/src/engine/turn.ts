// One run, start to end: context in, harness loop, every tool call through one executor, an honest end state.
import type { HarnessId, MethodName, Params, Result, Thread } from "@apx/protocol";
import { engineOf, harnessOf } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Harnesses, TurnIO, TurnOutcome } from "../harness/index.ts";
import type { Log } from "../log.ts";
import { candidates, modelSettings } from "../models/choice.ts";
import type { ChatItem } from "../providers/types.ts";
import { inherit, UNTRUSTED_MARK } from "../tools/policy.ts";
import { type Tool, toSpec } from "../tools/types.ts";
import { callersOf } from "./ancestry.ts";
import { gitChanges } from "./changes.ts";
import { projectHistory, rosterBlock, systemPrompt, turnInput } from "./context.ts";
import type { Caller, DelegateTo } from "./delegation.ts";
import { openDisplay } from "./display.ts";
import { createExecutor } from "./executor.ts";
import type { Inputs } from "./inputs.ts";
import type { Jobs } from "./jobs.ts";
import { MAX_DEPTH } from "./limits.ts";
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
  apxPort?: number | undefined;
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

export async function runTurn(deps: TurnDeps, start: RunRecord, signal: AbortSignal): Promise<RunRecord> {
  const { store, harnesses, log } = deps;
  const thread = store.threads.get(start.thread_id);
  const agent = store.agents.get(start.agent_id);
  if (!thread || !agent || !start.input)
    return store.runs.setState(start, "failed", !start.input ? "run has no input" : "thread or agent is gone");

  let run = store.runs.setState(start, "working");
  store.threads.patch(thread.id, { state: "working" });
  const display = openDisplay(
    store,
    store.messages.add({ thread_id: thread.id, author: { kind: "agent", id: agent.id }, parts: [], run_id: run.id }),
  );
  run = store.runs.patch(run, { message_id: display.message.id });

  // ── context ─────────────────────────────────────────────────────────
  const history = projectHistory(store.modelLog.list(thread.id));
  const ctxState = store.threads.context(thread.id);
  const roster = rosterBlock(agent, store.agents.list(), thread);
  const rosterChanged = ctxState.roster_hash !== roster.hash || ctxState.roster_agent !== agent.id;
  const input: ChatItem & { role: "user" } = {
    role: "user",
    content: turnInput({
      origin: start.input.origin,
      text: start.input.text,
      now: new Date(),
      roster: rosterChanged ? roster.text : undefined,
    }),
  };
  store.modelLog.append(thread.id, run.id, [input]);
  if (rosterChanged)
    store.threads.setContext(thread.id, { ...ctxState, roster_hash: roster.hash, roster_agent: agent.id });

  // ── tools ───────────────────────────────────────────────────────────
  const callers = callersOf(store, thread.id);
  // MCP tools join the built-in ones for this turn; a server that does not start just adds none.
  const mcpTools = deps.mcpTools ? await deps.mcpTools(thread).catch(() => []) : [];
  const policy = inherit(agent, callers, [...deps.tools, ...mcpTools]);
  const available = policy.tools.filter(
    (t) => callers.length < MAX_DEPTH || (t.name !== "delegate" && t.name !== "list_sessions"),
  );
  let harness: HarnessId = "native";
  const exec = createExecutor({
    store,
    inputs: deps.inputs,
    tools: available,
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
    delegate: (to, task, waitMs) => deps.delegate({ run, agent, display }, to, task, waitMs),
  });
  const execute = exec.execute;

  const io = (): TurnIO => ({
    agent,
    thread,
    run,
    system: systemPrompt(
      agent,
      thread,
      store.settings.get("owner_language") ?? "es",
      agent.project_id ? store.projects.get(agent.project_id) : undefined,
    ),
    history,
    input,
    tools: available.map(toSpec),
    models: [],
    signal,
    sessionId: undefined,
    onText: display.text,
    execute,
    approve: exec.approve,
    observe: exec.observe,
    takeSteered: deps.takeSteered,
    log: (items) => store.modelLog.append(thread.id, run.id, items),
  });
  const settings = modelSettings(store);
  const refs = candidates(agent.model_choice ?? settings.defaultChoice(), settings.router(), {
    text: start.input.text,
    context_chars: history.reduce((n, m) => n + String(m.content ?? "").length, 0),
    has_image: false,
    channel: "app",
    trigger: start.trigger,
    agent_kind: agent.kind,
  });

  try {
    let outcome: TurnOutcome | undefined;
    // Nothing chosen anywhere yet (a fresh install): the engines signed in on this machine, in their own order.
    const ready = refs.length
      ? refs
      : (await harnesses.status()).filter((e) => e.id !== "native" && e.installed && e.logged_in).map((e) => e.id);
    const groups = byHarness(ready);
    if (!groups.length)
      throw new Error(
        "no model chosen for this agent, the router has none and no engine is signed in; pick one in Settings → Engines and models",
      );
    for (const [i, g] of groups.entries()) {
      try {
        harness = g.harness;
        run = store.runs.patch(run, { harness: g.harness });
        const external = g.harness !== "native";
        // Each ACP agent keeps its own sessions; Claude Code and Codex one each.
        const key = sessionKey(g.harness, g.refs[0]);
        const sessionId = external ? store.harnessSessions.get(thread.id, key) : undefined;
        const recap = external ? recapFor(store, thread.id, key, run.id) : "";
        outcome = await harnesses.get(g.harness).run({
          ...io(),
          models: g.refs,
          sessionId,
          input: recap ? { ...input, content: `${recap}${input.content}` } : input,
        });
        if (g.harness !== "native") {
          if (outcome.sessionId) store.harnessSessions.set(thread.id, key, outcome.sessionId);
          // External harnesses keep their own transcript; ours keeps the answer so a switch back has context.
          store.modelLog.append(thread.id, run.id, [{ role: "assistant", content: outcome.text || null }]);
        }
        break;
      } catch (err) {
        // Out of quota or logged out before doing anything: the next engine the router lists answers instead.
        // Once a tool ran, a retry could repeat its effect, so the failure stands.
        const next = groups[i + 1];
        if (signal.aborted || exec.toolsRan > 0 || !next) throw err;
        const reason = (err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 160);
        log.warn({ thread: thread.id, harness: g.harness, err: reason }, "engine unavailable, trying the next one");
        display.notice(
          "warn",
          "engine.fallback",
          `${g.harness === "acp" ? engineOf(g.refs[0] ?? "") : HARNESS_LABEL[g.harness]} is not available (${reason}); trying ${next.refs[0]}.`,
        );
      }
    }
    if (!outcome) throw new Error("no engine answered");
    if (signal.aborted) throw signal.reason ?? new Error("canceled");
    display.close();
    display.setModel(outcome.model);
    if (thread.kind === "code" && thread.cwd) {
      const changes = await gitChanges(thread.cwd);
      if (changes) display.upsert((p) => p.type === "changes", changes);
    }
    const text = outcome.text.trim();
    if (text) display.finalText(text);
    else
      display.notice("info", "run.empty", exec.toolsRan ? "Finished without a message." : "The model gave no answer.");
    run = store.runs.patch(run, { model: outcome.model, ...(outcome.usage ? { usage: outcome.usage } : {}) });
    run = store.runs.setState(run, "completed");
    const t = store.threads.get(thread.id);
    store.threads.patch(thread.id, {
      state: "idle",
      preview: (text || (exec.toolsRan ? "Finished without a message." : "No answer.")).slice(0, 160),
      unread: (t?.unread ?? 0) + 1,
    });
    return run;
  } catch (err) {
    display.close();
    const canceled = signal.aborted && String(signal.reason ?? "").includes("cancel");
    const reason = err instanceof Error ? err.message : String(err);
    const short = reason.split("\n")[0]?.slice(0, 200) ?? reason;
    const message = canceled ? "Canceled." : `Could not finish: ${short}`;
    if (!canceled) log.warn({ thread: thread.id, agent: agent.id, err: reason }, "run failed");
    display.notice(canceled ? "info" : "error", canceled ? "run.canceled" : "run.failed", message);
    closeTurnLog(store, run, canceled ? "The owner canceled this turn." : `This turn failed: ${reason}`);
    run = store.runs.setState(run, canceled ? "canceled" : "failed", message);
    store.threads.patch(thread.id, { state: canceled ? "canceled" : "failed", preview: message.slice(0, 160) });
    return run;
  }
}
