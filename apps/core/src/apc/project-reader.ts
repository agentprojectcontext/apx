// Reading a project's files off the core's main thread: macOS holds a read of ~/Documents, ~/Desktop or a removable
// drive until someone answers its privacy prompt, and a held synchronous read would stop the whole core.
// See HISTORY.md#project-read-prompt.
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { type ApcAgent, type ApcProject, isApcProject, readAgents, readProject } from "./read.ts";

/** What a project folder holds: its files, nothing to read there, or a folder the system refused to open. */
export type ProjectFiles =
  | { state: "read"; project: ApcProject; agents: ApcAgent[] }
  | { state: "missing" }
  | { state: "denied" };

export type ReadProjectFiles = (root: string) => Promise<ProjectFiles>;

const REFUSED = new Set(["EPERM", "EACCES"]);

/** Reads a project folder, synchronously: on the main thread only where access was already proven. */
export function readProjectFiles(root: string): ProjectFiles {
  const abs = path.resolve(root);
  try {
    if (!fs.statSync(abs).isDirectory()) return { state: "missing" };
    // Listing the folder is what a privacy setting refuses; a stat of the folder itself goes through.
    fs.opendirSync(abs).closeSync();
  } catch (err) {
    return REFUSED.has((err as NodeJS.ErrnoException).code ?? "") ? { state: "denied" } : { state: "missing" };
  }
  if (!isApcProject(abs)) return { state: "missing" };
  return { state: "read", project: readProject(abs), agents: readAgents(abs) };
}

type Lane = { worker: Worker; busy: boolean };

/**
 * Reads in worker threads, one read per thread at a time. A read the system holds keeps its thread; the next read
 * takes another, so one folder waiting on a prompt never holds up the others or the core.
 */
export function createProjectReader(): { read: ReadProjectFiles; close(): void } {
  const idle: Lane[] = [];
  const all = new Set<Lane>();
  let closed = false;

  const lane = (): Lane => {
    const free = idle.pop();
    if (free) return free;
    const worker = new Worker(new URL("./project-reader-worker.ts", import.meta.url));
    // A thread held by a prompt must not keep the process from exiting.
    worker.unref();
    const l = { worker, busy: false };
    all.add(l);
    worker.once("exit", () => {
      all.delete(l);
      const i = idle.indexOf(l);
      if (i >= 0) idle.splice(i, 1);
    });
    return l;
  };

  return {
    read(root) {
      if (closed) return Promise.reject(new Error("reader closed"));
      const l = lane();
      l.busy = true;
      return new Promise<ProjectFiles>((resolve, reject) => {
        const done = () => {
          l.worker.off("message", onMessage);
          l.worker.off("error", onError);
          l.worker.off("exit", onExit);
          l.busy = false;
          // One spare thread is kept for the next read; any other ends.
          if (closed || idle.length) void l.worker.terminate();
          else idle.push(l);
        };
        const onMessage = (files: ProjectFiles) => {
          done();
          resolve(files);
        };
        const onError = (err: Error) => {
          done();
          reject(err);
        };
        const onExit = () => {
          done();
          reject(new Error("project reader stopped"));
        };
        l.worker.on("message", onMessage);
        l.worker.once("error", onError);
        l.worker.once("exit", onExit);
        l.worker.postMessage(root);
      });
    },
    close() {
      closed = true;
      for (const l of all) if (!l.busy) void l.worker.terminate();
      idle.length = 0;
    },
  };
}
