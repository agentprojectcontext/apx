// Runs (one agent turn each) and their tool steps. A run row is written, with its input, before anything runs:
// the runs table is also the durable queue a restart picks up from.
import type { HarnessId, Run, RunState, RunTrigger } from "@apx/protocol";
import { sql as raw, type Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { RunsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

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
  /** A routine the owner scheduled: its prompt is the owner's own words. */
  | { kind: "routine"; id: string; name: string }
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

const toRun = (r: Selectable<RunsTable>): RunRecord => ({
  id: r.id,
  thread_id: r.thread_id,
  agent_id: r.agent_id,
  state: r.state as RunState,
  trigger: r.trigger as RunTrigger,
  ...opt("parent_run_id", r.parent_run_id),
  depth: Number(r.depth),
  ...opt("deadline_at", r.deadline_at),
  ...(r.harness ? { harness: r.harness as HarnessId } : {}),
  ...opt("model", r.model),
  ...opt("error", r.error),
  started_at: r.started_at,
  ...opt("ended_at", r.ended_at),
  ...(r.usage ? { usage: JSON.parse(r.usage) as NonNullable<Run["usage"]> } : {}),
  tool_calls: Number(r.tool_calls),
  ...opt("activity", r.activity),
  ...(r.input ? { input: JSON.parse(r.input) as RunInput } : {}),
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

const LIVE = ["submitted", "working", "input-required"] as const;

/** Tokens a run spent; a run without usage counts as zero. */
const runTokens = raw<number>`coalesce(json_extract(usage, '$.input'), 0) + coalesce(json_extract(usage, '$.output'), 0)`;

export function runsRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (r: RunRecord) => bus.emit({ type: "run.updated", run: publicRun(r) });
  const repo = {
    get(id: string): RunRecord | undefined {
      const r = one(qb.selectFrom("runs").selectAll().where("id", "=", id));
      return r ? toRun(r) : undefined;
    },
    list(threadId: string, limit = 20): RunRecord[] {
      return all(
        qb.selectFrom("runs").selectAll().where("thread_id", "=", threadId).orderBy("created_at", "desc").limit(limit),
      ).map(toRun);
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
        qb.insertInto("runs").values({
          id,
          thread_id: r.thread_id,
          agent_id: r.agent_id,
          state: "submitted",
          trigger: r.trigger,
          input: JSON.stringify(r.input),
          parent_run_id: r.parent_run_id ?? null,
          depth: r.depth ?? 0,
          deadline_at: r.deadline_at,
          started_at: ts,
          created_at: ts,
        }),
      );
      const created = repo.get(id) as RunRecord;
      emit(created);
      return created;
    },
    /** Oldest admitted run of the thread that has not started. */
    nextQueued(threadId: string): RunRecord | undefined {
      const r = one(
        qb
          .selectFrom("runs")
          .selectAll()
          .where("thread_id", "=", threadId)
          .where("state", "=", "submitted")
          .orderBy("created_at")
          .orderBy(raw`rowid`)
          .limit(1),
      );
      return r ? toRun(r) : undefined;
    },
    queuedThreads(): string[] {
      return all(qb.selectFrom("runs").select("thread_id").distinct().where("state", "=", "submitted")).map(
        (r) => r.thread_id,
      );
    },
    queuedIds(threadId: string): string[] {
      return all(
        qb.selectFrom("runs").select("id").where("thread_id", "=", threadId).where("state", "=", "submitted"),
      ).map((r) => r.id);
    },
    /** Runs a crash or restart left mid-turn. */
    interrupted(): RunRecord[] {
      return all(qb.selectFrom("runs").selectAll().where("state", "in", ["working", "input-required"])).map(toRun);
    },
    children(runId: string): RunRecord[] {
      return all(qb.selectFrom("runs").selectAll().where("parent_run_id", "=", runId)).map(toRun);
    },
    /** Turns agents started on their own (delegations, results waking callers) in these threads since the owner's last. */
    unattended(threadIds: string[]): { runs: number; tokens: number } {
      if (!threadIds.length) return { runs: 0, tokens: 0 };
      const last = one(
        qb
          .selectFrom("runs")
          .select((eb) => eb.fn.max("created_at").as("at"))
          .where("thread_id", "in", threadIds)
          .where("trigger", "=", "user"),
      );
      const r = one(
        qb
          .selectFrom("runs")
          .select((eb) => [eb.fn.countAll<number>().as("n"), raw<number>`coalesce(sum(${runTokens}), 0)`.as("t")])
          .where("thread_id", "in", threadIds)
          .where("trigger", "in", ["a2a", "a2a_result", "system"])
          .where("created_at", ">", String(last?.at ?? "")),
      );
      return { runs: Number(r?.n ?? 0), tokens: Number(r?.t ?? 0) };
    },
    /** Turns and tokens by model since `since` (optionally in one project's threads). */
    usage(
      since: string,
      projectId?: string,
    ): Array<{ model: string; harness: string; runs: number; input: number; output: number }> {
      const rows = all(
        qb
          .selectFrom("runs as r")
          .innerJoin("threads as t", "t.id", "r.thread_id")
          .select((eb) => [
            "r.model as model",
            "r.harness as harness",
            eb.fn.countAll<number>().as("n"),
            raw<number>`coalesce(sum(json_extract(r.usage, '$.input')), 0)`.as("i"),
            raw<number>`coalesce(sum(json_extract(r.usage, '$.output')), 0)`.as("o"),
          ])
          .where("r.model", "is not", null)
          .where("r.started_at", ">=", since)
          .$if(!!projectId, (q) => q.where("t.project_id", "=", projectId as string))
          .groupBy(["r.model", "r.harness"])
          .orderBy("n", "desc"),
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
        qb
          .selectFrom("runs as r")
          .innerJoin("threads as t", "t.id", "r.thread_id")
          .select((eb) => eb.fn.countAll<number>().as("n"))
          .where("t.parent_id", "=", parentThreadId)
          .where("r.state", "in", LIVE),
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
        qb
          .updateTable("runs")
          .set({
            state,
            error: next.error ?? null,
            started_at: next.started_at,
            ended_at: next.ended_at ?? null,
            activity: next.activity ?? null,
          })
          .where("id", "=", cur.id),
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
        qb
          .updateTable("runs")
          .set({
            harness: next.harness ?? null,
            model: next.model ?? null,
            message_id: next.message_id ?? null,
            usage: next.usage ? JSON.stringify(next.usage) : null,
          })
          .where("id", "=", cur.id),
      );
      emit(next);
      return next;
    },

    /** What the run is doing now; `tool` counts one more tool call. Cleared when the run ends. */
    setActivity(runId: string, activity: string | undefined, tool = false): void {
      run(
        qb
          .updateTable("runs")
          .set((eb) => ({ activity: activity ?? null, tool_calls: eb("tool_calls", "+", tool ? 1 : 0) }))
          .where("id", "=", runId),
      );
      const cur = repo.get(runId);
      if (cur) emit(cur);
    },
    /** Running work and the latest finished background work (delegations, wakes, routines; not plain chat turns). */
    jobs(finished: number): { running: RunRecord[]; finished: RunRecord[] } {
      return {
        running: all(
          qb.selectFrom("runs as r").selectAll("r").where("r.state", "in", LIVE).orderBy("r.created_at", "desc"),
        ).map(toRun),
        finished: all(
          qb
            .selectFrom("runs as r")
            .innerJoin("threads as t", "t.id", "r.thread_id")
            .selectAll("r")
            .where("r.state", "in", [...TERMINAL])
            .where((eb) => eb.or([eb("r.trigger", "!=", "user"), eb("t.parent_id", "is not", null)]))
            .orderBy("r.ended_at", "desc")
            .limit(finished),
        ).map(toRun),
      };
    },

    // ── steps ──────────────────────────────────────────────────────────
    /** Written before the tool runs (recovery reads it). Returns the step id. */
    beginStep(
      runId: string,
      s: { call_id: string; tool: string; args: Record<string, unknown>; effect: string },
    ): string {
      const next = one(
        qb
          .selectFrom("steps")
          .select((eb) => eb(eb.fn.coalesce(eb.fn.max("seq"), eb.lit(0)), "+", 1).as("n"))
          .where("run_id", "=", runId),
      );
      const seq = Number(next?.n ?? 1);
      const id = newId("stp");
      run(
        qb.replaceInto("steps").values({
          id,
          run_id: runId,
          seq,
          call_id: s.call_id,
          tool: s.tool,
          args: JSON.stringify(s.args),
          effect: s.effect,
          state: "running",
          started_at: now(),
        }),
      );
      return id;
    },
    /** `result` is the short form shown in recovery notes; `output` the whole text, kept for read_output. */
    endStep(runId: string, callId: string, state: StepState, result: string, output?: string): void {
      run(
        qb
          .updateTable("steps")
          .set({ state, result, output: output ?? null, ended_at: now() })
          .where("run_id", "=", runId)
          .where("call_id", "=", callId),
      );
    },
    /** A step's full output, only from a run of the given thread (an agent reads its own thread's outputs). */
    output(stepId: string, threadId: string): string | undefined {
      const r = one(
        qb
          .selectFrom("steps as s")
          .innerJoin("runs as r", "r.id", "s.run_id")
          .select("s.output")
          .where("s.id", "=", stepId)
          .where("r.thread_id", "=", threadId),
      );
      return r?.output == null ? undefined : r.output;
    },
    steps(runId: string): Step[] {
      return all(qb.selectFrom("steps").selectAll().where("run_id", "=", runId).orderBy("seq")).map((r) => ({
        call_id: r.call_id,
        tool: r.tool,
        args: JSON.parse(r.args) as Record<string, unknown>,
        effect: r.effect,
        state: r.state as StepState,
        result: r.result == null ? undefined : r.result,
      }));
    },
  };
  return repo;
}
