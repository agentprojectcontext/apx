import { createHash } from "node:crypto";
import fs from "node:fs";
import type { Task } from "@apx/protocol";
import type { MediaRecord } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
import { readStoredAttachment } from "../services/attachment-files.ts";
import { saveUpload } from "../services/uploads.ts";
import type { CallContext } from "./context.ts";
import { readableMedia } from "./media-access.ts";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 50;

export function taskAssets(store: Store, home: string) {
  const list = (task: string) =>
    store.taskAttachments.list(task).flatMap((a) => {
      const m = store.media.get(a.media_id);
      return m ? [{ media_id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, name: m.prompt ?? m.id }] : [];
    });
  const prepare = (ids: string[] | undefined, ctx: CallContext) =>
    [...new Set(ids ?? [])].map((id) => {
      const m = readableMedia(store, id, ctx);
      if (m.bytes > MAX_BYTES) throw badRequest("task attachments must be at most 20 MB");
      return m;
    });
  const bytesOf = (source: MediaRecord) => {
    try {
      return readStoredAttachment(source.path);
    } catch {
      throw notFound("attachment file unavailable");
    }
  };
  /** Copies `sources` onto the task (each once) and returns the task's copy of each, in order. */
  const copyIn = (
    task: Task,
    sources: MediaRecord[],
    by: string,
    paths: string[],
    nameOf: (source: MediaRecord) => string = (s) => s.prompt ?? s.id,
  ) => {
    const existing = store.taskAttachments.list(task.id);
    const kept = (s: MediaRecord) => existing.find((e) => e.source_media_id === s.id || e.media_id === s.id);
    const fresh = sources.filter((s) => !kept(s));
    if (existing.length + fresh.length > MAX_ATTACHMENTS) throw badRequest("a task can keep at most 50 attachments");
    const copies = new Map<string, MediaRecord>();
    for (const source of fresh) {
      const m = saveUpload(
        home,
        store,
        { bytes: bytesOf(source), mime: source.mime, name: nameOf(source), thread: task.thread_id },
        MAX_BYTES,
      );
      paths.push(m.path);
      store.taskAttachments.add(task.id, m.id, source, by);
      copies.set(source.id, m);
    }
    if (fresh.length) store.tasks.touched(task.id, by, "update");
    return sources.flatMap((s) => {
      const row = kept(s);
      const copy = copies.get(s.id) ?? (row && store.media.get(row.media_id));
      return copy ? [copy] : [];
    });
  };
  /**
   * The task's copies of files shown on its conversation. A file already on the task (same source or same bytes) is
   * reused, so a retried turn adds nothing; a new file under a name the task already has is named as its next version.
   */
  const shareIn = (task: Task, all: MediaRecord[], by: string, paths: string[]) => {
    const sources = [...new Map(all.map((s) => [s.id, s])).values()];
    const onTask = store.taskAttachments.list(task.id).flatMap((a) => store.media.get(a.media_id) ?? []);
    const hash = (m: MediaRecord) => createHash("sha256").update(bytesOf(m)).digest("hex");
    const reused = new Map<string, MediaRecord>();
    for (const s of sources) {
      const peers = onTask.filter((m) => m.bytes === s.bytes && m.id !== s.id);
      const h = peers.length ? hash(s) : "";
      const same = peers.find((m) => hash(m) === h);
      if (same) reused.set(s.id, same);
    }
    const names = onTask.map((m) => m.prompt ?? m.id);
    const fresh = sources.filter((s) => !reused.has(s.id));
    const copied = copyIn(task, fresh, by, paths, (s) => {
      const name = versioned(s.prompt ?? s.id, names);
      names.push(name);
      return name;
    });
    return sources.flatMap((s) => reused.get(s.id) ?? copied[fresh.indexOf(s)] ?? []);
  };
  /** SQLite rolls back metadata; clean up the files created by that same attempt as well. */
  const write = <T>(
    fn: (
      attach: (task: Task, sources: MediaRecord[], ctx: Pick<CallContext, "agent">) => MediaRecord[],
      share: (task: Task, sources: MediaRecord[], by: string) => MediaRecord[],
    ) => T,
  ): T => {
    const paths: string[] = [];
    const consumed = new Map<string, string>();
    const consume = (sources: MediaRecord[]) => {
      for (const source of sources) if (store.taskAttachments.pending(source.id)) consumed.set(source.id, source.path);
    };
    let result: T;
    try {
      result = store.tx(() =>
        fn(
          (task, sources, ctx) => {
            consume(sources);
            return copyIn(task, sources, ctx.agent?.id ?? "owner", paths);
          },
          (task, sources, by) => {
            consume(sources);
            return shareIn(task, sources, by, paths);
          },
        ),
      );
    } catch (err) {
      for (const path of paths) fs.rmSync(path, { force: true });
      throw err;
    }
    for (const [id, path] of consumed) {
      try {
        fs.rmSync(path, { force: true });
        store.media.remove(id);
      } catch {
        // Keep the pending row so the owner's discard can retry cleanup after a filesystem failure.
      }
    }
    return result;
  };
  const detach = (task: Task, id: string, ctx: CallContext) => {
    if (ctx.actor !== "human" || ctx.agent || ctx.client || ctx.channel)
      throw unauthorized("only the owner removes task attachments");
    if (!store.taskAttachments.list(task.id).some((a) => a.media_id === id)) throw notFound("attachment unavailable");
    const m = store.media.get(id);
    store.tx(() => {
      store.taskAttachments.remove(task.id, id);
      if (m) store.taskAttachments.stage(id);
      store.tasks.touched(task.id, "owner", "update");
    });
    if (m) {
      try {
        fs.rmSync(m.path, { force: true });
        store.media.remove(id);
      } catch {
        // Pending media remains tracked for discard or expiry to retry a failed filesystem removal.
      }
    }
    return { removed: id };
  };
  return { list, prepare, write, detach };
}

/** `name`, or its next version when the task already has a file by that name: "cut.mp4", "cut (v2).mp4". */
export function versioned(name: string, taken: string[]): string {
  const split = (n: string) => {
    const dot = n.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ""];
    return { base: stem.replace(/ \(v\d+\)$/, ""), ext };
  };
  const { base, ext } = split(name);
  const count = taken.filter((n) => {
    const other = split(n);
    return other.base === base && other.ext === ext;
  }).length;
  return count ? `${base} (v${count + 1})${ext}` : name;
}
