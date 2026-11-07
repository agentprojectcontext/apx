// Display messages and their search projection; model context lives separately.
import type { Author, Message, MessageDelivery, MessageReaction, MessageWaiting, Part } from "@apx/protocol";
import type { Selectable } from "kysely";
import { sql } from "kysely";
import type { Bus } from "../bus.ts";
import type { MessagesTable } from "../db/schema.ts";
import { ftsQuery } from "./memories.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const toMessage = (r: Selectable<MessagesTable>): Message => ({
  id: r.id,
  thread_id: r.thread_id,
  seq: Number(r.seq),
  author: JSON.parse(r.author) as Author,
  parts: JSON.parse(r.parts) as Part[],
  ...opt("run_id", r.run_id),
  ...opt("model", r.model),
  ...(r.model_reported === null ? {} : { model_reported: r.model_reported === 1 }),
  ...(r.delivery ? { delivery: r.delivery as MessageDelivery } : {}),
  ...(r.reactions ? { reactions: JSON.parse(r.reactions) as MessageReaction[] } : {}),
  ...opt("via", r.via),
  ...(r.waiting ? { waiting: JSON.parse(r.waiting) as MessageWaiting } : {}),
  created_at: r.created_at,
});

/** A receipt never moves a message back (a late "delivered" after "read"); a failure only replaces what never left. */
const DELIVERY_RANK: Record<MessageDelivery, number> = { pending: 0, failed: 1, sent: 2, delivered: 3, read: 4 };

/**
 * What a search box typed, as a safe FTS5 query: every word must be there, each also as the start of a longer word
 * ("fact" finds "factura"). Quotes keep operators out.
 */
