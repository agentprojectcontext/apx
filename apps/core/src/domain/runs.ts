// Runs (one agent turn each) and their tool steps. A run row is written, with its input, before anything runs:
// the runs table is also the durable queue a restart picks up from.
import type { HarnessId, Run, RunState, RunTrigger } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

/** Who a run's input comes from. Stamped by the core, never parsed from text. */
export type Origin =
  | { kind: "user" }
  | { kind: "agent"; id: string; name: string; thread_id: string; run_id: string }
  | { kind: "surface"; id: string; title: string }
  /** A message on a channel (Telegram…): from the owner, or from a contact (then it is a third party's text). */
  | {
      kind: "channel";
      channel: string;
      conversation: string;
      person_id: string;
      name: string;
      role: "owner" | "contact";
    }
  /** The owner answered something the agent asked, after the turn that asked had ended. */
  | { kind: "input_answer"; input_id: string }
  /** A background command the agent started has ended. */
  | { kind: "job"; job_id: string; command: string; state: RunState; exit_code: number | null }
  | {
      kind: "delegation_result";
      agent_id: string;
      name: string;
      thread_id: string;
      run_id: string;
      state: RunState;
    };

export type RunInput = { origin: Origin; text: string };
export type RunRecord = Run & { input?: RunInput; message_id?: string };

export const TERMINAL: ReadonlySet<RunState> = new Set(["completed", "failed", "canceled"]);

const toRun = (r: Row): RunRecord => ({
  id: String(r.id),
  thread_id: String(r.thread_id),
  agent_id: String(r.agent_id),
  state: r.state as RunState,
  trigger: (r.trigger ?? "user") as RunTrigger,
  ...opt("parent_run_id", r.parent_run_id),
  depth: Number(r.depth ?? 0),
  ...opt("deadline_at", r.deadline_at),
  ...(r.harness ? { harness: r.harness as HarnessId } : {}),
  ...opt("model", r.model),
  ...opt("error", r.error),
  started_at: String(r.started_at),
  ...opt("ended_at", r.ended_at),
  ...(r.usage ? { usage: JSON.parse(String(r.usage)) as NonNullable<Run["usage"]> } : {}),
  tool_calls: Number(r.tool_calls ?? 0),
  ...opt("activity", r.activity),
  ...(r.input ? { input: JSON.parse(String(r.input)) as RunInput } : {}),
  ...opt("message_id", r.message_id),
});

/** The shape clients get: input and bookkeeping stay in the core. */
export const publicRun = ({ input: _i, message_id: _m, ...r }: RunRecord): Run => r;

export type StepState = "running" | "ok" | "error" | "unknown" | "skipped";
export type Step = {
  call_id: string;
  tool: string;
  args: Record<string, unknown>;
  effect: string;
  state: StepState;
  result: string | undefined;
};

