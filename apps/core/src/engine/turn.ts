// One run, start to end: context in, harness loop, every tool call through one executor, an honest end state.
import type { HarnessId } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { harnessOf } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Harnesses, TurnIO, TurnOutcome } from "../harness/index.ts";
import type { Log } from "../log.ts";
import { candidates, modelSettings } from "../models/choice.ts";
import type { ChatItem } from "../providers/types.ts";
import { MAX_DEPTH } from "../tools/agents.ts";
import { type Tool, type ToolContext, toSpec } from "../tools/types.ts";
import { projectHistory, rosterBlock, systemPrompt, turnInput } from "./context.ts";
import type { Caller } from "./delegation.ts";
import { openDisplay } from "./display.ts";
import { closeTurnLog } from "./recovery.ts";

const HARNESS_LABEL: Record<HarnessId, string> = { native: "APX", claude: "Claude Code", codex: "Codex" };

/** Consecutive refs run by the same harness go together (the native loop walks its list per call). */
function byHarness(refs: string[]): Array<{ harness: HarnessId; refs: string[] }> {
  const out: Array<{ harness: HarnessId; refs: string[] }> = [];
  for (const ref of refs) {
    const harness = harnessOf(ref);
    const last = out.at(-1);
    if (last && last.harness === harness) last.refs.push(ref);
    else out.push({ harness, refs: [ref] });
  }
  return out;
}

export type TurnDeps = {
  store: Store;
  harnesses: Harnesses;
  tools: Tool[];
  log: Log;
  delegate(caller: Caller, to: AgentRecord, task: string, waitMs: number): Promise<string>;
};

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
  const available = deps.tools.filter((t) => run.depth < MAX_DEPTH || t.name !== "delegate");
  const byName = new Map(available.map((t) => [t.name, t]));
  const ctx: ToolContext = {
    agent,
    thread,
    run,
    signal,
    upsertPart: display.upsert,
    delegate: (to, task, waitMs) => deps.delegate({ run, agent, display }, to, task, waitMs),
  };
  let toolsRan = 0;
  const execute: TurnIO["execute"] = async (callId, name, args) => {
    const tool = byName.get(name);
    const title = tool ? tool.title(args) : name;
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
    toolsRan++;
    store.runs.beginStep(run.id, { call_id: callId, tool: name, args, effect: tool.effect });
    const out = await runTool(tool, args, ctx);
    store.runs.endStep(run.id, callId, out.ok ? "ok" : "error", out.text.slice(0, 4000));
    if (signal.aborted) throw signal.reason ?? new Error("canceled");
    card(out.ok ? "ok" : "error", out.text.slice(0, 300));
    return out;
  };

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
    const groups = byHarness(refs);
    if (!groups.length)
      throw new Error("no model chosen for this agent and the router has none; pick one in Config → Models");
    for (const [i, g] of groups.entries()) {
      try {
        run = store.runs.patch(run, { harness: g.harness });
        const sessionId = g.harness === "native" ? undefined : store.harnessSessions.get(thread.id, g.harness);
        outcome = await harnesses.get(g.harness).run({ ...io(), models: g.refs, sessionId });
        if (g.harness !== "native") {
          if (outcome.sessionId) store.harnessSessions.set(thread.id, g.harness, outcome.sessionId);
          // External harnesses keep their own transcript; ours keeps the answer so a switch back has context.
          store.modelLog.append(thread.id, run.id, [{ role: "assistant", content: outcome.text || null }]);
        }
        break;
      } catch (err) {
        // Out of quota or logged out before doing anything: the next engine the router lists answers instead.
        // Once a tool ran, a retry could repeat its effect, so the failure stands.
        const next = groups[i + 1];
        if (signal.aborted || toolsRan > 0 || !next) throw err;
        const reason = (err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 160);
        log.warn({ thread: thread.id, harness: g.harness, err: reason }, "engine unavailable, trying the next one");
        display.notice(
          "warn",
          "engine.fallback",
          `${HARNESS_LABEL[g.harness]} is not available (${reason}); trying ${next.refs[0]}.`,
        );
      }
    }
    if (!outcome) throw new Error("no engine answered");
    if (signal.aborted) throw signal.reason ?? new Error("canceled");
    display.close();
    display.setModel(outcome.model);
    const text = outcome.text.trim();
    if (text) display.finalText(text);
    else display.notice("info", "run.empty", toolsRan ? "Finished without a message." : "The model gave no answer.");
    run = store.runs.patch(run, { model: outcome.model, ...(outcome.usage ? { usage: outcome.usage } : {}) });
    run = store.runs.setState(run, "completed");
    const t = store.threads.get(thread.id);
    store.threads.patch(thread.id, {
      state: "idle",
      preview: (text || (toolsRan ? "Finished without a message." : "No answer.")).slice(0, 160),
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
