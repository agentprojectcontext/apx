// Threads, what was said in them (messages, for people) and what the model saw (model_log, for the model).
// Two projections of one conversation: the UI never reads the model log and the model never reads display parts.
import type { Author, Message, MessageDelivery, MessageReaction, ModelChoice, Part, Thread } from "@apx/protocol";
import type { Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import type { Bus } from "../bus.ts";
import type { MessagesTable, ThreadsTable } from "../db/schema.ts";
import { ftsQuery } from "./memories.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";
import { toThread } from "./thread-projection.ts";

const toMessage = (r: Selectable<MessagesTable>): Message => ({
  id: r.id,
  thread_id: r.thread_id,
  seq: Number(r.seq),
  author: JSON.parse(r.author) as Author,
  parts: JSON.parse(r.parts) as Part[],
  ...opt("run_id", r.run_id),
  ...opt("model", r.model),
  ...(r.delivery ? { delivery: r.delivery as MessageDelivery } : {}),
  ...(r.reactions ? { reactions: JSON.parse(r.reactions) as MessageReaction[] } : {}),
  created_at: r.created_at,
});

/** A receipt never moves a message back (a late "delivered" after "read"); a failure only replaces what never left. */
const DELIVERY_RANK: Record<MessageDelivery, number> = { pending: 0, failed: 1, sent: 2, delivered: 3, read: 4 };

/** A summary that stands for the model log up to `upto`: a new epoch of the thread's context (engine/upkeep.ts). */
export type Epoch = { upto: number; summary: string; untrusted: boolean; runs: number; at: string };

/** What the context builder, the upkeep and the channels keep per thread. */
export type ThreadContext = {
  /** Answers go back to this channel conversation while the last words came from it (in a room, as a reply to `message`). */
  reply_to?: { channel: string; conversation: string; message?: string | undefined };
  /** The other side's last message on a channel: the platform's id for it (to react to it) and its message here. */
  their_last?: { channel: string; conversation: string; ref: string; message_id: string };
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
  memory_versions?: Record<string, number>;
  /** Own notes listed by hook in the memory index per agent ("id:revision"), and when it was last shown. */
  memory_indexed?: Record<string, string[]>;
  memory_indexed_at?: Record<string, string>;
  /** Started by an outside app (its client id): only that app may read it or write in it. */
  client?: string;
  /** The model picked for this chat in its composer: tried before the agent's own choice. */
  model_choice?: ModelChoice;
  /** A worker's session: the caller's own agent, run under instructions the caller wrote for one task. */
  worker?: Worker;
  /** A consult an @mention in a task opened: the task, and the card in its conversation that shows the answer. */
  /** `asker`: the agent that asked on the task and the chat it asked from, where it hears the answer. */
  consult?: { task: string; card: string; review?: boolean; asker?: { agent: string; thread: string } };
  /** On a task's conversation: the close (its place in the task's history) already reported to whoever created it. */
  close_reported?: number;
  /** A task chat an agent's turn started: the chat it came from, whose unattended limits its turns count against. */
  asked_from?: string;
  /** A task chat that stalled: when APX last asked its agent to go on, and the stop since then the owner was told of. */
  stall?: { revived_at: string; told?: string };
  /** Tasks agents gave from this chat while it was paused: each starts once the owner lets agents go on. */
  held?: HeldTask[];
  /** On a task's conversation: the owner's comments no agent has had yet (message ids), and those handed to a turn. */
  owner_unread?: string[];
  owner_handed?: Array<{ run: string; messages: string[] }>;
  /** Queued delegations from this chat the breaker holds (run ids) whose notice the owner already saw. */
  queue_held?: string[];
  /** A result or report reached this chat's agent (its id) while paused: kept for its next turn, which going on starts. */
  kept?: string;
  /** On a tree's top chat: the owner gave agents a fresh budget at this moment (counted from here). */
  budget_from?: string;
  /** On a tree's top chat: the owner let agents go on with no limit at this moment, until they write there again. */
  released_at?: string;
  /** Brought from the owner's Claude Code or Codex: that session. */
  /** Fork relatives do not automatically recall each other beyond their copied history. */
  memory_family?: string;
  memory_cutoff?: string;
  imported?: { engine: "claude" | "codex"; session: string };
  /** What an imported chat is about, for the agent that takes it over (sessions.digest). */
  digest?: { text: string; at: string };
  /** The chat that told the owner what an update brought (domain/whats-new.ts): the releases it covers. */
  release?: ReleaseContext;
};

/** A release-notes chat: up to which version, from which one (its commits are previous..version), and where built. */
export type ReleaseContext = { version: string; previous?: string; branch?: string; repo_dir?: string };

/** A task's start an agent asked for, kept until the owner lets agents go on: who works it, and who asked. */
export type HeldTask = { task: string; agent: string; run: string; depth: number };

/** A throwaway helper an agent starts for one task: a name, its instructions and (optionally) fewer tools. */
export type Worker = { name: string; instructions: string; tools?: string[] | undefined };

/** What a thread list shows of the last thing said. */
/**
 * A chat that works in a folder with a write policy: a code session, or any project chat the owner set to work in its
 * project's folder. Its tools and outside engines follow that policy.
 */
export const worksInFolder = (t: Pick<Thread, "cwd" | "write">) => Boolean(t.cwd && t.write);

type Write = NonNullable<Thread["write"]>;
const WRITE_STRICTNESS: Record<Write, number> = { auto: 0, ask: 1, "read-only": 2 };

/** The strictest of these write policies: what a folder allows when several say how far it may go. */
export const strictestWrite = (first: Write, ...rest: Write[]): Write =>
  rest.reduce((m, w) => (WRITE_STRICTNESS[w] > WRITE_STRICTNESS[m] ? w : m), first);

export const PREVIEW_CHARS = 160;
export const previewOf = (text: string) => text.slice(0, PREVIEW_CHARS);

export function threadsRepo({ one, all, run }: Sql, bus: Bus, endSession: (thread: string) => void = () => {}) {
  const repo = {
    list(
      opts: {
        project_id?: string | undefined;
        include_subthreads?: boolean;
        include_archived?: boolean;
        limit?: number | null;
        engine?: string | undefined;
      } = {},
    ): Thread[] {
      const { project_id, engine } = opts;
      return all(
        qb
          .selectFrom("threads")
          .selectAll()
          .select((eb) =>
            eb
              .selectFrom("routine_runs")
              .select("routine_id")
              .whereRef("thread_id", "=", "threads.id")
              .limit(1)
              .as("routine_id"),
          )
          .$if(!opts.include_subthreads, (q) => q.where("parent_id", "is", null))
          .$if(!opts.include_archived, (q) => q.where("archived", "=", 0))
          // A routine's quiet runs are reached from the routine: they would crowd every other chat out of the cap.
          .where((eb) => eb.or([eb("kind", "!=", "routine"), eb("archived", "=", 0)]))
          .$if(!!project_id, (q) => q.where("project_id", "=", project_id as string))
          // An engine's sessions: the engine itself, never an agent's chat that happens to run on its model.
          .$if(!!engine, (q) => q.where("engine", "=", engine as string))
          // Pinned first, so the cap never drops one.
          .orderBy("pinned", "desc")
          .orderBy("updated_at", "desc")
          .$if(opts.limit !== null, (q) => q.limit(opts.limit ?? 300)),
      ).map(toThread);
    },
    /** Every delegated descendant, independent of the global chat list's recency cap. */
    descendants(root: string, includeArchived = false): Thread[] {
      return all(
        qb
          .withRecursive("descendants", (db) =>
            db
              .selectFrom("threads")
              .select("id")
              .where("parent_id", "=", root)
              .union(
                db
                  .selectFrom("threads")
                  .innerJoin("descendants", "threads.parent_id", "descendants.id")
                  .select("threads.id"),
              ),
          )
          .selectFrom("threads")
          .selectAll("threads")
          .innerJoin("descendants", "threads.id", "descendants.id")
          .where("threads.id", "!=", root)
          .$if(!includeArchived, (q) => q.where("archived", "=", 0))
          .orderBy("updated_at", "desc"),
      ).map(toThread);
    },
    /** Up to `perChat` of the chats each of `parents` delegated (not archived), newest first. */
    delegatedFrom(parents: string[], perChat: number): Thread[] {
      if (!parents.length || perChat <= 0) return [];
      return all(
        qb
          .selectFrom((db) =>
            db
              .selectFrom("threads")
              .selectAll()
              .select(sql<number>`row_number() over (partition by parent_id order by updated_at desc)`.as("rank"))
              // One statement whatever the number of parents: a JSON array, not a list of placeholders.
              .where(sql<boolean>`parent_id in (select value from json_each(${JSON.stringify(parents)}))`)
              .where("archived", "=", 0)
              .as("d"),
          )
          .selectAll()
          .where("rank", "<=", perChat)
          .orderBy("updated_at", "desc"),
      ).map(toThread);
    },
    /** How many chats (not archived) each of `parents` delegated, for the ones that did. */
    delegatedCounts(parents: string[]): Record<string, number> {
      if (!parents.length) return {};
      const rows = all(
        qb
          .selectFrom("threads")
          .select(["parent_id", (eb) => eb.fn.countAll<number>().as("n")])
          .where(sql<boolean>`parent_id in (select value from json_each(${JSON.stringify(parents)}))`)
          .where("archived", "=", 0)
          .groupBy("parent_id"),
      );
      return Object.fromEntries(rows.map((r) => [String(r.parent_id), Number(r.n)]));
    },
    /** Delegated chats linked to another project than the chat they came from (in `project_id` when given). */
    delegatedAcross(project_id: string | undefined, limit = 100): Thread[] {
      return all(
        qb
          .selectFrom("threads as c")
          .innerJoin("threads as p", "p.id", "c.parent_id")
          .selectAll("c")
          .where("c.archived", "=", 0)
          .where("c.project_id", "is not", null)
          .where((eb) => eb.or([eb("p.project_id", "is", null), eb("p.project_id", "!=", eb.ref("c.project_id"))]))
          .$if(!!project_id, (q) => q.where("c.project_id", "=", project_id as string))
          .orderBy("c.updated_at", "desc")
          .limit(limit),
      ).map(toThread);
    },
    children(parentId: string): string[] {
      return all(qb.selectFrom("threads").select("id").where("parent_id", "=", parentId)).map((r) => r.id);
    },
    /** The chats keeping tasks agents gave while paused (`held`). */
    holding(): string[] {
      return all(qb.selectFrom("threads").select("id").where(sql`json_array_length(context, '$.held')`, ">", 0)).map(
        (r) => r.id,
      );
    },
    /** The task conversations holding owner comments no agent has had yet (`owner_unread`). */
    unreadByAgents(): string[] {
      return all(
        qb.selectFrom("threads").select("id").where(sql`json_array_length(context, '$.owner_unread')`, ">", 0),
      ).map((r) => r.id);
    },
    /** The task chats an agent's turn in `threadId` started (`asked_from`). */
    askedFrom(threadId: string): string[] {
      return all(
        qb.selectFrom("threads").select("id").where(sql`json_extract(context, '$.asked_from')`, "=", threadId),
      ).map((r) => r.id);
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
      const r = one(
        qb
          .selectFrom("threads")
          .selectAll()
          .select((eb) =>
            eb
              .selectFrom("routine_runs")
              .select("routine_id")
              .whereRef("thread_id", "=", "threads.id")
              .limit(1)
              .as("routine_id"),
          )
          .where("id", "=", id),
      );
      return r ? toThread(r) : undefined;
    },
    /** The chats a task is worked in, oldest first. */
    byTask(taskId: string): Thread[] {
      return all(qb.selectFrom("threads").selectAll().where("task_id", "=", taskId).orderBy("created_at")).map(
        toThread,
      );
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
        task_id?: string | undefined;
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
          task_id: t.task_id ?? null,
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
    /** An agent took part (a task's conversation): listed after the ones already there, so the first one stays. */
    join(id: string, agentId: string): Thread {
      const t = repo.get(id);
      if (!t) throw new Error(`unknown thread ${id}`);
      if (t.agent_ids.includes(agentId)) return t;
      return repo.write(id, { agent_ids: JSON.stringify([...t.agent_ids, agentId]) });
    },
    /** Another agent takes the chat over: it answers there now, and what the old one said shows as its own. */
    handOver(id: string, from: string, to: string): Thread {
      const t = repo.get(id);
      if (!t) throw new Error(`unknown thread ${id}`);
      const author = JSON.stringify({ kind: "agent", id: from });
      run(
        qb
          .updateTable("messages")
          .set({ author: JSON.stringify({ kind: "agent", id: to }) })
          .where("thread_id", "=", id)
          .where("author", "=", author),
      );
      const ids = [to, ...t.agent_ids.filter((a) => a !== from && a !== to)];
      return repo.write(id, { agent_ids: JSON.stringify(ids) });
    },
    /** The owner's arrangement: their own name (null = the automatic title), pinned, archived. Not activity. */
    arrange(id: string, a: { custom_title?: string | null; pinned?: boolean; archived?: boolean }): Thread {
      if (!repo.get(id)) throw new Error(`unknown thread ${id}`);
      const set: Updateable<ThreadsTable> = {};
      if (a.custom_title !== undefined) set.custom_title = a.custom_title || null;
      if (a.pinned !== undefined) set.pinned = a.pinned ? 1 : 0;
      if (a.archived !== undefined) set.archived = a.archived ? 1 : 0;
      if (a.archived) endSession(id);
      return repo.write(id, set);
    },
    /** Works in `cwd` with that write policy, or (null) stops working in a folder. */
    workIn(id: string, w: { cwd: string; write: NonNullable<Thread["write"]> } | null): Thread {
      if (!repo.get(id)) throw new Error(`unknown thread ${id}`);
      return repo.write(id, w ? { cwd: w.cwd, write_policy: w.write } : { cwd: null, write_policy: null });
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
          .where("state", "in", ["queued", "submitted", "working", "input-required"])
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
      for (const id of ids) endSession(id);
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
      // How far it got and its reactions are the channel's to say: a rewrite of its words keeps them.
      const stored = repo.get(message.id);
      const out = {
        ...message,
        ...(stored?.delivery ? { delivery: stored.delivery } : {}),
        ...(stored?.reactions ? { reactions: stored.reactions } : {}),
      };
      bus.emit({ type: "message.updated", message: out });
      return out;
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
          at: m.created_at,
          quiet: true,
        });
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
