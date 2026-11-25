// One machine for everything an agent waits on from the owner: confirmations before a tool runs and questions.
// The row is written before the wait starts; an answer that arrives after its run is gone (a restart, a deadline)
// wakes the agent with a new run instead of being lost.
import type { ApprovalScope, FileChange, InputKind, Part } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type ApprovalTarget, writeFolderApproval } from "../domain/approvals.ts";
import { type InputRecord, publicInput } from "../domain/inputs.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { awaitTaskInput, finishTaskInput, settleTaskInput, taskInputIsCurrent } from "../domain/task-input-wait.ts";
import { badRequest, conflict, errorMessage, notFound, Shutdown, unauthorized } from "../errors.ts";
import { addReadOnly } from "../tools/folders.ts";
import type { Display } from "./display.ts";
import type { AdmitFn } from "./engine.ts";
import { createInputDelivery } from "./input-delivery.ts";

export { folderBinding } from "./input-delivery.ts";

/** How long the agent waits in its turn for an answer before it ends the turn and the input stays open. */
const INPUT_WAIT_MS = 15 * 60_000;
/** Claude Code and Codex reach our tools over a call with its own deadline: the wait must end before it. */
const EXTERNAL_INPUT_WAIT_MS = 5 * 60_000;
/** How long an input the turn stopped waiting for stays answerable; its answer wakes the agent in a new turn. */
const OPEN_INPUT_MS = 30 * 24 * 60 * 60_000;
/** The longest delay setTimeout takes; a later deadline is checked again when this one fires. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export type InputWaits = { turn: number; external: number };

/** Approvals requiring the complete app card cannot be answered on a channel. */
const APP_ONLY = "this approval is answered in the app (panel, desktop or phone), never on a channel";

/** The site and field of an agent's sign-in card (DECISIONS.md#d-264), or undefined for any other input. */
export function loginRequest(r: InputRecord): { origin: string; kind: "username" | "password" } | undefined {
  const login = r.tool === "browser_sign_in" && r.kind === "question" ? r.args?.login : undefined;
  if (!login || typeof login !== "object") return undefined;
  const { origin, kind } = login as { origin?: unknown; kind?: unknown };
  return typeof origin === "string" && (kind === "username" || kind === "password") ? { origin, kind } : undefined;
}

