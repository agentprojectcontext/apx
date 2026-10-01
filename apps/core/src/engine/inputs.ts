// One machine for everything an agent waits on from the owner: confirmations before a tool runs and questions.
// The row is written before the wait starts; an answer that arrives after its run is gone (a restart, a deadline)
// wakes the agent with a new run instead of being lost.
import type { InputKind, Part } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type InputRecord, publicInput } from "../domain/inputs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound, Shutdown } from "../errors.ts";
import type { Display } from "./display.ts";
import type { AdmitFn } from "./engine.ts";

/** How long a question or confirmation stays open while the agent waits in its turn. */
export const INPUT_WAIT_MS = 15 * 60_000;
/** Claude Code and Codex reach our tools over a call with its own deadline: the wait must end before it. */
export const EXTERNAL_INPUT_WAIT_MS = 5 * 60_000;

const partOf = (r: InputRecord): Part => ({
  type: "input",
  input_id: r.id,
  kind: r.kind,
  prompt: r.prompt,
  ...(r.tool ? { tool: r.tool } : {}),
  ...(r.detail ? { detail: r.detail } : {}),
  ...(r.options ? { options: r.options } : {}),
  state: r.state,
  ...(r.answer ? { answer: r.answer } : {}),
});

const grantKey = (thread: string, agent: string, tool: string, args: unknown) =>
  `${thread}\u0000${agent}\u0000${tool}\u0000${JSON.stringify(args)}`;
/** An approval that outlived its turn is good for one identical call, soon: not days later in another context. */
const GRANT_MS = 30 * 60_000;