export function runsRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (r: RunRecord) => bus.emit({ type: "run.updated", run: publicRun(r) });
  const repo = {
    get(id: string): RunRecord | undefined {
      const r = one("SELECT * FROM runs WHERE id = ?", id);
      return r ? toRun(r) : undefined;
    },
    list(threadId: string, limit = 20): RunRecord[] {
      return all("SELECT * FROM runs WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?", threadId, limit).map(toRun);
    },
    create(r: {
      thread_id: string;
      agent_id: string;
      trigger: RunTrigger;
      input: RunInput;
      parent_run_id?: string | undefined;
      depth?: number;
      deadline_at: string;
    }): RunRecord {
      const id = newId("run");
      const ts = now();
      run(
        `INSERT INTO runs (id, thread_id, agent_id, state, trigger, input, parent_run_id, depth, deadline_at, started_at, created_at)
         VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?)`,
        id,
        r.thread_id,
        r.agent_id,
        r.trigger,
        JSON.stringify(r.input),
        r.parent_run_id ?? null,
        r.depth ?? 0,
        r.deadline_at,
        ts,
        ts,
      );
      const created = repo.get(id) as RunRecord;
      emit(created);
      return created;
    },
    /** Oldest admitted run of the thread that has not started. */
    nextQueued(threadId: string): RunRecord | undefined {
      const r = one(
        "SELECT * FROM runs WHERE thread_id = ? AND state = 'submitted' ORDER BY created_at, rowid LIMIT 1",
        threadId,
      );
      return r ? toRun(r) : undefined;
    },
    queuedThreads(): string[] {
      return all("SELECT DISTINCT thread_id FROM runs WHERE state = 'submitted'").map((r) => String(r.thread_id));
    },
    queuedIds(threadId: string): string[] {
      return all("SELECT id FROM runs WHERE thread_id = ? AND state = 'submitted'", threadId).map((r) => String(r.id));
    },
    /** Runs a crash or restart left mid-turn. */
    interrupted(): RunRecord[] {
      return all("SELECT * FROM runs WHERE state IN ('working', 'input-required')").map(toRun);
    },
    children(runId: string): RunRecord[] {
      return all("SELECT * FROM runs WHERE parent_run_id = ?", runId).map(toRun);
    },
    /** Turns agents started on their own (delegations, results waking callers) in these threads since the owner's last. */
    unattended(threadIds: string[]): { runs: number; tokens: number } {
      if (!threadIds.length) return { runs: 0, tokens: 0 };
      const ids = threadIds.map(() => "?").join(", ");
      const last = one(
        `SELECT MAX(created_at) AS at FROM runs WHERE thread_id IN (${ids}) AND trigger = 'user'`,
        ...threadIds,
      );
      const r = one(
        `SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(json_extract(usage, '$.input'), 0) + COALESCE(json_extract(usage, '$.output'), 0)), 0) AS t
         FROM runs WHERE thread_id IN (${ids}) AND trigger IN ('a2a', 'a2a_result', 'system') AND created_at > ?`,
        ...threadIds,
        String(last?.at ?? ""),
      );
      return { runs: Number(r?.n ?? 0), tokens: Number(r?.t ?? 0) };
    },
    /** Turns and tokens by model since `since` (optionally in one project's threads). */
    usage(
      since: string,
      projectId?: string,
    ): Array<{ model: string; harness: string; runs: number; input: number; output: number }> {
      const rows = all(
        `SELECT r.model AS model, r.harness AS harness, COUNT(*) AS n,
           COALESCE(SUM(json_extract(r.usage, '$.input')), 0) AS i, COALESCE(SUM(json_extract(r.usage, '$.output')), 0) AS o
         FROM runs r JOIN threads t ON t.id = r.thread_id
         WHERE r.model IS NOT NULL AND r.started_at >= ? ${projectId ? "AND t.project_id = ?" : ""}
         GROUP BY r.model, r.harness ORDER BY n DESC`,
        since,
        ...(projectId ? [projectId] : []),
      );
      return rows.map((r) => ({
        model: String(r.model),
        harness: String(r.harness ?? "native"),
        runs: Number(r.n),
        input: Number(r.i),
        output: Number(r.o),
      }));
    },
    /** Delegations from this thread still queued or running. */
    activeDelegations(parentThreadId: string): number {
      const r = one(
        "SELECT COUNT(*) AS n FROM runs r JOIN threads t ON t.id = r.thread_id WHERE t.parent_id = ? AND r.state IN ('submitted', 'working', 'input-required')",
        parentThreadId,
      );
      return Number(r?.n ?? 0);
    },
    setState(cur: RunRecord, state: RunState, error?: string): RunRecord {
      const terminal = TERMINAL.has(state);
      const base = repo.get(cur.id) ?? cur;
      const next: RunRecord = {
        ...base,
        // Ended runs are doing nothing.
        ...(terminal ? { activity: undefined } : {}),
        state,
        ...(error ? { error } : {}),
        ...(state === "working" && base.state === "submitted" ? { started_at: now() } : {}),
        ...(terminal ? { ended_at: now() } : {}),
      };
      run(
        "UPDATE runs SET state = ?, error = ?, started_at = ?, ended_at = ?, activity = ? WHERE id = ?",
        state,
        next.error ?? null,
        next.started_at,
        next.ended_at ?? null,
        next.activity ?? null,
        cur.id,
      );
      emit(next);
      return next;
    },
    patch(
      cur: RunRecord,
      p: { harness?: HarnessId; model?: string; message_id?: string; usage?: NonNullable<Run["usage"]> },
    ): RunRecord {
      // From the stored row: activity counters change underneath the turn's own copy.
      const next: RunRecord = { ...(repo.get(cur.id) ?? cur), ...p };
      run(
        "UPDATE runs SET harness = ?, model = ?, message_id = ?, usage = ? WHERE id = ?",
        next.harness ?? null,
        next.model ?? null,
        next.message_id ?? null,
        next.usage ? JSON.stringify(next.usage) : null,
        cur.id,
      );
      emit(next);
      return next;
    },

    /** What the run is doing now; `tool` counts one more tool call. Cleared when the run ends. */
    setActivity(runId: string, activity: string | undefined, tool = false): void {
      run(
        "UPDATE runs SET activity = ?, tool_calls = tool_calls + ? WHERE id = ?",
        activity ?? null,
        tool ? 1 : 0,
        runId,
      );
      const cur = repo.get(runId);
      if (cur) emit(cur);
    },
    /** Running work and the latest finished background work (delegations, wakes, routines; not plain chat turns). */
    jobs(finished: number): { running: RunRecord[]; finished: RunRecord[] } {
      const bg = "(r.trigger != 'user' OR t.parent_id IS NOT NULL)";
      return {
        running: all(
          "SELECT r.* FROM runs r WHERE r.state IN ('submitted', 'working', 'input-required') ORDER BY r.created_at DESC",
        ).map(toRun),
        finished: all(
          `SELECT r.* FROM runs r JOIN threads t ON t.id = r.thread_id WHERE r.state IN ('completed', 'failed', 'canceled') AND ${bg} ORDER BY r.ended_at DESC LIMIT ?`,
          finished,
        ).map(toRun),
      };
    },

    // ── steps ──────────────────────────────────────────────────────────
    /** Written before the tool runs (recovery reads it). Returns the step id. */
    beginStep(
      runId: string,
      s: { call_id: string; tool: string; args: Record<string, unknown>; effect: string },
    ): string {
      const seq = Number(one("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM steps WHERE run_id = ?", runId)?.n ?? 1);
      const id = newId("stp");
      run(
        "INSERT OR REPLACE INTO steps (id, run_id, seq, call_id, tool, args, effect, state, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)",
        id,
        runId,
        seq,
        s.call_id,
        s.tool,
        JSON.stringify(s.args),
        s.effect,
        now(),
      );
      return id;
    },
    /** `result` is the short form shown in recovery notes; `output` the whole text, kept for read_output. */
    endStep(runId: string, callId: string, state: StepState, result: string, output?: string): void {
      run(
        "UPDATE steps SET state = ?, result = ?, output = ?, ended_at = ? WHERE run_id = ? AND call_id = ?",
        state,
        result,
        output ?? null,
        now(),
        runId,
        callId,
      );
    },
    /** A step's full output, only from a run of the given thread (an agent reads its own thread's outputs). */
    output(stepId: string, threadId: string): string | undefined {
      const r = one(
        "SELECT s.output FROM steps s JOIN runs r ON r.id = s.run_id WHERE s.id = ? AND r.thread_id = ?",
        stepId,
        threadId,
      );
      return r?.output == null ? undefined : String(r.output);
    },
    steps(runId: string): Step[] {
      return all("SELECT * FROM steps WHERE run_id = ? ORDER BY seq", runId).map((r) => ({
        call_id: String(r.call_id),
        tool: String(r.tool),
        args: JSON.parse(String(r.args)) as Record<string, unknown>,
        effect: String(r.effect),
        state: r.state as StepState,
        result: r.result == null ? undefined : String(r.result),
      }));
    },
  };
  return repo;
}
