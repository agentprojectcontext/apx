// Workflows an agent started and each of their agent calls (DECISIONS.md#d-272). The plan is kept as the agent wrote
// it; a step's output is what later stages and a resume read.
import { newId, now, qb, type Sql } from "./sql.ts";
import type { StepState, WorkflowPlan } from "./workflow-plan.ts";

export type WorkflowState = "running" | "done" | "failed" | "stopped";

export type WorkflowRecord = {
  id: string;
  /** The chat it was asked from, and the agent and turn that asked (the turn whose answer shows its card). */
  thread_id: string;
  agent_id: string;
  run_id: string;
  name: string;
  plan: WorkflowPlan;
  state: WorkflowState;
  reason: string | undefined;
  result: string | undefined;
  deadline_at: string;
  created_at: string;
  updated_at: string;
};

export type WorkflowStep = {
  key: string;
  state: StepState;
  /** The session its delegation opened. */
  thread_id: string | undefined;
  output: string | undefined;
  error: string | undefined;
  /** Answers given so far (a JSON answer that did not fit is asked once more). */
  tries: number;
  started_at: string | undefined;
  ended_at: string | undefined;
};

type Row = {
  id: string;
  thread_id: string;
  agent_id: string;
  run_id: string;
  name: string;
  plan: string;
  state: string;
  reason: string | null;
  result: string | null;
  deadline_at: string;
  created_at: string;
  updated_at: string;
};

type StepRow = {
  key: string;
  state: string;
  thread_id: string | null;
  output: string | null;
  error: string | null;
  tries: number;
  started_at: string | null;
  ended_at: string | null;
};

const toRecord = (r: Row): WorkflowRecord => ({
  id: r.id,
  thread_id: r.thread_id,
  agent_id: r.agent_id,
  run_id: r.run_id,
  name: r.name,
  plan: JSON.parse(r.plan) as WorkflowPlan,
  state: r.state as WorkflowState,
  reason: r.reason ?? undefined,
  result: r.result ?? undefined,
  deadline_at: r.deadline_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const toStep = (r: StepRow): WorkflowStep => ({
  key: r.key,
  state: r.state as StepState,
  thread_id: r.thread_id ?? undefined,
  output: r.output ?? undefined,
  error: r.error ?? undefined,
  tries: r.tries,
  started_at: r.started_at ?? undefined,
  ended_at: r.ended_at ?? undefined,
});

const STEP_COLUMNS = ["key", "state", "thread_id", "output", "error", "tries", "started_at", "ended_at"] as const;

export function workflowsRepo({ one, all, run, tx }: Sql) {
  const repo = {
    create(w: {
      thread_id: string;
      agent_id: string;
      run_id: string;
      plan: WorkflowPlan;
      deadline_at: string;
      keys: string[];
    }): WorkflowRecord {
      const id = newId("wf");
      const at = now();
      tx(() => {
        run(
          qb.insertInto("workflows").values({
            id,
            thread_id: w.thread_id,
            agent_id: w.agent_id,
            run_id: w.run_id,
            name: w.plan.name,
            plan: JSON.stringify(w.plan),
            state: "running",
            deadline_at: w.deadline_at,
            created_at: at,
            updated_at: at,
          }),
        );
        for (const key of w.keys)
          run(qb.insertInto("workflow_steps").values({ workflow_id: id, key, state: "pending" }));
      });
      return repo.get(id) as WorkflowRecord;
    },
    get(id: string): WorkflowRecord | undefined {
      const r = one(qb.selectFrom("workflows").selectAll().where("id", "=", id));
      return r ? toRecord(r) : undefined;
    },
    running(): WorkflowRecord[] {
      return all(qb.selectFrom("workflows").selectAll().where("state", "=", "running").orderBy("created_at")).map(
        toRecord,
      );
    },
    ofThread(threadId: string): WorkflowRecord[] {
      return all(
        qb
          .selectFrom("workflows")
          .selectAll()
          .where("thread_id", "=", threadId)
          .orderBy("created_at", "desc")
          .limit(20),
      ).map(toRecord);
    },
    steps(id: string): WorkflowStep[] {
      return all(qb.selectFrom("workflow_steps").select(STEP_COLUMNS).where("workflow_id", "=", id)).map(toStep);
    },
    step(id: string, key: string): WorkflowStep | undefined {
      const r = one(
        qb.selectFrom("workflow_steps").select(STEP_COLUMNS).where("workflow_id", "=", id).where("key", "=", key),
      );
      return r ? toStep(r) : undefined;
    },
    setStep(
      id: string,
      key: string,
      p: Partial<Pick<WorkflowStep, "state" | "thread_id" | "output" | "error" | "tries" | "started_at" | "ended_at">>,
    ): void {
      const set = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? null]));
      if (!Object.keys(set).length) return;
      run(qb.updateTable("workflow_steps").set(set).where("workflow_id", "=", id).where("key", "=", key));
      run(qb.updateTable("workflows").set({ updated_at: now() }).where("id", "=", id));
    },
    set(
      id: string,
      p: Partial<Pick<WorkflowRecord, "state" | "reason" | "result" | "deadline_at" | "run_id">>,
    ): WorkflowRecord | undefined {
      const set = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? null]));
      run(
        qb
          .updateTable("workflows")
          .set({ ...set, updated_at: now() })
          .where("id", "=", id),
      );
      return repo.get(id);
    },
  };
  return repo;
}
