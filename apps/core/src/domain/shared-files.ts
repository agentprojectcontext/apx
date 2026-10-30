// Files shared in chats: every file a message shows, with its chat and project, newest first. message_media (kept by
// triggers on messages) says which message shows which file.
import type { Author, SharedFile, SharedKind } from "@apx/protocol";
import { sql as raw } from "kysely";
import { qb, type Sql } from "./sql.ts";

export type SharedQuery = { kind?: SharedKind; project?: string; base?: boolean; offset: number; limit: number };

const KINDS: readonly SharedKind[] = ["image", "video", "audio", "document"];

const kindOf = raw<SharedKind>`case
  when md.mime like 'image/%' then 'image'
  when md.mime like 'video/%' then 'video'
  when md.mime like 'audio/%' then 'audio'
  else 'document' end`;

function base({ project, base }: Pick<SharedQuery, "project" | "base">) {
  let q = qb
    .selectFrom("message_media as mm")
    .innerJoin("messages as m", "m.id", "mm.message_id")
    .innerJoin("media as md", "md.id", "mm.media_id")
    .innerJoin("threads as t", "t.id", "m.thread_id");
  if (project) q = q.where("t.project_id", "=", project);
  else if (base) q = q.where("t.project_id", "is", null);
  return q;
}

export function sharedFilesRepo({ all }: Sql) {
  return {
    list(query: SharedQuery): { items: SharedFile[]; more: boolean; counts: Record<SharedKind, number> } {
      let q = base(query);
      if (query.kind) q = q.where(kindOf, "=", query.kind);
      const rows = all(
        q
          .select([
            "mm.media_id",
            "mm.name",
            "md.mime",
            "md.bytes",
            "md.prompt",
            "m.id as message_id",
            "m.thread_id",
            "m.author",
            "m.created_at",
            "t.title",
            "t.custom_title",
            "t.project_id",
          ])
          .select(kindOf.as("kind"))
          .orderBy("m.created_at", "desc")
          .orderBy("m.id", "desc")
          .orderBy("mm.media_id")
          .limit(query.limit + 1)
          .offset(query.offset),
      );
      const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<SharedKind, number>;
      for (const c of all(
        base(query)
          .select(kindOf.as("kind"))
          .select((e) => e.fn.countAll<number>().as("n"))
          .groupBy(kindOf),
      ))
        counts[c.kind] = c.n;
      return {
        items: rows.slice(0, query.limit).map((r) => ({
          media_id: r.media_id,
          kind: r.kind,
          mime: r.mime,
          name: r.name || r.prompt || "",
          bytes: r.bytes,
          thread_id: r.thread_id,
          thread_title: r.custom_title || r.title,
          ...(r.project_id ? { project_id: r.project_id } : {}),
          message_id: r.message_id,
          author: JSON.parse(r.author) as Author,
          created_at: r.created_at,
        })),
        more: rows.length > query.limit,
        counts,
      };
    },
  };
}
