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
  /** SQLite rolls back metadata; clean up the files created by that same attempt as well. */
  const write = <T>(fn: (attach: (task: Task, sources: MediaRecord[], ctx: CallContext) => void) => T): T => {
    const paths: string[] = [];
    const consumed = new Map<string, string>();
    let result: T;
    try {
      result = store.tx(() =>
        fn((task, sources, ctx) => {
          for (const source of sources)
            if (store.taskAttachments.pending(source.id)) consumed.set(source.id, source.path);
          const existing = store.taskAttachments.list(task.id);
          const fresh = sources.filter((s) => !existing.some((e) => e.source_media_id === s.id || e.media_id === s.id));
          if (existing.length + fresh.length > MAX_ATTACHMENTS)
            throw badRequest("a task can keep at most 50 attachments");
          for (const source of fresh) {
            let bytes: Buffer;
            try {
              bytes = readStoredAttachment(source.path);
            } catch {
              throw notFound("attachment file unavailable");
            }
            const m = saveUpload(
              home,
              store,
              {
                bytes,
                mime: source.mime,
                name: source.prompt ?? source.id,
                thread: task.thread_id,
              },
              MAX_BYTES,
            );
            paths.push(m.path);
            store.taskAttachments.add(task.id, m.id, source, ctx.agent?.id ?? "owner");
          }
          if (fresh.length) store.tasks.touched(task.id, ctx.agent?.id ?? "owner", "update");
        }),
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