export function createInputs(deps: {
  store: Store;
  admit: AdmitFn;
  /** Stops the run's deadline while it waits; the returned function starts it again. */
  hold: (runId: string) => () => void;
}) {
  const { store } = deps;
  const waiting = new Map<string, (r: InputRecord) => void>();
  /** Calls the owner approved after their run was gone: the agent's next identical call runs without asking again. */
  const grants = new Map<string, number>();

  /** Rewrites the input's card in the message that asked, for answers that arrive with no turn listening. */
  function settleCard(r: InputRecord): void {
    const msg = r.message_id ? store.messages.get(r.message_id) : undefined;
    if (!msg) return;
    store.messages.update({
      ...msg,
      parts: msg.parts.map((p) => (p.type === "input" && p.input_id === r.id ? partOf(r) : p)),
    });
  }

  /** An answer for a run that no longer waits: a new turn tells the agent, in the owner's words. */
  function wake(r: InputRecord): void {
    settleCard(r);
    let text: string;
    if (r.kind === "question") text = `You asked the owner: "${r.prompt}". Their answer: ${r.answer ?? "(empty)"}`;
    else if (r.state === "approved") {
      if (r.tool) grants.set(grantKey(r.thread_id, r.agent_id, r.tool, r.args ?? {}), Date.now() + GRANT_MS);
      text = `The owner approved ${r.tool} (${r.detail ?? r.prompt}), but your earlier turn had already ended, so it did not run. If it is still needed, call it again with the same arguments: it will run without asking.${r.answer ? ` Their note: ${r.answer}` : ""}`;
    } else
      text = `The owner declined ${r.tool} (${r.detail ?? r.prompt}). Do not try it again.${r.answer ? ` Their note: ${r.answer}` : ""}`;
    deps.admit({
      thread_id: r.thread_id,
      agent_id: r.agent_id,
      trigger: "user",
      origin: { kind: "input_answer", input_id: r.id },
      text,
    });
  }

  return {
    /** Writes the input, shows it, marks the run as waiting and resolves when it is answered, expires or the run stops. */
    async ask(o: {
      run: RunRecord;
      agent: AgentRecord;
      display: Display;
      callId: string;
      kind: InputKind;
      prompt: string;
      tool?: string | undefined;
      args?: Record<string, unknown> | undefined;
      detail?: string | undefined;
      options?: string[] | undefined;
      waitMs: number;
      signal: AbortSignal;
    }): Promise<InputRecord> {
      const rec = store.inputs.create({
        run_id: o.run.id,
        thread_id: o.run.thread_id,
        agent_id: o.agent.id,
        message_id: o.display.message.id,
        call_id: o.callId,
        kind: o.kind,
        prompt: o.prompt,
        tool: o.tool,
        args: o.args,
        detail: o.detail,
        options: o.options,
        waitMs: o.waitMs,
      });
      const show = (r: InputRecord) => o.display.upsert((p) => p.type === "input" && p.input_id === r.id, partOf(r));
      show(rec);
      store.runs.setState(o.run, "input-required");
      store.threads.patch(o.run.thread_id, { state: "input-required" });
      const release = deps.hold(o.run.id);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expire = () => store.inputs.settle(rec.id, "expired") ?? (store.inputs.get(rec.id) as InputRecord);
      try {
        const settled = await new Promise<InputRecord>((resolve) => {
          waiting.set(rec.id, resolve);
          timer = setTimeout(() => resolve(expire()), o.waitMs);
          // A shutdown keeps the input open (the answer wakes the agent after the restart); anything else closes it.
          const stop = () =>
            resolve(o.signal.reason instanceof Shutdown ? (store.inputs.get(rec.id) as InputRecord) : expire());
          if (o.signal.aborted) stop();
          o.signal.addEventListener("abort", stop, { once: true });
        });
        show(settled);
        return settled;
      } finally {
        clearTimeout(timer);
        release();
        waiting.delete(rec.id);
        if (!o.signal.aborted) {
          store.runs.setState(o.run, "working");
          store.threads.patch(o.run.thread_id, { state: "working" });
        }
      }
    },

    respond(id: string, a: { decision?: "approve" | "deny" | undefined; text?: string | undefined }): InputRecord {
      const rec = store.inputs.get(id);
      if (!rec) throw notFound(`input ${id}`);
      if (rec.state === "pending" && rec.expires_at <= new Date().toISOString()) store.inputs.settle(id, "expired");
      const cur = store.inputs.get(id) as InputRecord;
      if (cur.state !== "pending") throw conflict(`input ${id} is already ${cur.state}`);
      const text = a.text?.trim() || undefined;
      let state: "approved" | "denied" | "answered";
      if (rec.kind === "confirm") {
        if (!a.decision) throw badRequest("a confirmation needs a decision");
        state = a.decision === "approve" ? "approved" : "denied";
      } else {
        if (!text) throw badRequest("a question needs an answer text");
        state = "answered";
      }
      const settled = store.inputs.settle(id, state, text);
      if (!settled) throw conflict(`input ${id} was answered already`);
      const listener = waiting.get(id);
      if (listener) listener(settled);
      else wake(settled);
      return settled;
    },

    /** True once for a call the owner approved after its turn had ended. */
    takeGrant(thread: string, agent: string, tool: string, args: Record<string, unknown>): boolean {
      const key = grantKey(thread, agent, tool, args);
      const until = grants.get(key);
      grants.delete(key);
      return until !== undefined && until > Date.now();
    },

    /**
     * Boot: inputs whose deadline passed while APX was down are closed; the rest stay answerable (the answer wakes
     * the agent) and close on their own deadline, with their cards saying so.
     */
    restore(): void {
      const expire = (id: string) => {
        const settled = store.inputs.settle(id, "expired");
        if (settled) settleCard(settled);
      };
      for (const r of store.inputs.overdue()) expire(r.id);
      for (const r of store.inputs.pending())
        setTimeout(() => expire(r.id), Math.max(0, Date.parse(r.expires_at) - Date.now())).unref();
    },

    pending: (thread?: string) => store.inputs.pending(thread).map(publicInput),
  };
}

export type Inputs = ReturnType<typeof createInputs>;
