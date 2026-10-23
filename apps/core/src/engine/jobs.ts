// Terminal jobs: shell commands agents run, in the foreground of their turn or in the background. Output goes to a
// capped file; a background job that ends wakes the agent that started it; a restart closes what it cut.
import fs from "node:fs";
import path from "node:path";
import type { JobRecord } from "../domain/jobs.ts";
import type { Store } from "../domain/store.ts";
import { commandEnv } from "../harness/env.ts";
import type { Log } from "../log.ts";
import { processStart, spawnCommand, stopTree } from "../processes.ts";
import { pausedNotice } from "./breaker.ts";
import type { AdmitFn } from "./engine.ts";

/** Set on an agent's commands, so the apx CLI knows an agent runs it, not the owner. */
export const AGENT_ENV = "APX_AGENT";

/** A job's output file stops growing here; the rest is dropped with a note. */
const OUTPUT_CAP = 20 * 1024 * 1024;
/** The end of the output a woken agent gets. */
const WAKE_TAIL = 3000;
/** A background command runs at most this long (servers and watchers included); then it is stopped. */
const MAX_BACKGROUND_MS = 6 * 3600_000;

export function createJobs(deps: { store: Store; home: string; log: Log; admit: AdmitFn }) {
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
    const paused = pausedNotice(store, job.thread_id, `"${job.title.slice(0, 80)}"`);
    if (paused) {
      log.warn({ job: job.id, thread: job.thread_id }, "background job ended while agents are paused");
      store.messages.add({
        thread_id: job.thread_id,
        author: { kind: "system" },
        parts: [paused],
      });
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
      reply_to: job.run_id ? store.runs.get(job.run_id)?.input?.reply_to : undefined,
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
      // An agent's command says whose it is: `apx chat` run there refuses to speak as the owner (it asks with delegate).
      const env = { ...commandEnv(), ...(o.agent_id ? { [AGENT_ENV]: o.agent_id } : {}) };
      const child = spawnCommand(o.command, { cwd: o.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      if (child.pid) {
        store.jobs.setPid(job.id, child.pid);
        void processStart(child.pid).then((started) => {
          try {
            if (started) store.jobs.setProcStart(job.id, started);
          } catch {}
        });
      }
      child.stdout?.on("data", write);
      child.stderr?.on("data", write);
      let killed = false;
      let lifetime: ReturnType<typeof setTimeout> | undefined;
      const done = new Promise<JobRecord>((resolve) => {
        let ending = false;
        // `error` and `close` can both fire for one process: it ends (and wakes the agent) once.
        const end = (state: "completed" | "failed" | "canceled", code?: number) => {
          if (ending) return;
          ending = true;
          clearTimeout(lifetime);
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
      const kill = () => {
        killed = true;
        if (child.pid) stopTree(child.pid, { alive: () => child.exitCode === null });
      };
      procs.set(job.id, { kill, done });
      if (o.background) {
        lifetime = setTimeout(() => {
          write(Buffer.from(`\n[stopped by APX after ${MAX_BACKGROUND_MS / 3600_000} h]\n`));
          kill();
        }, MAX_BACKGROUND_MS);
        lifetime.unref();
      }
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
     * Boot: jobs a restart cut are closed. Their processes usually died with the pipe to the old core; one still
     * alive (same pid, same start time) is stopped so nothing keeps running unseen.
     */
    reconcile(): void {
      for (const j of store.jobs.running()) {
        const { pid, proc_start: start } = j;
        if (pid && start) {
          const same = async () => (await processStart(pid)) === start;
          void same().then((yes) => yes && stopTree(pid, { alive: same }));
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
