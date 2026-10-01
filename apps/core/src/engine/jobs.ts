// Terminal jobs: shell commands agents run, in the foreground of their turn or in the background. Output goes to a
// capped file; a background job that ends wakes the agent that started it; a restart closes what it cut.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { JobRecord } from "../domain/jobs.ts";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { childEnv } from "../harness/env.ts";
import type { Log } from "../log.ts";
import { tripped } from "./breaker.ts";

/** A job's output file stops growing here; the rest is dropped with a note. */
const OUTPUT_CAP = 20 * 1024 * 1024;
/** The end of the output a woken agent gets. */
const WAKE_TAIL = 3000;

export type JobAdmit = (a: {
  thread_id: string;
  agent_id: string;
  trigger: "system";
  origin: Origin;
  text: string;
}) => RunRecord;

export function createJobs(deps: { store: Store; home: string; log: Log; admit: JobAdmit }) {
  const { store, log } = deps;
  const dir = path.join(deps.home, "jobs");
  const procs = new Map<string, { kill(): void; done: Promise<JobRecord> }>();
  const fileOf = (id: string) => path.join(dir, `${id}.log`);

  function read(id: string, offset?: number, max = 8000): { output: string; size: number; offset: number } {
    let size = 0;
    try {
      size = fs.statSync(fileOf(id)).size;
    } catch {
      return { output: "", size: 0, offset: 0 };
    }
    const from = offset === undefined ? Math.max(0, size - max) : Math.min(offset, size);
    const len = Math.min(max, size - from);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(fileOf(id), "r");
    try {
      fs.readSync(fd, buf, 0, len, from);
    } finally {
      fs.closeSync(fd);
    }
    return { output: buf.toString("utf8"), size, offset: from };
  }

  /** A background job ended: the agent that started it gets the end of the output in a new turn. */
  function wake(job: JobRecord): void {
    if (!job.background || !job.agent_id || job.state === "canceled") return;
    const paused = tripped(store, job.thread_id);
    if (paused) {
      log.warn({ job: job.id, thread: job.thread_id }, `background job ended while agents are paused: ${paused}`);
      return;
    }
    deps.admit({
      thread_id: job.thread_id,
      agent_id: job.agent_id,
      trigger: "system",
      origin: {
        kind: "job",
        job_id: job.id,
        command: job.title,
        state: job.state,
        exit_code: job.exit_code ?? null,
      },
      text: read(job.id, undefined, WAKE_TAIL).output || "(no output)",
    });
  }

  return {
    /** Starts the command; resolves with the job as soon as it runs (`done` resolves when it ends). */
    start(o: {
      command: string;
      cwd: string;
      thread_id: string;
      run_id?: string | undefined;
      agent_id?: string | undefined;
      background: boolean;
    }): { job: JobRecord; done: Promise<JobRecord> } {
      fs.mkdirSync(dir, { recursive: true });
      const job = store.jobs.create({
        thread_id: o.thread_id,
        run_id: o.run_id,
        agent_id: o.agent_id,
        title: o.command,
        cwd: o.cwd,
        background: o.background,
      });
      const out = fs.createWriteStream(fileOf(job.id), { flags: "a" });
      let written = 0;
      const write = (chunk: Buffer) => {
        if (written >= OUTPUT_CAP) return;
        written += chunk.length;
        out.write(written > OUTPUT_CAP ? Buffer.concat([chunk, Buffer.from("\n[output cut by APX]\n")]) : chunk);
      };
      // Its own process group, so stopping it also stops what it spawned.
      const child = spawn("/bin/sh", ["-c", o.command], {
        cwd: o.cwd,
        env: childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      if (child.pid) store.jobs.setPid(job.id, child.pid);
      child.stdout.on("data", write);
      child.stderr.on("data", write);
      let killed = false;
      const done = new Promise<JobRecord>((resolve) => {
        const end = (state: "completed" | "failed" | "canceled", code?: number) => {
          out.end(() => {
            const final = store.jobs.finish(job.id, state, code) ?? (store.jobs.get(job.id) as JobRecord);
            procs.delete(job.id);
            wake(final);
            resolve(final);
          });
        };
        child.on("error", (err) => {
          write(Buffer.from(`\n[could not start: ${err.message}]\n`));
          end("failed");
        });
        child.on("close", (code) => end(killed ? "canceled" : code === 0 ? "completed" : "failed", code ?? undefined));
      });
      procs.set(job.id, {
        kill: () => {
          killed = true;
          try {
            if (child.pid) process.kill(-child.pid, "SIGTERM");
          } catch {}
          // Whatever ignores SIGTERM is stopped for good a moment later.
          setTimeout(() => {
            try {
              if (child.pid && child.exitCode === null) process.kill(-child.pid, "SIGKILL");
            } catch {}
          }, 3000).unref();
        },
        done,
      });
      return { job: store.jobs.get(job.id) as JobRecord, done };
    },

    cancel(id: string): boolean {
      const p = procs.get(id);
      if (!p) return false;
      p.kill();
      return true;
    },

    read,

    /**
     * Boot: jobs a restart cut are closed. Their processes died with the pipe to the old core; one still alive
     * (same pid, same command) is stopped so nothing keeps running unseen.
     */
    reconcile(): void {
      for (const j of store.jobs.running()) {
        if (j.pid) {
          let cmd = "";
          try {
            cmd = execFileSync("ps", ["-p", String(j.pid), "-o", "command="], { encoding: "utf8" }).trim();
          } catch {}
          if (cmd.endsWith(j.title.slice(0, 200)))
            try {
              process.kill(-j.pid, "SIGTERM");
            } catch {}
        }
        fs.appendFileSync(fileOf(j.id), "\n[stopped by a restart of APX]\n");
        store.jobs.finish(j.id, "failed");
      }
    },

    /** Shutdown: every command still running is stopped. */
    stopAll(): Promise<unknown> {
      const waits = [...procs.values()].map((p) => {
        p.kill();
        return p.done;
      });
      return Promise.allSettled(waits);
    },
  };
}

export type Jobs = ReturnType<typeof createJobs>;
