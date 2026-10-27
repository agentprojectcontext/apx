import { qb, type Sql } from "./sql.ts";

export function taskAttachmentsRepo({ all, one, run }: Sql) {
  return {
    hasMedia(id: string) {
      return !!one(qb.selectFrom("task_attachments").select("media_id").where("media_id", "=", id));
    },
    stage(id: string) {
      run(qb.insertInto("task_uploads").values({ media_id: id }));
    },
    expired(at: string) {
      return all(
        qb
          .selectFrom("task_uploads")
          .innerJoin("media", "media.id", "task_uploads.media_id")
          .select(["media.id", "media.path"])
          .where("media.created_at", "<", at),
      );
    },
    pending(id: string) {
      return !!one(qb.selectFrom("task_uploads").selectAll().where("media_id", "=", id));
    },
    list(task: string) {
      return all(qb.selectFrom("task_attachments").selectAll().where("task_id", "=", task));
    },
    add(task: string, media: string, source: { id: string; thread_id?: string }, by: string) {
      run(
        qb.insertInto("task_attachments").values({
          task_id: task,
          media_id: media,
          source_media_id: source.id,
          source_thread_id: source.thread_id ?? null,
          created_by: by,
        }),
      );
    },
    remove(task: string, media: string) {
      run(qb.deleteFrom("task_attachments").where("task_id", "=", task).where("media_id", "=", media));
    },
  };
}
