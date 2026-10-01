// Threads, what was said in them (messages, for people) and what the model saw (model_log, for the model).
// Two projections of one conversation: the UI never reads the model log and the model never reads display parts.
import type { Author, Message, Part, Thread } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

const toThread = (r: Row): Thread => ({
  id: String(r.id),
  kind: r.kind as Thread["kind"],
  title: String(r.title),
  agent_ids: JSON.parse(String(r.agent_ids)) as string[],
  ...opt("project_id", r.project_id),
  ...opt("parent_id", r.parent_id),
  ...opt("session", r.session),
  ...opt("cwd", r.cwd),
  ...(r.write_policy ? { write: r.write_policy as NonNullable<Thread["write"]> } : {}),
  state: r.state as Thread["state"],
  preview: String(r.preview),
  unread: Number(r.unread),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

const toMessage = (r: Row): Message => ({
  id: String(r.id),
  thread_id: String(r.thread_id),
  seq: Number(r.seq),
  author: JSON.parse(String(r.author)) as Author,
  parts: JSON.parse(String(r.parts)) as Part[],
  ...opt("run_id", r.run_id),
  ...opt("model", r.model),
  created_at: String(r.created_at),
});

export type LogEntry = { seq: number; run_id: string | undefined; item: unknown };

export function threadsRepo({ one, all, run }: Sql, bus: Bus) {
  const repo = {
    list(opts: { project_id?: string | undefined; include_subthreads?: boolean } = {}): Thread[] {
      const where: string[] = [];
      const args: unknown[] = [];
      if (!opts.include_subthreads) where.push("parent_id IS NULL");
      if (opts.project_id) {
        where.push("project_id = ?");
        args.push(opts.project_id);
      }
      return all(
        `SELECT * FROM threads ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 300`,
        ...args,
      ).map(toThread);
    },
    children(parentId: string): string[] {
      return all("SELECT id FROM threads WHERE parent_id = ?", parentId).map((r) => String(r.id));
    },
    /** The a2a sessions a thread opened, newest first. */
    sessions(parentId: string): Thread[] {
      return all("SELECT * FROM threads WHERE parent_id = ? ORDER BY updated_at DESC LIMIT 50", parentId).map(toThread);
    },
    /** A session of `parentId` by name or by sub-thread id. */
    session(parentId: string, ref: string): Thread | undefined {
      const r = one("SELECT * FROM threads WHERE parent_id = ? AND (session = ? OR id = ?)", parentId, ref, ref);
      return r ? toThread(r) : undefined;
    },
    get(id: string): Thread | undefined {
      const r = one("SELECT * FROM threads WHERE id = ?", id);
      return r ? toThread(r) : undefined;
    },
    create(
      t: Pick<Thread, "kind" | "title" | "agent_ids"> & {
        project_id?: string | undefined;
        parent_id?: string | undefined;
        session?: string | undefined;
        cwd?: string | undefined;
        write?: Thread["write"];
        id?: string;
      },
    ): Thread {
      const ts = now();
      const id = t.id ?? newId("th");
      run(
        "INSERT INTO threads (id, kind, title, agent_ids, project_id, parent_id, session, cwd, write_policy, state, preview, unread, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', '', 0, ?, ?)",
        id,
        t.kind,
        t.title,
        JSON.stringify(t.agent_ids),
        t.project_id ?? null,
        t.parent_id ?? null,
        t.session ?? null,
        t.cwd ?? null,
        t.write ?? null,
        ts,
        ts,
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
        "UPDATE threads SET state = ?, preview = ?, unread = ?, title = ?, updated_at = ? WHERE id = ?",
        next.state,
        next.preview,
        next.unread,
        next.title,
        next.updated_at,
        id,
      );
      bus.emit({ type: "thread.updated", thread: next });
      return next;
    },
    /** Free-form bookkeeping the context builder keeps per thread (never shown). */
    context(id: string): Record<string, unknown> {
      const r = one("SELECT context FROM threads WHERE id = ?", id);
      return r ? (JSON.parse(String(r.context)) as Record<string, unknown>) : {};
    },
    setContext(id: string, value: Record<string, unknown>): void {
      run("UPDATE threads SET context = ? WHERE id = ?", JSON.stringify(value), id);
    },
    /** Changes only the given keys (undefined removes one), over what is stored now: writers do not clobber each other. */
    mergeContext(id: string, patch: Record<string, unknown>): void {
      repo.setContext(id, { ...repo.context(id), ...patch });
    },
  };
  return repo;
}

export function messagesRepo({ one, all, run }: Sql, bus: Bus) {
  const repo = {
    list(threadId: string, limit = 200): Message[] {
      return all(
        "SELECT * FROM (SELECT * FROM messages WHERE thread_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq",
        threadId,
        limit,
      ).map(toMessage);
    },
    get(id: string): Message | undefined {
      const r = one("SELECT * FROM messages WHERE id = ?", id);
      return r ? toMessage(r) : undefined;
    },
    add(m: { thread_id: string; author: Author; parts: Part[]; run_id?: string; model?: string }): Message {
      const seqRow = one("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE thread_id = ?", m.thread_id);
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
        "INSERT INTO messages (id, thread_id, seq, author, parts, run_id, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        message.id,
        message.thread_id,
        message.seq,
        JSON.stringify(message.author),
        JSON.stringify(message.parts),
        message.run_id ?? null,
        message.model ?? null,
        message.created_at,
      );
      bus.emit({ type: "message.created", message });
      return message;
    },
    /** Replaces the whole message (model change, recovery). */
    update(message: Message): Message {
      run(
        "UPDATE messages SET parts = ?, model = ? WHERE id = ?",
        JSON.stringify(message.parts),
        message.model ?? null,
        message.id,
      );
      bus.emit({ type: "message.updated", message });
      return message;
    },
    /** Stores the parts and announces only the one that changed. */
    setPart(message: Message, index: number): void {
      run("UPDATE messages SET parts = ? WHERE id = ?", JSON.stringify(message.parts), message.id);
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
      return all(
        "SELECT seq, run_id, item FROM (SELECT * FROM model_log WHERE thread_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq",
        threadId,
        limit,
      ).map((r) => ({
        seq: Number(r.seq),
        run_id: r.run_id ? String(r.run_id) : undefined,
        item: JSON.parse(String(r.item)),
      }));
    },
    forRun(runId: string): unknown[] {
      return all("SELECT item FROM model_log WHERE run_id = ? ORDER BY seq", runId).map((r) =>
        JSON.parse(String(r.item)),
      );
    },
    append(threadId: string, runId: string | undefined, items: unknown[]): void {
      const base = Number(
        one("SELECT COALESCE(MAX(seq), 0) AS m FROM model_log WHERE thread_id = ?", threadId)?.m ?? 0,
      );
      for (const [i, item] of items.entries())
        run(
          "INSERT INTO model_log (thread_id, seq, item, run_id) VALUES (?, ?, ?, ?)",
          threadId,
          base + i + 1,
          JSON.stringify(item),
          runId ?? null,
        );
    },
  };
}
