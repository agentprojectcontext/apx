// What agents wait on from the owner. A row is written before the agent starts waiting, so a restart never loses
// the question; answering is a compare-and-set on `pending`, so two answers cannot both win.
import type { InputKind, InputState, PendingInput } from "@apx/protocol";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

export type InputRecord = PendingInput & {
  call_id: string;
  message_id?: string;
  args?: Record<string, unknown>;
};

const toInput = (r: Row): InputRecord => ({
  id: String(r.id),
  run_id: String(r.run_id),
  thread_id: String(r.thread_id),
  agent_id: String(r.agent_id),
  call_id: String(r.call_id),
  ...opt("message_id", r.message_id),
  kind: r.kind as InputKind,
  prompt: String(r.prompt),
  ...opt("tool", r.tool),
  ...(r.args ? { args: JSON.parse(String(r.args)) as Record<string, unknown> } : {}),
  ...opt("detail", r.detail),
  ...(r.options ? { options: JSON.parse(String(r.options)) as string[] } : {}),
  state: r.state as InputState,
  ...opt("answer", r.answer),
  created_at: String(r.created_at),
  expires_at: String(r.expires_at),
  ...opt("answered_at", r.answered_at),
});

export const publicInput = ({ call_id: _c, message_id: _m, args: _a, ...rest }: InputRecord): PendingInput => rest;

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
      options?: string[] | undefined;
      waitMs: number;
    }): InputRecord {
      const id = newId("inp");
      run(
        `INSERT INTO pending_inputs (id, run_id, thread_id, agent_id, message_id, call_id, kind, prompt, tool, args, detail, options, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        id,
        i.run_id,
        i.thread_id,
        i.agent_id,
        i.message_id ?? null,
        i.call_id,
        i.kind,
        i.prompt,
        i.tool ?? null,
        i.args ? JSON.stringify(i.args) : null,
        i.detail ?? null,
        i.options?.length ? JSON.stringify(i.options) : null,
        now(),
        new Date(Date.now() + i.waitMs).toISOString(),
      );
      return repo.get(id) as InputRecord;
    },
    get(id: string): InputRecord | undefined {
      const r = one("SELECT * FROM pending_inputs WHERE id = ?", id);
      return r ? toInput(r) : undefined;
    },
    /** Still answerable: pending and not past its deadline. */
    pending(threadId?: string): InputRecord[] {
      const at = now();
      return (
        threadId
          ? all(
              "SELECT * FROM pending_inputs WHERE state = 'pending' AND expires_at > ? AND thread_id = ? ORDER BY created_at",
              at,
              threadId,
            )
          : all("SELECT * FROM pending_inputs WHERE state = 'pending' AND expires_at > ? ORDER BY created_at", at)
      ).map(toInput);
    },
    /** Moves a pending input to its final state; undefined when it was no longer pending (someone else won). */
    settle(id: string, state: Exclude<InputState, "pending">, answer?: string): InputRecord | undefined {
      const r = run(
        "UPDATE pending_inputs SET state = ?, answer = ?, answered_at = ? WHERE id = ? AND state = 'pending'",
        state,
        answer ?? null,
        now(),
        id,
      );
      return Number(r.changes) ? repo.get(id) : undefined;
    },
    /** Pending inputs past their deadline. */
    overdue(at = now()): InputRecord[] {
      return all("SELECT * FROM pending_inputs WHERE state = 'pending' AND expires_at <= ?", at).map(toInput);
    },
  };
  return repo;
}