export function messageQuery(text: string): string | undefined {
  const words = [
    ...new Set(
      text
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ].slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : undefined;
}

/** A piece of a message's text around the first word searched for, for a result row. */
export function snippetOf(text: string, query: string, width = 140): string {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Folding keeps one char per char only after combining marks go; positions are found on a per-char fold.
  const folded = [...text].map((c) => fold(c) || c).join("");
  const words = fold(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  const at = Math.min(...words.map((w) => folded.indexOf(w)).filter((i) => i >= 0), Number.POSITIVE_INFINITY);
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  if (!Number.isFinite(at) || text.length <= width) return flat(text.slice(0, width));
  const start = Math.max(0, at - Math.floor(width / 3));
  const piece = flat([...text].slice(start, start + width).join(""));
  return `${start > 0 ? "…" : ""}${piece}${start + width < [...text].length ? "…" : ""}`;
}

export type MessageHit = { message: Message; snippet: string };
export type DocumentPart = Extract<Part, { type: "file" }> & {
  document: NonNullable<Extract<Part, { type: "file" }>["document"]>;
};

export function messagesRepo({ one, all, run }: Sql, bus: Bus) {
  const repo = {
    /**
     * Messages whose text has every word of `query`, best match first, newest among equals. `exclude` drops those
     * already in a model's view (by id, or by the run that wrote them) before the limit.
     */
    search(
      query: string,
      limit = 30,
      threadIds?: string[],
      exclude: { messages?: string[]; runs?: string[] } = {},
    ): MessageHit[] {
      const match = messageQuery(query);
      if (!match || threadIds?.length === 0) return [];
      const rows = all(
        qb
          .selectFrom("messages_fts")
          .innerJoin("messages_n", "messages_n.n", "messages_fts.rowid")
          .innerJoin("messages", "messages.id", "messages_n.id")
          .selectAll("messages")
          .$if(threadIds !== undefined, (q) => q.where("messages.thread_id", "in", threadIds ?? []))
          .$if(Boolean(exclude.messages?.length), (q) =>
            q.where(
              sql<boolean>`messages.id not in (select value from json_each(${JSON.stringify(exclude.messages)}))`,
            ),
          )
          .$if(Boolean(exclude.runs?.length), (q) =>
            q.where(
              sql<boolean>`coalesce(messages.run_id, '') not in (select value from json_each(${JSON.stringify(exclude.runs)}))`,
            ),
          )
          .where(sql<boolean>`messages_fts MATCH ${match}`)
          .orderBy(sql`bm25(messages_fts)`)
          .orderBy("messages.created_at", "desc")
          .limit(limit),
      );
      return rows.map(toMessage).map((message) => ({
        message,
        snippet: snippetOf(message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" "), query),
      }));
    },
    recall(query: string, threadIds: string[], limit = 20, excludeMessages: string[] = []): Message[] {
      const match = ftsQuery(query, 12);
      if (!match || !threadIds.length) return [];
      return all(
        qb
          .selectFrom("messages_fts")
          .innerJoin("messages_n", "messages_n.n", "messages_fts.rowid")
          .innerJoin("messages", "messages.id", "messages_n.id")
          .selectAll("messages")
          .where(sql<boolean>`messages.thread_id in (select value from json_each(${JSON.stringify(threadIds)}))`)
          .where(sql<string>`json_extract(messages.author, '$.kind')`, "=", "user")
          .where(sql<boolean>`messages.id not in (select value from json_each(${JSON.stringify(excludeMessages)}))`)
          .where(sql<boolean>`messages_fts MATCH ${match}`)
          .orderBy(sql`bm25(messages_fts)`)
          .orderBy("messages.created_at", "desc")
          .limit(limit),
      ).map(toMessage);
    },
    list(threadId: string, limit = 200): Message[] {
      const newest = qb
        .selectFrom("messages")
        .selectAll()
        .where("thread_id", "=", threadId)
        .orderBy("seq", "desc")
        .limit(limit);
      return all(qb.selectFrom(newest.as("m")).selectAll().orderBy("seq")).map(toMessage);
    },
    /** A run's messages in the thread, oldest first: more than one when the owner wrote while it worked. */
    ofRun(threadId: string, runId: string): Message[] {
      return all(
        qb
          .selectFrom("messages")
          .selectAll()
          .where("thread_id", "=", threadId)
          .where("run_id", "=", runId)
          .orderBy("seq"),
      ).map(toMessage);
    },
    /** Notice messages across the full history, independent of the display page size. */
    notices(threadId: string, code: string): Message[] {
      return all(
        qb
          .selectFrom("messages")
          .selectAll()
          .where("thread_id", "=", threadId)
          .where(sql<boolean>`exists (select 1 from json_each(messages.parts) where
            json_extract(value, '$.type') = 'notice' and json_extract(value, '$.code') = ${code})`),
      ).map(toMessage);
    },
    /** The newest part of this type in the thread's messages, wherever it is in their history. */
    latestPart(threadId: string, type: Part["type"]): Part | undefined {
      const r = one(
        qb
          .selectFrom("messages")
          .select("parts")
          .where("thread_id", "=", threadId)
          .where(
            sql<boolean>`exists (select 1 from json_each(messages.parts) where json_extract(value, '$.type') = ${type})`,
          )
          .orderBy("seq", "desc")
          .limit(1),
      );
      return r ? (JSON.parse(r.parts) as Part[]).findLast((p) => p.type === type) : undefined;
    },
    around(threadId: string, seq: number, limit = 20): Message[] {
      const half = Math.floor(limit / 2);
      return all(
        qb
          .selectFrom("messages")
          .selectAll()
          .where("thread_id", "=", threadId)
          .where("seq", ">=", Math.max(1, seq - half))
          .orderBy("seq")
          .limit(limit),
      ).map(toMessage);
    },
    get(id: string): Message | undefined {
      const r = one(qb.selectFrom("messages").selectAll().where("id", "=", id));
      return r ? toMessage(r) : undefined;
    },
    /**
     * The documents (files that open in the side panel) in a project's chats, or in one chat, newest first, each file
     * once. A chat's reach past the messages it loads: a long chat's old documents still open.
     */
    documentsIn(
      scope: { project_id?: string | undefined; thread_id?: string | undefined },
      limit = 300,
    ): Array<{ part: DocumentPart; message: Message }> {
      const { project_id, thread_id } = scope;
      const rows = all(
        qb
          .selectFrom("messages")
          .innerJoin("threads", "threads.id", "messages.thread_id")
          .selectAll("messages")
          .$if(!!thread_id, (q) => q.where("messages.thread_id", "=", thread_id as string))
          .$if(!thread_id && !!project_id, (q) => q.where("threads.project_id", "=", project_id as string))
          .$if(!thread_id && !project_id, (q) => q.where("threads.project_id", "is", null))
          .where("messages.parts", "like", '%"document":{%')
          .orderBy("messages.created_at", "desc")
          .limit(limit),
      ).map(toMessage);
      const seen = new Set<string>();
      return rows.flatMap((message) =>
        message.parts.flatMap((part) => {
          if (part.type !== "file" || !part.document || seen.has(part.media_id)) return [];
          seen.add(part.media_id);
          return [{ part: part as DocumentPart, message }];
        }),
      );
    },
    /** The newest owner message or agent reply content, outside run `notRun`; placeholders and tool activity are not replies. */
    latestBy(threadIds: string[], kind: "user" | "agent", notRun?: string): Message | undefined {
      if (!threadIds.length) return undefined;
      const r = one(
        qb
          .selectFrom("messages")
          .selectAll()
          .where("thread_id", "in", threadIds)
          .where(sql<string>`json_extract(author, '$.kind')`, "=", kind)
          .$if(kind === "agent", (q) =>
            q.where(sql<boolean>`exists (select 1 from json_each(messages.parts) where
              (json_extract(value, '$.type') = 'text' and length(trim(json_extract(value, '$.text'))) > 0)
              or json_extract(value, '$.type') in ('image', 'audio', 'file', 'surface'))`),
          )
          .$if(!!notRun, (q) =>
            q.where((eb) => eb.or([eb("run_id", "is", null), eb("run_id", "!=", notRun as string)])),
          )
          .orderBy("created_at", "desc")
          .limit(1),
      );
      return r ? toMessage(r) : undefined;
    },
    /** Whether the owner ever wrote anything (an install in use, not a new one). */
    anyFromOwner(): boolean {
      return Boolean(
        one(
          qb
            .selectFrom("messages")
            .select("id")
            .where(sql<string>`json_extract(author, '$.kind')`, "=", "user")
            .limit(1),
        ),
      );
    },
    add(m: {
      thread_id: string;
      author: Author;
      parts: Part[];
      run_id?: string;
      model?: string;
      model_reported?: boolean;
      /** The channel it came on. */
      via?: string | undefined;
      /** History brought from elsewhere: its own time, and no live event per message. */
      at?: string;
      quiet?: boolean;
    }): Message {
      const seqRow = one(
        qb
          .selectFrom("messages")
          .select((eb) => eb(eb.fn.coalesce(eb.fn.max("seq"), eb.lit(0)), "+", 1).as("next"))
          .where("thread_id", "=", m.thread_id),
      );
      const message: Message = {
        id: newId("msg"),
        thread_id: m.thread_id,
        seq: Number(seqRow?.next ?? 1),
        author: m.author,
        parts: m.parts,
        ...(m.run_id ? { run_id: m.run_id } : {}),
        ...(m.model ? { model: m.model } : {}),
        ...(m.model_reported === undefined ? {} : { model_reported: m.model_reported }),
        ...(m.via ? { via: m.via } : {}),
        created_at: m.at ?? now(),
      };
      run(
        qb.insertInto("messages").values({
          id: message.id,
          thread_id: message.thread_id,
          seq: message.seq,
          author: JSON.stringify(message.author),
          parts: JSON.stringify(message.parts),
          run_id: message.run_id ?? null,
          model: message.model ?? null,
          model_reported: message.model_reported === undefined ? null : Number(message.model_reported),
          via: message.via ?? null,
          created_at: message.created_at,
        }),
      );
      if (!m.quiet) bus.emit({ type: "message.created", message });
      return message;
    },
    /** Replaces the whole message (model change, recovery). */
    update(message: Message): Message {
      run(
        qb
          .updateTable("messages")
          .set({
            parts: JSON.stringify(message.parts),
            model: message.model ?? null,
            model_reported: message.model_reported === undefined ? null : Number(message.model_reported),
          })
          .where("id", "=", message.id),
      );
      // How far it got and its reactions are the channel's to say: a rewrite of its words keeps them.
      const stored = repo.get(message.id);
      const out = {
        ...message,
        ...(stored?.delivery ? { delivery: stored.delivery } : {}),
        ...(stored?.reactions ? { reactions: stored.reactions } : {}),
        ...(stored?.via ? { via: stored.via } : {}),
        ...(stored?.waiting ? { waiting: stored.waiting } : {}),
      };
      bus.emit({ type: "message.updated", message: out });
      return out;
    },
    /** Takes out these messages of the thread. */
    drop(threadId: string, ids: string[]): void {
      if (!ids.length) return;
      // Through the table, so the search index triggers run.
      run(qb.deleteFrom("messages").where("thread_id", "=", threadId).where("id", "in", ids));
      bus.emit({ type: "message.deleted", thread_id: threadId, message_ids: ids });
    },
    /** Takes out the thread's messages from `seq` on; returns the runs that wrote them. */
    cutFrom(threadId: string, seq: number): string[] {
      const gone = all(
        qb.selectFrom("messages").select(["id", "run_id"]).where("thread_id", "=", threadId).where("seq", ">=", seq),
      );
      if (!gone.length) return [];
      // Through the table, so the search index triggers run.
      run(qb.deleteFrom("messages").where("thread_id", "=", threadId).where("seq", ">=", seq));
      bus.emit({ type: "message.deleted", thread_id: threadId, message_ids: gone.map((m) => m.id) });
      return [...new Set(gone.flatMap((m) => (m.run_id ? [m.run_id] : [])))];
    },
    /** Copies messages into another thread (a fork), in order, with their own times; no live events. */
    copyInto(threadId: string, messages: Message[]): void {
      for (const m of messages)
        repo.add({
          thread_id: threadId,
          author: m.author,
          parts: m.parts,
          ...opt("run_id", m.run_id),
          ...opt("model", m.model),
          ...(m.model_reported === undefined ? {} : { model_reported: m.model_reported }),
          via: m.via,
          at: m.created_at,
          quiet: true,
        });
    },
    /** A message queued to go out on a channel: which one, and that it has not left yet. */
    sentOn(id: string, channel: string): void {
      const was = repo.get(id);
      if (!was || was.via === channel) {
        repo.setDelivery(id, "pending");
        return;
      }
      const delivery = was.delivery ?? "pending";
      run(qb.updateTable("messages").set({ via: channel, delivery }).where("id", "=", id));
      bus.emit({ type: "message.updated", message: { ...was, via: channel, delivery } });
    },
    /** How far a message sent on a channel got; announced when it moves forward. */
    setDelivery(id: string, state: MessageDelivery): void {
      const was = repo.get(id);
      if (!was) return;
      const before = was.delivery ? DELIVERY_RANK[was.delivery] : -1;
      if (DELIVERY_RANK[state] <= before) return;
      run(qb.updateTable("messages").set({ delivery: state }).where("id", "=", id));
      bus.emit({ type: "message.updated", message: { ...was, delivery: state } });
    },
    /** One side's emoji on a channel message (it replaces that side's earlier one; "" takes it off). */
    setReaction(id: string, by: MessageReaction["by"], emoji: string): void {
      const was = repo.get(id);
      if (!was) return;
      const reactions = [...(was.reactions ?? []).filter((r) => r.by !== by), ...(emoji ? [{ emoji, by }] : [])];
      run(
        qb
          .updateTable("messages")
          .set({ reactions: reactions.length ? JSON.stringify(reactions) : null })
          .where("id", "=", id),
      );
      const { reactions: _old, ...rest } = was;
      bus.emit({ type: "message.updated", message: reactions.length ? { ...rest, reactions } : rest });
    },
    /** Whether the owner's words still wait for their agent, and how; undefined once it took them. */
    setWaiting(id: string, waiting: MessageWaiting | undefined): Message | undefined {
      const was = repo.get(id);
      if (!was) return undefined;
      run(
        qb
          .updateTable("messages")
          .set({ waiting: waiting ? JSON.stringify(waiting) : null })
          .where("id", "=", id),
      );
      const { waiting: _old, ...rest } = was;
      const out = waiting ? { ...rest, waiting } : rest;
      bus.emit({ type: "message.updated", message: out });
      return out;
    },
    /** The thread's messages still waiting for their agent, oldest first. */
    waitingIn(threadId?: string): Message[] {
      return all(
        qb
          .selectFrom("messages")
          .selectAll()
          .where("waiting", "is not", null)
          .$if(threadId !== undefined, (q) => q.where("thread_id", "=", threadId as string))
          .orderBy("seq"),
      ).map(toMessage);
    },
    /** Moves a message to the end of its thread: the owner's words in line read where their turn starts. */
    toEnd(id: string): Message | undefined {
      const was = repo.get(id);
      if (!was) return undefined;
      const last = one(
        qb
          .selectFrom("messages")
          .select((eb) => eb.fn.max("seq").as("seq"))
          .where("thread_id", "=", was.thread_id),
      );
      if (Number(last?.seq ?? 0) === was.seq) return was;
      const seq = Number(last?.seq ?? 0) + 1;
      run(qb.updateTable("messages").set({ seq }).where("id", "=", id));
      const out = { ...was, seq };
      bus.emit({ type: "message.updated", message: out });
      return out;
    },
    /** Gives these messages of one thread these places (a permutation of the places they hold). */
    reseat(threadId: string, places: ReadonlyArray<{ id: string; seq: number }>): Message[] {
      // Out of the way first: each seq is unique in its thread.
      for (const p of places)
        run(qb.updateTable("messages").set({ seq: -p.seq }).where("id", "=", p.id).where("thread_id", "=", threadId));
      for (const p of places)
        run(qb.updateTable("messages").set({ seq: p.seq }).where("id", "=", p.id).where("thread_id", "=", threadId));
      const out = places.flatMap((p) => repo.get(p.id) ?? []);
      for (const m of out) bus.emit({ type: "message.updated", message: m });
      return out;
    },
    /** Stores the parts and announces only the one that changed. */
    setPart(message: Message, index: number): void {
      run(
        qb
          .updateTable("messages")
          .set({ parts: JSON.stringify(message.parts) })
          .where("id", "=", message.id),
      );
      const part = message.parts[index];
      if (part) bus.emit({ type: "message.part", thread_id: message.thread_id, message_id: message.id, index, part });
    },
  };
  return repo;
}
