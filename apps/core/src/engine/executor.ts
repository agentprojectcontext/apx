// The one executor every tool call goes through, whatever harness made it: check the arguments, ask the policy,
// wait for the owner when it says so, record the step, run with a deadline, keep the full output and hand the
// model a capped copy.
import type { MethodName, Params, Result, Thread } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { TurnIO } from "../harness/index.ts";
import { authorize, UNTRUSTED_MARK } from "../tools/policy.ts";
import { cap } from "../tools/result.ts";
import type { Tool, ToolContext } from "../tools/types.ts";
import type { Display } from "./display.ts";
import { EXTERNAL_INPUT_WAIT_MS, INPUT_WAIT_MS, type Inputs } from "./inputs.ts";

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

/** A readable one-line summary of a call's arguments for the confirmation card. */
function describe(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}: ${s.length > 160 ? `${s.slice(0, 160)}…` : s}`;
  });
  return parts.join(" · ").slice(0, 600);
}

export type Executor = { execute: TurnIO["execute"]; readonly toolsRan: number };

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
}): Executor {
  const { store, display, signal, agent, thread } = o;
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  let untrusted = o.untrusted;
  let toolsRan = 0;

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

    const decision = authorize(tool, agent, untrusted);
    if (decision.kind === "confirm" && !o.inputs.takeGrant(thread.id, name, raw)) {
      const answer = await o.inputs.ask({
        run,
        agent,
        display,
        callId,
        kind: "confirm",
        prompt: `${agent.name} wants to: ${title}. ${decision.reason}.`,
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
    const ctx: ToolContext = {
      agent,
      thread,
      run,
      signal,
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
    const out = await runTool(tool, args, ctx);
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

  return {
    execute,
    get toolsRan() {
      return toolsRan;
    },
  };
}
