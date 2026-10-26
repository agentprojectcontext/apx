// Terminal jobs: shell commands agents started. The row is written before the process starts; the process's
// output lives in a file next to the database.
import type { Job, RunState } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { JobsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

export type JobRecord = Job & { pid?: number; run_id?: string; proc_start?: string };

const toJob = (r: Selectable<JobsTable>): JobRecord => ({
  id: r.id,
  kind: "terminal",
  title: r.title,
  state: r.state as RunState,
  thread_id: r.thread_id,
  ...opt("agent_id", r.agent_id),
  ...opt("run_id", r.run_id),
  trigger: "system",
  tool_calls: 0,
  cwd: r.cwd,
  ...(r.pid == null ? {} : { pid: Number(r.pid) }),
  ...opt("proc_start", r.proc_start),
  ...(r.exit_code == null ? {} : { exit_code: Number(r.exit_code) }),
  background: Boolean(r.background),
  started_at: r.started_at,
  ...opt("ended_at", r.ended_at),
});

export const publicJob = ({ pid: _p, proc_start: _s, ...rest }: JobRecord): Job => rest;

export function jobsRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (j: JobRecord) => bus.emit({ type: "job.updated", job: publicJob(j) });
  const repo = {
    create(j: {
      thread_id: string;
      run_id?: string | undefined;
      agent_id?: string | undefined;
      title: string;
      cwd: string;
      background: boolean;
    }): JobRecord {
      const id = newId("job");
      run(
        qb.insertInto("jobs").values({
          id,
          kind: "terminal",
          thread_id: j.thread_id,
          run_id: j.run_id ?? null,
          agent_id: j.agent_id ?? null,
          title: j.title,
          cwd: j.cwd,
          state: "working",
          background: j.background ? 1 : 0,
          started_at: now(),
        }),
      );
      const job = repo.get(id) as JobRecord;
      emit(job);
      return job;
    },
    get(id: string): JobRecord | undefined {
      const r = one(qb.selectFrom("jobs").selectAll().where("id", "=", id));
      return r ? toJob(r) : undefined;
    },
    setPid(id: string, pid: number): void {
      run(qb.updateTable("jobs").set({ pid }).where("id", "=", id));
    },
    setProcStart(id: string, start: string): void {
      run(qb.updateTable("jobs").set({ proc_start: start }).where("id", "=", id));
    },
    /** Final state, once: a job that already ended keeps its first ending. */
    finish(
      id: string,
      state: "completed" | "failed" | "canceled",
      exitCode?: number | undefined,
    ): JobRecord | undefined {
      const changes = run(
        qb
          .updateTable("jobs")
          .set({ state, exit_code: exitCode ?? null, ended_at: now() })
          .where("id", "=", id)
          .where("state", "=", "working"),
      );
      const job = repo.get(id);
      if (changes && job) emit(job);
      return changes ? job : undefined;
    },
    running(): JobRecord[] {
      return all(qb.selectFrom("jobs").selectAll().where("state", "=", "working").orderBy("started_at", "desc")).map(
        toJob,
      );
    },
    /** A chat's terminal jobs, newest first. */
    ofThread(threadId: string, limit: number): JobRecord[] {
      return all(
        qb.selectFrom("jobs").selectAll().where("thread_id", "=", threadId).orderBy("started_at", "desc").limit(limit),
      ).map(toJob);
    },
    finished(limit: number): JobRecord[] {
      return all(
        qb.selectFrom("jobs").selectAll().where("state", "!=", "working").orderBy("ended_at", "desc").limit(limit),
      ).map(toJob);
    },
  };
  return repo;
}
