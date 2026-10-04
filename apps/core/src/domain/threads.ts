// Threads, what was said in them (messages, for people) and what the model saw (model_log, for the model).
// Two projections of one conversation: the UI never reads the model log and the model never reads display parts.
import type { Author, Message, ModelChoice, Part, Thread } from "@apx/protocol";
import type { Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import type { Bus } from "../bus.ts";
import type { MessagesTable, ThreadsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

/** The model picked for this chat in its composer, kept in its context. */
function chatModel(context: string): Pick<Thread, "model_choice"> {
  try {
    const c = JSON.parse(context) as ThreadContext;
    return c.model_choice ? { model_choice: c.model_choice } : {};
  } catch {
    return {};
  }
}

const toThread = (r: Selectable<ThreadsTable>): Thread => ({
  id: r.id,
  kind: r.kind as Thread["kind"],
  title: r.custom_title ?? r.title,
  ...(r.custom_title ? { auto_title: r.title } : {}),
  ...(r.pinned ? { pinned: true } : {}),
  ...(r.archived ? { archived: true } : {}),
  agent_ids: JSON.parse(r.agent_ids) as string[],
  ...opt("project_id", r.project_id),
  ...opt("parent_id", r.parent_id),
  ...opt("session", r.session),
  ...opt("cwd", r.cwd),
  ...opt("engine", r.engine),
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
  ...chatModel(r.context),
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
  /** Answers go back to this channel conversation while the last words came from it (in a room, as a reply to `message`). */
  reply_to?: { channel: string; conversation: string; message?: string | undefined };
  /** A public room of a server (a Discord channel): its turns are sealed, whoever wrote. */
  room?: { name: string };
  compaction?: Epoch;
  /** The roster last shown to this agent, to show it again only when it changes. */
  roster_hash?: string;
  roster_agent?: string;
  /** Answers on a channel also go as voice notes (the agent's voice_replies tool). */
  voice_replies?: boolean;
  /** A title was given (or tried) once. */
  titled?: boolean;
  /** Memory notes shown per agent, and the model log seq of the turn that showed the standing ones. */
  memory_shown?: Record<string, string[]>;
  memory_since?: Record<string, number>;
  /** Started by an outside app (its client id): only that app may read it or write in it. */
  client?: string;
  /** The model picked for this chat in its composer: tried before the agent's own choice. */
  model_choice?: ModelChoice;
  /** A worker's session: the caller's own agent, run under instructions the caller wrote for one task. */
  worker?: Worker;
};

/** A throwaway helper an agent starts for one task: a name, its instructions and (optionally) fewer tools. */
export type Worker = { name: string; instructions: string; tools?: string[] | undefined };

/** What a thread list shows of the last thing said. */
export const PREVIEW_CHARS = 160;
export const previewOf = (text: string) => text.slice(0, PREVIEW_CHARS);

export type LogEntry = { seq: number; run_id: string | undefined; item: unknown };

export function threadsRepo({ one, all, run }: Sql, bus: Bus) {
  const repo = {
    list(
      opts: {
        project_id?: string | undefined;
        include_subthreads?: boolean;
        include_archived?: boolean;
        engine?: string | undefined;
      } = {},
    ): Thread[] {
      const { project_id, engine } = opts;
      return all(
        qb
          .selectFrom("threads")
          .selectAll()
          .$if(!opts.include_subthreads, (q) => q.where("parent_id", "is", null))
          .$if(!opts.include_archived, (q) => q.where("archived", "=", 0))
          .$if(!!project_id, (q) => q.where("project_id", "=", project_id as string))
          // An engine's sessions: the engine itself, never an agent's chat that happens to run on its model.
          .$if(!!engine, (q) => q.where("engine", "=", engine as string))
          // Pinned first, so the cap never drops one.
          .orderBy("pinned", "desc")
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
        engine?: string | undefined;
        id?: string;
        /** When it started, for history brought from elsewhere (v1); now otherwise. */
        at?: string | undefined;
      },
    ): Thread {
      const ts = t.at ?? now();
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
          engine: t.engine ?? null,
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
    /** A thread whose history was brought in: its last activity and preview are the history's own. */
    settle(id: string, at: string, preview: string): void {
      run(qb.updateTable("threads").set({ updated_at: at, preview }).where("id", "=", id));
    },
    /** State and activity. `title` is the automatic one: an owner's own name stays over it. */
    patch(id: string, patch: Partial<Pick<Thread, "state" | "preview" | "unread" | "title">>, touch = true): Thread {
      if (!repo.get(id)) throw new Error(`unknown thread ${id}`);
      const set: Updateable<ThreadsTable> = {};
      if (patch.state !== undefined) set.state = patch.state;
      if (patch.preview !== undefined) set.preview = patch.preview;
      if (patch.unread !== undefined) set.unread = patch.unread;
      if (patch.title !== undefined) set.title = patch.title;
      if (touch) set.updated_at = now();
      return repo.write(id, set);
    },
    /** The owner's arrangement: their own name (null = the automatic title), pinned, archived. Not activity. */
    arrange(id: string, a: { custom_title?: string | null; pinned?: boolean; archived?: boolean }): Thread {
      if (!repo.get(id)) throw new Error(`unknown thread ${id}`);
      const set: Updateable<ThreadsTable> = {};
      if (a.custom_title !== undefined) set.custom_title = a.custom_title || null;
      if (a.pinned !== undefined) set.pinned = a.pinned ? 1 : 0;
      if (a.archived !== undefined) set.archived = a.archived ? 1 : 0;
      return repo.write(id, set);
    },
    write(id: string, set: Updateable<ThreadsTable>): Thread {
      if (Object.keys(set).length) run(qb.updateTable("threads").set(set).where("id", "=", id));
      const next = repo.get(id) as Thread;
      bus.emit({ type: "thread.updated", thread: next });
      return next;
    },
    /** The thread and every sub-thread under it, the thread first. */
    family(id: string): string[] {
      const out = [id];
      for (let i = 0; i < out.length; i++) out.push(...repo.children(out[i] as string));
      return out;
    },
    /** Whether a turn is queued or running, or a terminal job runs, in any of these threads. */
    busy(ids: string[]): boolean {
      const run = one(
        qb
          .selectFrom("runs")
          .select("id")
          .where("thread_id", "in", ids)
          .where("state", "in", ["submitted", "working", "input-required"])
          .limit(1),
      );
      const job = one(
        qb.selectFrom("jobs").select("id").where("thread_id", "in", ids).where("state", "=", "working").limit(1),
      );
      return Boolean(run || job);
    },
    /**
     * Deletes threads and everything that only made sense inside them. Rows that outlive a chat (notes, widgets, sent
     * messages, nudges) keep their content and lose the link. Returns the files left to remove.
     */
    remove(ids: string[]): { media: string[]; jobs: string[] } {
      if (!ids.length) return { media: [], jobs: [] };
      const media = all(qb.selectFrom("media").select("path").where("thread_id", "in", ids)).map((r) => r.path);
      const jobs = all(qb.selectFrom("jobs").select("id").where("thread_id", "in", ids)).map((r) => r.id);
      run(qb.deleteFrom("media").where("thread_id", "in", ids));
      run(qb.deleteFrom("jobs").where("thread_id", "in", ids));
      run(qb.deleteFrom("pending_inputs").where("thread_id", "in", ids));
      run(qb.deleteFrom("routine_runs").where("thread_id", "in", ids));
      run(qb.updateTable("memories").set({ thread_id: null }).where("thread_id", "in", ids));
      run(qb.updateTable("surfaces").set({ thread_id: null }).where("thread_id", "in", ids));
      run(qb.updateTable("outbox").set({ thread_id: null }).where("thread_id", "in", ids));
      run(qb.updateTable("nudges").set({ thread_id: null }).where("thread_id", "in", ids));
      // Messages first, so the search index triggers run; runs, steps, the model log and harness sessions cascade.
      run(qb.deleteFrom("messages").where("thread_id", "in", ids));
      run(qb.deleteFrom("threads").where("id", "in", ids));
      bus.emit({ type: "thread.deleted", thread_id: ids[0] as string, children: ids.slice(1) });
      return { media, jobs };
    },
    /** Moves a thread to another project (or to none): a task's conversation follows its task. */
    moveTo(id: string, projectId: string | undefined): Thread {
      run(
        qb
          .updateTable("threads")
          .set({ project_id: projectId ?? null })
          .where("id", "=", id),
      );
      const next = repo.get(id);
      if (!next) throw new Error(`unknown thread ${id}`);
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

export function messagesRepo({ one, all, run }: Sql, bus: Bus) {
  const repo = {
    /** Messages whose text has every word of `query`, best match first, newest among equals. */
    search(query: string, limit = 30): MessageHit[] {
      const match = messageQuery(query);
      if (!match) return [];
      const rows = all(
        qb
          .selectFrom("messages_fts")
          .innerJoin("messages_n", "messages_n.n", "messages_fts.rowid")
          .innerJoin("messages", "messages.id", "messages_n.id")
          .selectAll("messages")
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