/** A stored question or confirmation as the chat shows it. */
export const inputPartOf = (r: InputRecord): Extract<Part, { type: "input" }> => {
  const artifact = publicInput(r).artifact_draft;
  return {
    type: "input",
    input_id: r.id,
    kind: r.kind,
    prompt: r.prompt,
    ...(r.tool ? { tool: r.tool } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
    ...(artifact ? { artifact_draft: artifact } : {}),
    ...(loginRequest(r) ? { login: loginRequest(r) } : {}),
    ...(r.approval?.browser && typeof r.args?.document === "string"
      ? {
          browser: {
            origin: r.approval.browser.origin,
            title: r.approval.browser.title,
            tab_number: r.approval.browser.tab_number,
            document: r.args.document,
            ...(typeof r.args.path === "string" ? { path: r.args.path } : {}),
            ...(typeof r.args.sha256 === "string" ? { sha256: r.args.sha256 } : {}),
          },
        }
      : {}),
    ...(r.change ? { change: r.change } : {}),
    ...(r.options ? { options: r.options } : {}),
    ...(r.multi ? { multi: true } : {}),
    ...(r.folders ? { folders: r.folders } : {}),
    ...(r.approval_scopes ? { approval_scopes: r.approval_scopes } : {}),
    ...(r.approval_scope ? { approval_scope: r.approval_scope } : {}),
    state: r.state,
    ...(r.answer ? { answer: r.answer } : {}),
  };
};

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
  const pauseWait = new Map<string, () => void>();

  function expireInput(id: string, resume = false): InputRecord | undefined {
    return store.tx(() => {
      const settled = store.inputs.settle(id, "expired");
      if (settled) settleTaskInput(store, settled);
      const record = settled ?? store.inputs.get(id);
      if (record) {
        finishTaskInput(store, record);
        const task = store.threads.get(record.thread_id)?.task_id;
        if (resume && task) delivery.releaseTask(task);
      }
      return settled;
    });
  }

  /** Rewrites the input's card in the message that asked, for answers that arrive with no turn listening. */
  function settleCard(r: InputRecord): void {
    // The live card's own update clears the tray; with no turn listening, it is cleared here.
    store.notifications.resolve("input", r.id);
    const msg = r.message_id ? store.messages.get(r.message_id) : undefined;
    if (!msg) return;
    store.messages.update({
      ...msg,
      parts: msg.parts.map((p) => (p.type === "input" && p.input_id === r.id ? inputPartOf(r) : p)),
    });
  }

  const delivery = createInputDelivery({ store, admit: deps.admit, waiting, pauseWait, settleCard });

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
      if (
        r.kind !== "confirm" ||
        !taskInputIsCurrent(store, r) ||
        !r.approval ||
        publicInput(r).artifact_draft ||
        !store.approvals.allows(r.approval, r.thread_id, r.agent_id, r.args)
      )
        continue;
      const grant = store.approvals
        .list(r.thread_id)
        .find(
          (g) =>
            (g.key === r.approval?.key || (!!r.approval?.group && g.key === r.approval.group)) &&
            (!g.agent_id || g.agent_id === r.agent_id),
        );
      store.tx(() => {
        const settled = store.inputs.settle(r.id, "approved", undefined, grant?.scope);
        if (!settled) return;
        settleTaskInput(store, settled);
        delivery.deliver(settled);
      });
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
      const rec = store.tx(() => {
        const input = store.inputs.create({
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
        if (o.stays) awaitTaskInput(store, input);
        return input;
      });
      const show = (r: InputRecord) =>
        o.display.upsert((p) => p.type === "input" && p.input_id === r.id, inputPartOf(r));
      show(rec);
      store.runs.setState(o.run, "input-required");
      store.threads.patch(o.run.thread_id, { state: "input-required" });
      const release = deps.hold(o.run.id);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stop: (() => void) | undefined;
      const expire = () => expireInput(rec.id) ?? (store.inputs.get(rec.id) as InputRecord);
      const current = () => store.inputs.get(rec.id) as InputRecord;
      try {
        const settled = await new Promise<InputRecord>((resolve) => {
          waiting.set(rec.id, resolve);
          timer = setTimeout(() => resolve(o.stays ? current() : expire()), waitMs);
          pauseWait.set(rec.id, () => {
            if (timer) clearTimeout(timer);
          });
          // A shutdown keeps the input open (the answer wakes the agent after the restart); anything else closes it.
          stop = () => resolve(o.signal.reason instanceof Shutdown && !o.approval?.browser ? current() : expire());
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
        pauseWait.delete(rec.id);
        if (!o.signal.aborted)
          store.tx(() => {
            store.runs.setState(o.run, "working");
            store.threads.patch(o.run.thread_id, { state: "working" });
            delivery.consumed(o.run.thread_id, o.run.id);
          });
      }
    },

    /** `onChannel`: the answer came on a channel, which never answers what only the app may (DECISIONS.md#d-144). */
    respond(
      id: string,
      a: { decision?: "approve" | "deny" | undefined; text?: string | undefined; scope?: ApprovalScope | undefined },
      onChannel = false,
      reviewedArtifact?: string,
    ): InputRecord {
      const rec = store.inputs.get(id);
      if (!rec) throw notFound(`input ${id}`);
      if (rec.app_only && onChannel) throw unauthorized(APP_ONLY);
      if (!taskInputIsCurrent(store, rec))
        throw conflict("this task question is no longer current; withdraw it and ask again in the current assignment");
      const draft = publicInput(rec).artifact_draft;
      if (draft && a.decision === "approve" && reviewedArtifact !== draft)
        throw unauthorized("public_artifact_review_required");
      if (rec.state === "pending" && rec.expires_at <= new Date().toISOString()) expireInput(id);
      const cur = store.inputs.get(id) as InputRecord;
      if (cur.state !== "pending") throw conflict(`input ${id} is already ${cur.state}`);
      // A card with no "only this time" (a permission such as the computer's) is approved for its narrowest scope.
      const scope =
        a.scope ??
        (rec.approval_scopes && !rec.approval_scopes.includes("once") ? rec.approval_scopes[0] : "once") ??
        "once";
      if (a.scope && (rec.kind !== "confirm" || a.decision !== "approve"))
        throw badRequest("approval scope requires approving a confirmation");
      if (scope !== "once" && !rec.approval_scopes?.includes(scope))
        throw badRequest("this approval scope is not available for this tool");
      if (rec.approval?.browser && a.decision === "approve") {
        const run = store.runs.get(rec.run_id);
        if (!waiting.has(id) || run?.state !== "input-required")
          throw conflict("This browser approval's turn ended; request a new evaluation and review it again");
      }
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
        if (r && state === "approved" && rec.approval && !rec.approval.browser)
          store.approvals.grant(rec.approval, scope, rec.thread_id, rec.agent_id);
        if (r && state === "denied" && rec.approval) store.approvals.decline(rec.approval, rec.thread_id, rec.agent_id);
        if (r && scope === "always" && rec.folders_write)
          for (const dir of rec.folders ?? [])
            store.approvals.grant(writeFolderApproval(dir), "always", rec.thread_id, rec.agent_id);
        if (r && project && rec.folders) addReadOnly(store, deps.home, project, rec.folders);
        if (!r) throw conflict(`input ${id} was answered already`);
        settleTaskInput(store, r);
        delivery.deliver(r);
        return r;
      });
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
      const settled = store.tx(() => {
        const input = store.inputs.settle(id, "withdrawn");
        if (input) {
          settleTaskInput(store, input);
          finishTaskInput(store, input);
          const task = store.threads.get(input.thread_id)?.task_id;
          if (task) delivery.releaseTask(task);
        }
        return input;
      });
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
        const settled = expireInput(id, true);
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
      delivery.restore();
    },

    releaseTask: delivery.releaseTask,

    /** The owner stops a chat no turn runs in: what it still asked them closes, so it stops waiting; how many. */
    close(threadId: string): number {
      let n = 0;
      for (const r of store.inputs.pending(threadId)) {
        const settled = expireInput(r.id);
        if (!settled) continue;
        settleCard(settled);
        n++;
      }
      for (const id of Object.keys(store.threads.context(threadId).task_inputs ?? {})) {
        const record = store.inputs.get(id);
        if (record) finishTaskInput(store, record);
      }
      return n;
    },

    pending: (thread?: string) => store.inputs.pending(thread).map(publicInput),
  };
}

export type Inputs = ReturnType<typeof createInputs>;
