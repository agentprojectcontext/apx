// What agents wait on from the owner. A row is written before the agent starts waiting, so a restart never loses
// the question; answering is a compare-and-set on `pending`, so two answers cannot both win.
import {
  ApprovalScope,
  type DeletionCard,
  type FileChange,
  type InputKind,
  type InputState,
  type PendingInput,
} from "@apx/protocol";
import type { Selectable } from "kysely";
import type { PendingInputsTable } from "../db/schema.ts";
import { type ApprovalTarget, approvalScopes } from "./approvals.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

export type InputRecord = PendingInput & {
  approval?: ApprovalTarget;
  call_id: string;
  message_id?: string;
  args?: Record<string, unknown>;
  /** A folder card for changing files outside the agent's project, not for reading them. */
  folders_write?: true;
  /** Answered only in the app (panel, desktop, paired phone), never on a channel (DECISIONS.md#d-144). */
  app_only?: true;
};

/**
 * What a turn gets back from asking. `held`: the owner answered, but another of the task's waits keeps the answer, so
 * to this turn it reads as unanswered (`pending`) and the answer reaches the agent in a new turn.
 */
export type Asked = InputRecord & { held?: true };

/** What the agent learns when its answer is held: it ends the turn, and may clear its own wait if that is settled. */
export const HELD_ANSWER =
  "not run yet: the owner answered, but this task still waits on them for something else (another open card, or a wait set with task_update awaits_owner), so their answer reaches you in a new turn once nothing else holds it. If you set that wait yourself and it is settled, clear it with task_update awaits_owner:false; otherwise tell the owner briefly what still waits on them. End this turn now.";

const toInput = (r: Selectable<PendingInputsTable>): InputRecord => ({
  id: r.id,
  run_id: r.run_id,
  thread_id: r.thread_id,
  agent_id: r.agent_id,
  call_id: r.call_id,
  ...(r.approval
    ? {
        approval: JSON.parse(r.approval) as ApprovalTarget,
        approval_scopes: approvalScopes(JSON.parse(r.approval) as ApprovalTarget),
      }
    : {}),
  ...(r.folders ? foldersOf(r.folders) : {}),
  ...(r.approval_scope ? { approval_scope: ApprovalScope.parse(r.approval_scope) } : {}),
  ...opt("message_id", r.message_id),
  kind: r.kind as InputKind,
  prompt: r.prompt,
  ...opt("tool", r.tool),
  ...(r.args ? { args: JSON.parse(r.args) as Record<string, unknown> } : {}),
  ...opt("detail", r.detail),
  ...(r.change ? { change: JSON.parse(r.change) as FileChange } : {}),
  ...(r.deletion ? { deletion: JSON.parse(r.deletion) as DeletionCard } : {}),
  ...(r.options ? { options: JSON.parse(r.options) as string[] } : {}),
  ...(r.multi ? { multi: true } : {}),
  ...(r.app_only ? { app_only: true as const } : {}),
  state: r.state as InputState,
  ...opt("answer", r.answer),
  created_at: r.created_at,
  expires_at: r.expires_at,
  ...opt("answered_at", r.answered_at),
});

/**
 * The folders a folder card offers, and its answers: once; to read, for the project when they may be kept there; to
 * change, always for this agent.
 */
function foldersOf(v: string): Pick<InputRecord, "folders" | "approval_scopes" | "folders_write"> {
  const f = JSON.parse(v) as { dirs: string[]; keep: boolean; write?: boolean };
  return {
    folders: f.dirs,
    approval_scopes: f.write ? ["once", "always"] : f.keep ? ["once", "project"] : ["once"],
    ...(f.write ? { folders_write: true as const } : {}),
  };
}

export const publicInput = ({
  call_id: _c,
  message_id: _m,
  args: _a,
  approval: _p,
  folders_write: _w,
  app_only: _o,
  artifact_draft: _draft,
  ...rest
}: InputRecord): PendingInput => {
  const params = _a?.params;
  const draft = params && typeof params === "object" && "draft" in params ? params.draft : undefined;
  const artifact =
    rest.tool === "apx_settings" &&
    _a?.method === "surfaces.public_commit" &&
    typeof draft === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft);
  return { ...rest, ...(artifact ? { artifact_draft: draft } : {}) };
};

export function inputsRepo({ one, all, run }: Sql) {
  const repo = {
    create(i: {
      run_id: string;
      thread_id: string;
      agent_id: string;
      message_id?: string | undefined;
      call_id: string;
      kind: InputKind;
      prompt: string;
      tool?: string | undefined;
      args?: Record<string, unknown> | undefined;
      detail?: string | undefined;
      change?: FileChange | undefined;
      deletion?: DeletionCard | undefined;
      options?: string[] | undefined;
      multi?: boolean | undefined;
      waitMs: number;
      approval?: ApprovalTarget | undefined;
      folders?: { dirs: string[]; keep: boolean; write?: boolean } | undefined;
      app_only?: boolean | undefined;
    }): InputRecord {
      const id = newId("inp");
      run(
        qb.insertInto("pending_inputs").values({
          id,
          run_id: i.run_id,
          thread_id: i.thread_id,
          agent_id: i.agent_id,
          message_id: i.message_id ?? null,
          call_id: i.call_id,
          kind: i.kind,
          approval: i.approval ? JSON.stringify(i.approval) : null,
          approval_scope: null,
          prompt: i.prompt,
          tool: i.tool ?? null,
          args: i.args ? JSON.stringify(i.args) : null,
          detail: i.detail ?? null,
          change: i.change ? JSON.stringify(i.change) : null,
          deletion: i.deletion ? JSON.stringify(i.deletion) : null,
          options: i.options?.length ? JSON.stringify(i.options) : null,
          multi: i.multi && i.options?.length ? 1 : null,
          folders: i.folders ? JSON.stringify(i.folders) : null,
          app_only: i.app_only ? 1 : null,
          state: "pending",
          created_at: now(),
          expires_at: new Date(Date.now() + i.waitMs).toISOString(),
        }),
      );
      return repo.get(id) as InputRecord;
    },
    get(id: string): InputRecord | undefined {
      const r = one(qb.selectFrom("pending_inputs").selectAll().where("id", "=", id));
      return r ? toInput(r) : undefined;
    },
    /** Still answerable: pending and not past its deadline. */
    pending(threadId?: string): InputRecord[] {
      let q = qb
        .selectFrom("pending_inputs")
        .selectAll()
        .where("state", "=", "pending")
        .where("expires_at", ">", now());
      if (threadId) q = q.where("thread_id", "=", threadId);
      return all(q.orderBy("created_at")).map(toInput);
    },
    /** Moves a pending input to its final state; undefined when it was no longer pending (someone else won). */
    settle(
      id: string,
      state: Exclude<InputState, "pending">,
      answer?: string,
      scope?: ApprovalScope,
    ): InputRecord | undefined {
      const changes = run(
        qb
          .updateTable("pending_inputs")
          .set({ state, answer: answer ?? null, answered_at: now(), approval_scope: scope ?? null })
          .where("id", "=", id)
          .where("state", "=", "pending"),
      );
      return changes ? repo.get(id) : undefined;
    },
    /** Pending inputs past their deadline. */
    overdue(at = now()): InputRecord[] {
      return all(
        qb.selectFrom("pending_inputs").selectAll().where("state", "=", "pending").where("expires_at", "<=", at),
      ).map(toInput);
    },
  };
  return repo;
}
