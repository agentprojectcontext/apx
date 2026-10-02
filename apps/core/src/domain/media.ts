// Media APX made (generated images, synthesized speech) or the owner attached (images, files): one row per file. The bytes stay on disk under the home,
// never in the database or in messages; clients fetch them through media.get.
import type { Selectable } from "kysely";
import type { MediaTable } from "../db/schema.ts";
import { newId, now, qb, type Sql } from "./sql.ts";

export type MediaRecord = {
  id: string;
  kind: "image" | "audio" | "file";
  mime: string;
  bytes: number;
  path: string;
  thread_id?: string | undefined;
  service?: string | undefined;
  prompt?: string | undefined;
  created_at: string;
};

const toMedia = (r: Selectable<MediaTable>): MediaRecord => ({
  id: r.id,
  kind: r.kind === "audio" ? "audio" : r.kind === "file" ? "file" : "image",
  mime: r.mime,
  bytes: r.bytes,
  path: r.path,
  ...(r.thread_id ? { thread_id: r.thread_id } : {}),
  ...(r.service ? { service: r.service } : {}),
  ...(r.prompt ? { prompt: r.prompt } : {}),
  created_at: r.created_at,
});

export function mediaRepo({ one, run }: Sql) {
  const repo = {
    get(id: string): MediaRecord | undefined {
      const r = one(qb.selectFrom("media").selectAll().where("id", "=", id));
      return r ? toMedia(r) : undefined;
    },
    add(m: Omit<MediaRecord, "id" | "created_at">): MediaRecord {
      const id = newId("med");
      run(
        qb.insertInto("media").values({
          id,
          kind: m.kind,
          mime: m.mime,
          bytes: m.bytes,
          path: m.path,
          thread_id: m.thread_id ?? null,
          service: m.service ?? null,
          prompt: m.prompt?.slice(0, 2000) ?? null,
          created_at: now(),
        }),
      );
      return repo.get(id) as MediaRecord;
    },
  };
  return repo;
}
