// Threads, what was said in them (messages, for people) and what the model saw (model_log, for the model).
// Two projections of one conversation: the UI never reads the model log and the model never reads display parts.
import type { Author, Message, Part, Thread } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { MessagesTable, ThreadsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const toThread = (r: Selectable<ThreadsTable>): Thread => ({
  id: r.id,
  kind: r.kind as Thread["kind"],
  title: r.title,
  agent_ids: JSON.parse(r.agent_ids) as string[],
  ...opt("project_id", r.project_id),
  ...opt("parent_id", r.parent_id),
  ...opt("session", r.session),
  ...opt("cwd", r.cwd),
  ...(r.write_policy ? { write: r.write_policy as NonNullable<Thread["write"]> } : {}),
  ...(r.channel
    ? {
        channel: {
          id: r.channel,
          conversation: String(r.conversation),
          ...opt("person_id", r.person_id),
        },
      }
    : {}),
  state: r.state as Thread["state"],
  preview: r.preview,
  unread: Number(r.unread),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const toMessage = (r: Selectable<MessagesTable>): Message => ({
  id: r.id,
  thread_id: r.thread_id,
  seq: Number(r.seq),
  author: JSON.parse(r.author) as Author,
  parts: JSON.parse(r.parts) as Part[],
  ...opt("run_id", r.run_id),
  ...opt("model", r.model),
  created_at: r.created_at,
});

/** A summary that stands for the model log up to `upto`: a new epoch of the thread's context (engine/upkeep.ts). */
export type Epoch = { upto: number; summary: string; untrusted: boolean; runs: number; at: string };

/** What the context builder, the upkeep and the channels keep per thread. */
export type ThreadContext = {
  /** Answers go back to this channel conversation while the last words came from it. */
  reply_to?: { channel: string; conversation: string };
  compaction?: Epoch;
  /** The roster last shown to this agent, to show it again only when it changes. */
  roster_hash?: string;
  roster_agent?: string;
  /** A title was given (or tried) once. */
  titled?: boolean;
  /** Memory notes shown per agent, and the model log seq of the turn that showed the standing ones. */
  memory_shown?: Record<string, string[]>;
  memory_since?: Record<string, number>;
};

export type LogEntry = { seq: number; run_id: string | undefined; item: unknown };

export function threadsRepo({ one, all, run }: Sql, bus: Bus) {
  const repo = {
    list(opts: { project_id?: string | undefined; include_subthreads?: boolean } = {}): Thread[] {
      const { project_id } = opts;
      return all(
        qb
          .selectFrom("threads")
          .selectAll()
          .$if(!opts.include_subthreads, (q) => q.where("parent_id", "is", null))
          .$if(!!project_id, (q) => q.where("project_id", "=", project_id as string))
          .orderBy("updated_at", "desc")
          .limit(300),
      ).map(toThread);
    },
    children(parentId: string): string[] {
      return all(qb.selectFrom("threads").select("id").where("parent_id", "=", parentId)).map((r) => r.id);
    },
    /** The a2a sessions a thread opened, newest first. */
    sessions(parentId: string): Thread[] {
      return all(
        qb.selectFrom("threads").selectAll().where("parent_id", "=", parentId).orderBy("updated_at", "desc").limit(50),
      ).map(toThread);
    },
    /** A session of `parentId` by name or by sub-thread id. */
    session(parentId: string, ref: string): Thread | undefined {
      const r = one(
        qb
          .selectFrom("threads")
          .selectAll()
          .where("parent_id", "=", parentId)
          .where((eb) => eb.or([eb("session", "=", ref), eb("id", "=", ref)])),
      );
      return r ? toThread(r) : undefined;
    },
    get(id: string): Thread | undefined {
      const r = one(qb.selectFrom("threads").selectAll().where("id", "=", id));
      return r ? toThread(r) : undefined;
    },
    /** The thread of a channel conversation. */
    byConversation(channel: string, conversation: string): Thread | undefined {
      const r = one(
        qb.selectFrom("threads").selectAll().where("channel", "=", channel).where("conversation", "=", conversation),
      );
      return r ? toThread(r) : undefined;
    },
    create(
      t: Pick<Thread, "kind" | "title" | "agent_ids"> & {
        project_id?: string | undefined;
        parent_id?: string | undefined;
        session?: string | undefined;
        cwd?: string | undefined;
        write?: Thread["write"];
        channel?: Thread["channel"];
        id?: string;
      },
    ): Thread {
      const ts = now();
      const id = t.id ?? newId("th");
      run(
        qb.insertInto("threads").values({
          id,
          kind: t.kind,
          title: t.title,
          agent_ids: JSON.stringify(t.agent_ids),
          project_id: t.project_id ?? null,
          parent_id: t.parent_id ?? null,
          session: t.session ?? null,
          cwd: t.cwd ?? null,
          write_policy: t.write ?? null,
          channel: t.channel?.id ?? null,
          conversation: t.channel?.conversation ?? null,
          person_id: t.channel?.person_id ?? null,
          state: "idle",
          preview: "",
          unread: 0,
          created_at: ts,
          updated_at: ts,
        }),
      );
      const thread = repo.get(id) as Thread;
      bus.emit({ type: "thread.updated", thread });
      return thread;
    },
    patch(id: string, patch: Partial<Pick<Thread, "state" | "preview" | "unread" | "title">>, touch = true): Thread {
      const cur = repo.get(id);
      if (!cur) throw new Error(`unknown thread ${id}`);
      const next = { ...cur, ...patch, updated_at: touch ? now() : cur.updated_at };
      run(
        qb
          .updateTable("threads")
          .set({
            state: next.state,
            preview: next.preview,
            unread: next.unread,
            title: next.title,
            updated_at: next.updated_at,
          })
          .where("id", "=", id),
      );
      bus.emit({ type: "thread.updated", thread: next });
      return next;
    },
    /** The bookkeeping kept per thread (never shown). */
    context(id: string): ThreadContext {
      const r = one(qb.selectFrom("threads").select("context").where("id", "=", id));
      return r ? (JSON.parse(r.context) as ThreadContext) : {};
    },
    setContext(id: string, value: ThreadContext): void {
      run(
        qb
          .updateTable("threads")
          .set({ context: JSON.stringify(value) })
          .where("id", "=", id),
      );
    },
    /** Changes only the given keys (undefined removes one), over what is stored now: writers do not clobber each other. */
    mergeContext(id: string, patch: { [K in keyof ThreadContext]?: ThreadContext[K] | undefined }): void {
      repo.setContext(id, { ...repo.context(id), ...patch });
    },
  };
  return repo;
}

export function messagesRepo({ one, all, run }: Sql, bus: Bus) {
  const repo = {
    list(threadId: string, limit = 200): Message[] {
      const newest = qb
        .selectFrom("messages")
        .selectAll()
        .where("thread_id", "=", threadId)
        .orderBy("seq", "desc")
        .limit(limit);
      return all(qb.selectFrom(newest.as("m")).selectAll().orderBy("seq")).map(toMessage);
    },
    get(id: string): Message | undefined {
      const r = one(qb.selectFrom("messages").selectAll().where("id", "=", id));
      return r ? toMessage(r) : undefined;
    },
    add(m: { thread_id: string; author: Author; parts: Part[]; run_id?: string; model?: string }): Message {
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
        created_at: now(),
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
          created_at: message.created_at,
        }),
      );
      bus.emit({ type: "message.created", message });
      return message;
    },
    /** Replaces the whole message (model change, recovery). */
    update(message: Message): Message {
      run(
        qb
          .updateTable("messages")
          .set({ parts: JSON.stringify(message.parts), model: message.model ?? null })
          .where("id", "=", message.id),
      );
      bus.emit({ type: "message.updated", message });
      return message;
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

export function modelLogRepo({ one, all, run }: Sql) {
  return {
    /** The thread's log, oldest first; `limit` keeps the newest entries. */
    list(threadId: string, limit = 2000): LogEntry[] {
      const newest = qb
        .selectFrom("model_log")
        .selectAll()
        .where("thread_id", "=", threadId)
        .orderBy("seq", "desc")
        .limit(limit);
      return all(qb.selectFrom(newest.as("l")).select(["seq", "run_id", "item"]).orderBy("seq")).map((r) => ({
        seq: Number(r.seq),
        run_id: r.run_id ? r.run_id : undefined,
        item: JSON.parse(r.item),
      }));
    },
    forRun(runId: string): unknown[] {
      return all(qb.selectFrom("model_log").select("item").where("run_id", "=", runId).orderBy("seq")).map((r) =>
        JSON.parse(r.item),
      );
    },
    /** Appends items in order; returns the seq of the first one. */
    append(threadId: string, runId: string | undefined, items: unknown[]): number {
      const base = Number(
        one(
          qb
            .selectFrom("model_log")
            .select((eb) => eb.fn.coalesce(eb.fn.max("seq"), eb.lit(0)).as("m"))
            .where("thread_id", "=", threadId),
        )?.m ?? 0,
      );
      for (const [i, item] of items.entries())
        run(
          qb
            .insertInto("model_log")
            .values({ thread_id: threadId, seq: base + i + 1, item: JSON.stringify(item), run_id: runId ?? null }),
        );
      return base + 1;
    },
  };
}
