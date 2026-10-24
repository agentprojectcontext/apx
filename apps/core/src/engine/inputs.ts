// One machine for everything an agent waits on from the owner: confirmations before a tool runs and questions.
// The row is written before the wait starts; an answer that arrives after its run is gone (a restart, a deadline)
// wakes the agent with a new run instead of being lost.
import type { ApprovalScope, FileChange, InputKind, Part } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type ApprovalTarget, writeFolderApproval } from "../domain/approvals.ts";
import { type InputRecord, publicInput } from "../domain/inputs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, errorMessage, notFound, Shutdown, unauthorized } from "../errors.ts";
import { addReadOnly } from "../tools/folders.ts";
import type { Display } from "./display.ts";
import type { AdmitFn } from "./engine.ts";

/** How long the agent waits in its turn for an answer before it ends the turn and the input stays open. */
export const INPUT_WAIT_MS = 15 * 60_000;
/** Claude Code and Codex reach our tools over a call with its own deadline: the wait must end before it. */
export const EXTERNAL_INPUT_WAIT_MS = 5 * 60_000;
/** How long an input the turn stopped waiting for stays answerable; its answer wakes the agent in a new turn. */
export const OPEN_INPUT_MS = 30 * 24 * 60 * 60_000;
/** The longest delay setTimeout takes; a later deadline is checked again when this one fires. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export type InputWaits = { turn: number; external: number };

/** Why a channel cannot answer a card about the owner's settings. */
export const APP_ONLY =
  "a change to the owner's settings is answered in the app (panel, desktop or phone), never on a channel";

/** What a folder card's "once" answer is kept under, when it comes after the turn stopped waiting. */
/** The grant a folder card gives for one call; one to change files there never doubles as one to read them. */
export const folderBinding = (folders: string[], write = false) =>
  `${write ? "write-folders" : "folders"}:${folders.join("\n")}`;

const partOf = (r: InputRecord): Part => ({
  type: "input",
  input_id: r.id,
  kind: r.kind,
  prompt: r.prompt,
  ...(r.tool ? { tool: r.tool } : {}),
  ...(r.detail ? { detail: r.detail } : {}),
  ...(r.change ? { change: r.change } : {}),
  ...(r.options ? { options: r.options } : {}),
  ...(r.multi ? { multi: true } : {}),
  ...(r.folders ? { folders: r.folders } : {}),
  ...(r.approval_scopes ? { approval_scopes: r.approval_scopes } : {}),
  ...(r.approval_scope ? { approval_scope: r.approval_scope } : {}),
  state: r.state,
  ...(r.answer ? { answer: r.answer } : {}),
});

