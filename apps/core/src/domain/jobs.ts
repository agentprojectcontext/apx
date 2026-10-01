// Terminal jobs: shell commands agents started. The row is written before the process starts; the process's
// output lives in a file next to the database.
import type { Job, RunState } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

export type JobRecord = Job & { pid?: number; run_id?: string; proc_start?: string };

const toJob = (r: Row): JobRecord => ({
  id: String(r.id),
  kind: "terminal",
  title: String(r.title),
  state: r.state as RunState,
  thread_id: String(r.thread_id),
  ...opt("agent_id", r.agent_id),
  ...opt("run_id", r.run_id),
  trigger: "system",
  tool_calls: 0,
  cwd: String(r.cwd),
  ...(r.pid == null ? {} : { pid: Number(r.pid) }),
  ...opt("proc_start", r.proc_start),
  ...(r.exit_code == null ? {} : { exit_code: Number(r.exit_code) }),
  background: Boolean(r.background),
  started_at: String(r.started_at),
  ...opt("ended_at", r.ended_at),
});

export const publicJob = ({ pid: _p, run_id: _r, proc_start: _s, ...rest }: JobRecord): Job => rest;

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
        "INSERT INTO jobs (id, kind, thread_id, run_id, agent_id, title, cwd, state, background, started_at) VALUES (?, 'terminal', ?, ?, ?, ?, ?, 'working', ?, ?)",
        id,
        j.thread_id,
        j.run_id ?? null,
        j.agent_id ?? null,
        j.title,
        j.cwd,
        j.background ? 1 : 0,
        now(),
      );
      const job = repo.get(id) as JobRecord;
      emit(job);
      return job;
    },
    get(id: string): JobRecord | undefined {
      const r = one("SELECT * FROM jobs WHERE id = ?", id);
      return r ? toJob(r) : undefined;
    },
    setPid(id: string, pid: number): void {
      run("UPDATE jobs SET pid = ? WHERE id = ?", pid, id);
    },
    setProcStart(id: string, start: string): void {
      run("UPDATE jobs SET proc_start = ? WHERE id = ?", start, id);
    },
    /** Final state, once: a job that already ended keeps its first ending. */
    finish(
      id: string,
      state: "completed" | "failed" | "canceled",
      exitCode?: number | undefined,
    ): JobRecord | undefined {
      const r = run(
        "UPDATE jobs SET state = ?, exit_code = ?, ended_at = ? WHERE id = ? AND state = 'working'",
        state,
        exitCode ?? null,
        now(),
        id,
      );
      const job = repo.get(id);
      if (Number(r.changes) && job) emit(job);
      return Number(r.changes) ? job : undefined;
    },
    running(): JobRecord[] {
      return all("SELECT * FROM jobs WHERE state = 'working' ORDER BY started_at DESC").map(toJob);
    },
    finished(limit: number): JobRecord[] {
      return all("SELECT * FROM jobs WHERE state != 'working' ORDER BY ended_at DESC LIMIT ?", limit).map(toJob);
    },
  };
  return repo;
}