export function createInputs(deps: {
  store: Store;
  /** APX's home: a folder card's folder is checked against it before it joins a project. */
  home: string;
  admit: AdmitFn;
  /** Stops the run's deadline while it waits; the returned function starts it again. */
  hold: (runId: string) => () => void;
  /** How long a turn waits for an answer (tests shorten it). */
  waits?: InputWaits;
}) {
  const { store } = deps;
  const waits = deps.waits ?? { turn: INPUT_WAIT_MS, external: EXTERNAL_INPUT_WAIT_MS };
  const waiting = new Map<string, (r: InputRecord) => void>();

  /** Rewrites the input's card in the message that asked, for answers that arrive with no turn listening. */
  function settleCard(r: InputRecord): void {
    // The live card's own update clears the tray; with no turn listening, it is cleared here.
    store.notifications.resolve("input", r.id);
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
    const note = r.answer ? ` Their note: ${r.answer}` : "";
    if (r.kind === "question") text = `You asked the owner: "${r.prompt}". Their answer: ${r.answer ?? "(empty)"}`;
    // An action card (no tool): the owner accepted or declined the action itself.
    else if (!r.tool && !r.folders)
      text =
        r.state === "approved"
          ? `The owner accepted the action you proposed: "${r.prompt}". Do it now, as proposed.${note}`
          : `The owner declined the action you proposed: "${r.prompt}". Do not do it.${note}`;
    else if (r.state === "approved") {
      const binding = r.approval?.key ?? (r.folders ? folderBinding(r.folders, r.folders_write) : undefined);
      if (r.tool && (!r.approval_scope || r.approval_scope === "once"))
        store.approvals.grantOnce(r.thread_id, r.agent_id, r.tool, r.args ?? {}, binding, r.approval?.server);
      const what = r.folders
        ? `let you ${r.folders_write ? "change files in" : "read"} ${r.folders.join(", ")}${r.approval_scope === "project" ? " in this project from now on" : r.approval_scope === "always" ? " from now on" : " for that call"}`
        : `approved ${r.tool} (${r.detail ?? r.prompt})`;
      text = `The owner ${what}, but your earlier turn had already ended, so it did not run. If it is still needed, call it again with the same arguments: it will run without asking.${r.answer ? ` Their note: ${r.answer}` : ""}`;
    } else
      text = `The owner declined ${r.tool} (${r.detail ?? r.prompt}). Do not try it again.${r.answer ? ` Their note: ${r.answer}` : ""}`;
    const previous = store.runs.get(r.run_id);
    deps.admit({
      thread_id: r.thread_id,
      agent_id: r.agent_id,
      trigger: "user",
      origin: { kind: "input_answer", input_id: r.id },
      text,
      reply_to: previous?.input?.reply_to,
      parent_run_id: previous?.parent_run_id,
      depth: previous?.depth ?? 0,
    });
  }

  /** Why a folder card's folders cannot join its chat's project as read-only folders, or undefined when they can. */
  function cannotKeep(threadId: string, folders: string[]): string | undefined {
    const project = store.threads.get(threadId)?.project_id;
    if (!project) return "this chat has no project to add the folder to";
    try {
      addReadOnly(store, deps.home, project, folders, true);
      return undefined;
    } catch (err) {
      return errorMessage(err);
    }
  }
  const keepable = (threadId: string, folders: string[]) => cannotKeep(threadId, folders) === undefined;

  /** A chat that only waited on the owner goes back to idle once nothing is left to wait on. */
  function idleIfDone(threadId: string): void {
    const th = store.threads.get(threadId);
    if (th?.state === "input-required" && !store.inputs.pending(th.id).length && !store.threads.busy([th.id]))
      store.threads.patch(th.id, { state: "idle" });
  }

  store.approvals.subscribe(() => {
    for (const r of store.inputs.pending()) {
      if (r.kind !== "confirm" || !r.approval || !store.approvals.allows(r.approval, r.thread_id, r.agent_id, r.args))
        continue;
      const grant = store.approvals
        .list(r.thread_id)
        .find((g) => g.key === r.approval?.key && (!g.agent_id || g.agent_id === r.agent_id));
      const settled = store.inputs.settle(r.id, "approved", undefined, grant?.scope);
      if (!settled) continue;
      const listener = waiting.get(r.id);
      if (listener) listener(settled);
      else wake(settled);
    }
  });

  return {
    /**
     * Writes the input, shows it, marks the run as waiting and resolves when it is answered, the turn's wait ends or
     * the run stops. When the wait ends, an input that `stays` is still pending (answering it later wakes the agent);
     * otherwise it expires.
     */
    async ask(o: {
      run: RunRecord;
      agent: AgentRecord;
      display: Display;
      callId: string;
      kind: InputKind;
      approval?: ApprovalTarget | undefined;
      prompt: string;
      tool?: string | undefined;
      args?: Record<string, unknown> | undefined;
      detail?: string | undefined;
      change?: FileChange | undefined;
      options?: string[] | undefined;
      multi?: boolean | undefined;
      /** A folder card: the folders outside the agent's own the call would read, or change (`write`). */
      folders?: string[] | undefined;
      write?: boolean | undefined;
      /** Claude Code or Codex: its call to our tool has a shorter deadline. */
      external: boolean;
      /** Stays open after the turn stops waiting, instead of counting as no answer. */
      stays: boolean;
      /** Only the app answers it, never a channel (DECISIONS.md#d-144). */
      appOnly?: boolean | undefined;
      signal: AbortSignal;
    }): Promise<InputRecord> {
      const waitMs = o.external ? waits.external : waits.turn;
      const rec = store.inputs.create({
        run_id: o.run.id,
        thread_id: o.run.thread_id,
        agent_id: o.agent.id,
        message_id: o.display.message.id,
        call_id: o.callId,
        kind: o.kind,
        approval: o.approval,
        prompt: o.prompt,
        tool: o.tool,
        args: o.args,
        detail: o.detail,
        change: o.change,
        options: o.options,
        multi: o.multi,
        // A folder to change is lent for the call only: a read-only folder of the project would not let it write.
        folders: o.folders && {
          dirs: o.folders,
          keep: !o.write && keepable(o.run.thread_id, o.folders),
          ...(o.write ? { write: true } : {}),
        },
        waitMs: o.stays ? OPEN_INPUT_MS : waitMs,
        app_only: o.appOnly,
      });
      const show = (r: InputRecord) => o.display.upsert((p) => p.type === "input" && p.input_id === r.id, partOf(r));
      show(rec);
      store.runs.setState(o.run, "input-required");
      store.threads.patch(o.run.thread_id, { state: "input-required" });
      const release = deps.hold(o.run.id);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stop: (() => void) | undefined;
      const expire = () => store.inputs.settle(rec.id, "expired") ?? (store.inputs.get(rec.id) as InputRecord);
      const current = () => store.inputs.get(rec.id) as InputRecord;
      try {
        const settled = await new Promise<InputRecord>((resolve) => {
          waiting.set(rec.id, resolve);
          timer = setTimeout(() => resolve(o.stays ? current() : expire()), waitMs);
          // A shutdown keeps the input open (the answer wakes the agent after the restart); anything else closes it.
          stop = () => resolve(o.signal.reason instanceof Shutdown ? current() : expire());
          if (o.signal.aborted) stop();
          o.signal.addEventListener("abort", stop, { once: true });
        });
        show(settled);
        return settled;
      } finally {
        clearTimeout(timer);
        if (stop) o.signal.removeEventListener("abort", stop);
        release();
        waiting.delete(rec.id);
        if (!o.signal.aborted) {
          store.runs.setState(o.run, "working");
          store.threads.patch(o.run.thread_id, { state: "working" });
        }
      }
    },

    /** `onChannel`: the answer came on a channel, which never answers what only the app may (DECISIONS.md#d-144). */
    respond(
      id: string,
      a: { decision?: "approve" | "deny" | undefined; text?: string | undefined; scope?: ApprovalScope | undefined },
      onChannel = false,
    ): InputRecord {
      const rec = store.inputs.get(id);
      if (!rec) throw notFound(`input ${id}`);
      if (rec.app_only && onChannel) throw unauthorized(APP_ONLY);
      if (rec.state === "pending" && rec.expires_at <= new Date().toISOString()) store.inputs.settle(id, "expired");
      const cur = store.inputs.get(id) as InputRecord;
      if (cur.state !== "pending") throw conflict(`input ${id} is already ${cur.state}`);
      const scope = a.scope ?? "once";
      if (a.scope && (rec.kind !== "confirm" || a.decision !== "approve"))
        throw badRequest("approval scope requires approving a confirmation");
      if (scope !== "once" && !rec.approval_scopes?.includes(scope))
        throw badRequest("this approval scope is not available for this tool");
      // "Allow reading it in this project": the folder joins the project's read-only folders, checked as projects.update.
      const project = scope === "project" ? store.threads.get(rec.thread_id)?.project_id : undefined;
      const why = scope === "project" && rec.folders ? cannotKeep(rec.thread_id, rec.folders) : undefined;
      if (why) throw badRequest(why);
      const text = a.text?.trim() || undefined;
      let state: "approved" | "denied" | "answered";
      if (rec.kind === "confirm") {
        if (!a.decision) throw badRequest("a confirmation needs a decision");
        state = a.decision === "approve" ? "approved" : "denied";
      } else {
        if (!text) throw badRequest("a question needs an answer text");
        state = "answered";
      }
      const settled = store.tx(() => {
        const r = store.inputs.settle(id, state, text, state === "approved" ? scope : undefined);
        if (r && state === "approved" && rec.approval)
          store.approvals.grant(rec.approval, scope, rec.thread_id, rec.agent_id);
        if (r && scope === "always" && rec.folders_write)
          for (const dir of rec.folders ?? [])
            store.approvals.grant(writeFolderApproval(dir), "always", rec.thread_id, rec.agent_id);
        if (r && project && rec.folders) addReadOnly(store, deps.home, project, rec.folders);
        return r;
      });
      if (!settled) throw conflict(`input ${id} was answered already`);
      const listener = waiting.get(id);
      if (listener) listener(settled);
      else wake(settled);
      return settled;
    },

    /**
     * An agent takes back its own open question: it ends `withdrawn`, the turn waiting on it (if any) goes on, and
     * nothing new reaches the owner.
     */
    withdraw(id: string, agentId: string): InputRecord {
      const rec = store.inputs.get(id);
      const own = rec && rec.agent_id === agentId && (rec.kind === "question" || (!rec.tool && !rec.folders));
      if (!own) throw notFound(`question ${id} of yours`);
      const settled = store.inputs.settle(id, "withdrawn");
      if (!settled) throw conflict(`question ${id} is already ${store.inputs.get(id)?.state ?? "closed"}`);
      const listener = waiting.get(id);
      if (listener) listener(settled);
      else {
        settleCard(settled);
        idleIfDone(settled.thread_id);
      }
      return settled;
    },

    /** True once for a call the owner approved after its turn had ended. */
    takeGrant(thread: string, agent: string, tool: string, args: Record<string, unknown>, binding?: string): boolean {
      return store.approvals.takeOnce(thread, agent, tool, args, binding);
    },

    /**
     * Boot: inputs whose deadline passed while APX was down are closed; the rest stay answerable (the answer wakes
     * the agent) and close on their own deadline, with their cards saying so.
     */
    restore(): void {
      const expire = (id: string) => {
        const settled = store.inputs.settle(id, "expired");
        if (!settled) return;
        settleCard(settled);
        idleIfDone(settled.thread_id);
      };
      const watch = (r: InputRecord) => {
        const left = Date.parse(r.expires_at) - Date.now();
        if (left <= 0) return expire(r.id);
        setTimeout(
          () => {
            const now = store.inputs.get(r.id);
            if (now?.state === "pending") watch(now);
          },
          Math.min(left, MAX_TIMER_MS),
        ).unref();
      };
      for (const r of store.inputs.overdue()) expire(r.id);
      for (const r of store.inputs.pending()) watch(r);
    },

    pending: (thread?: string) => store.inputs.pending(thread).map(publicInput),
  };
}

export type Inputs = ReturnType<typeof createInputs>;
