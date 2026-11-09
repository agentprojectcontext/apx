// Threads, what was said in them (messages, for people) and what the model saw (model_log, for the model).
// Two projections of one conversation: the UI never reads the model log and the model never reads display parts.
import type { ModelChoice, Thread } from "@apx/protocol";
import type { Updateable } from "kysely";
import { sql } from "kysely";
import type { Bus } from "../bus.ts";
import type { ThreadsTable } from "../db/schema.ts";
import { newId, now, qb, type Sql } from "./sql.ts";
import { joinModelLogs, moveChatRows } from "./thread-join.ts";
import { toThread } from "./thread-projection.ts";

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
  /** Opened from the Flow editor: the Flow it shows, or only its project while the Flow isn't made (D-175). */
  flow_editor?: { project: string; flow?: string | undefined };
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
  /** A Flow's AI model step: what it may do beyond answering (DECISIONS.md#d-172). */
  flow_step?: FlowStepContext;
  /** A consult an @mention in a task opened: the task, and the card in its conversation that shows the answer. */
  /** `asker`: the agent that asked on the task and the chat it asked from, where it hears the answer. */
  consult?: { task: string; card: string; review?: boolean; asker?: { agent: string; thread: string } };
  /** On a task's conversation: the close (its place in the task's history) already reported to whoever created it. */
  close_reported?: number;
  /**
   * An owner-check sub-thread: the owner's chat whose channel words it checks, that chat's agent, and where its answer
   * goes out (DECISIONS.md#d-144).
   */
  /** Where the checked answer goes; none: where the chat's answers go (words handed on from a room, D-212). */
  owner_check?: { thread: string; agent_id: string; reply_to?: { channel: string; conversation: string } };
  /** A task chat an agent's turn started: the chat it came from, whose unattended limits its turns count against. */
  asked_from?: string;
  /** An immediate self-task takes execution from this run only; later owner turns stay independent. */
  task_handoff?: { task: string; run: string };
  /** One execution channel per teammate in a turn, including work started through task assignment. */
  task_dispatches?: { run: string; tasks: Array<{ task: string; agent: string; project?: string | undefined }> };
  /** The source of a self-task's existing findings, without copying trusted instructions or permissions. */
  handoff_from?: { thread: string; run: string };
  /** Project coordination that most recently started this existing task; its result returns there. */
  coordination_from?: { thread: string; run: string; work_run: string };
  /** Review returns already reported to the coordinating chat, keyed by the completed reviewer run. */
  coordination_feedback?: string[];
  /** Native tool permissions cannot be revoked or reliably correlated with completion by every harness. */
  external_grant_run?: string;
  /** A task chat that stalled: when APX last asked its agent to go on, and the stop since then the owner was told of. */
  stall?: { revived_at: string; told?: string };
  /** Tasks agents gave from this chat while it was paused: each starts once the owner lets agents go on. */
  held?: HeldTask[];
  /** On a task's conversation: the owner's comments no agent has had yet (message ids), and those handed to a turn. */
  owner_unread?: string[];
  owner_handed?: Array<{ run: string; messages: string[] }>;
  /**
   * Answers of teammates its agent asked in one turn (`run`), held until the others are in or `until` passes; `closed`
   * once it passed, so later ones come one by one (DECISIONS.md#d-194).
   */
  fanout?: FanoutGroup[];
  /** Queued delegations from this chat the breaker holds (run ids) whose notice the owner already saw. */
  queue_held?: string[];
  /** A result or report reached this chat's agent (its id) while paused: kept for its next turn, which going on starts. */
  kept?: string;
  /** On a tree's top chat: the owner gave agents a fresh budget at this moment (counted from here). */
  budget_from?: string;
  /** On a tree's top chat: the owner let agents go on with no limit at this moment, until they write there again. */
  released_at?: string;
  /** On a task's conversation: when a step of its plan was last done (the progress guard counts from it). */
  progress_at?: string;
  /** On a task's conversation: the stretch without progress the owner was already told about (its start). */
  stuck_told?: string;
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

/** One turn's delegations whose answers reach it together: the answers held so far (`stopped` as `deliver` got it). */
export type FanoutGroup = {
  run: string;
  until: string;
  held: Array<{ child: string; stopped?: string | undefined }>;
  closed?: boolean;
};

/** A task's start an agent asked for, kept until the owner lets agents go on: who works it, and who asked. */
export type HeldTask = {
  task: string;
  agent: string;
  run: string;
  depth: number;
  /** Latest run in each existing task chat when the start was held; missing on older records. */
  prior_runs?: string[];
  /** Event count at the hold, so later owner reassignment or scope changes cannot revive stale work. */
  prior_events?: number;
};

/** A throwaway helper an agent starts for one task: a name, its instructions and (optionally) fewer tools. */
/**
 * A Flow step's chat: whether it may hand work to or message other agents, whether it is a bot of the Flow (no memory,
 * history or team) and the mode it acts in on APX's harness, over the agent's own.
 */
export type FlowStepContext = {
  delegate: boolean;
  bot?: boolean;
  autonomy?: "manual" | "auto" | "total";
  /** The Flow and the step in it that opened this chat: the chat links back to them. */
  flow?: string;
  node?: string;
};
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

const PREVIEW_CHARS = 160;
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
          // External code sessions are chats of their project too, even when a caller owns their delivery.
          .$if(!opts.include_subthreads, (q) =>
            q.where((eb) =>
              eb.or([eb("parent_id", "is", null), eb.and([eb("kind", "=", "code"), eb("engine", "is not", null)])]),
            ),
          )
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
    /** The chats holding answers of a fan-out for their agent's next turn (`fanout`). */
    withFanout(): string[] {
      return all(
        qb.selectFrom("threads").select("id").where(sql`json_extract(context, '$.fanout')`, "is not", null),
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
    /** A channel chat whose address its platform writes another way: it goes on under that one (unless one is there). */
    readdress(channel: string, from: string, to: string): void {
      const t = repo.byConversation(channel, from);
      if (!t || repo.byConversation(channel, to)) return;
      run(qb.updateTable("threads").set({ conversation: to }).where("id", "=", t.id));
      const c = repo.context(t.id);
      repo.mergeContext(t.id, {
        ...(c.reply_to?.conversation === from ? { reply_to: { ...c.reply_to, conversation: to } } : {}),
        ...(c.their_last?.conversation === from ? { their_last: { ...c.their_last, conversation: to } } : {}),
      });
    },
    /**
     * One chat its platform kept under two addresses: `from`'s messages, turns, model log, memory work, files, drafts,
     * held messages and sub-chats go into `to`'s chat in time order and `from`'s chat is removed (an outside engine's session of it ends
     * with it); with no chat under `to`, `from`'s goes on under it. Not while either has a turn going ("busy": try
     * again later).
     */
    joinChats(channel: string, from: string, to: string): "joined" | "none" | "busy" {
      const gone = repo.byConversation(channel, from);
      if (!gone) return "none";
      const kept = repo.byConversation(channel, to);
      if (!kept) {
        repo.readdress(channel, from, to);
        return "joined";
      }
      if (repo.busy([gone.id, kept.id])) return "busy";
      const theirs = repo.context(gone.id).their_last;
      const keptTheirs = repo.context(kept.id).their_last;
      const ids = all(
        qb
          .selectFrom("messages")
          .select("id")
          .where("thread_id", "in", [gone.id, kept.id])
          .orderBy("created_at")
          .orderBy("seq"),
      ).map((r) => r.id);
      // Negative first, so no two messages ever share a place in the kept chat while they are renumbered.
      for (const [i, id] of ids.entries())
        run(
          qb
            .updateTable("messages")
            .set({ thread_id: kept.id, seq: -(i + 1) })
            .where("id", "=", id),
        );
      run(
        qb
          .updateTable("messages")
          .set((eb) => ({ seq: eb.neg(eb.ref("seq")) }))
          .where("thread_id", "=", kept.id)
          .where("seq", "<", 0),
      );
      // What the model saw and what the agent remembers of it go too: the next turn goes on from both chats.
      joinModelLogs({ all, run }, gone.id, kept.id);
      moveChatRows({ one, run }, { id: gone.id, address: from }, { id: kept.id, address: to });
      run(qb.updateTable("threads").set({ parent_id: kept.id }).where("parent_id", "=", gone.id));
      // A summary counts places in the kept chat's old order: it is made again from the whole history.
      repo.mergeContext(kept.id, {
        compaction: undefined,
        // Their last message is the newer chat's, so a reaction goes on what they said last.
        ...(theirs && (!keptTheirs || gone.updated_at > kept.updated_at)
          ? { their_last: { ...theirs, conversation: to } }
          : {}),
      });
      const newer = gone.updated_at > kept.updated_at;
      run(
        qb
          .updateTable("threads")
          .set({
            unread: kept.unread + gone.unread,
            ...(newer ? { updated_at: gone.updated_at, preview: gone.preview } : {}),
          })
          .where("id", "=", kept.id),
      );
      repo.remove([gone.id]);
      bus.emit({ type: "thread.updated", thread: repo.get(kept.id) as Thread });
      return "joined";
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
    /**
     * A channel's chats still answered by `from` go to `to` and its project: the owner's own chats (`owners`) or those of
     * its contacts and rooms. A chat handed to another agent keeps it; past messages keep their authors.
     */
    moveAnswerer(o: {
      channel: string;
      owner: string;
      owners: boolean;
      from: string;
      to: string;
      /** The project of `to`; a chat takes it only while it is in `fromProject` (the owner may have moved it). */
      project?: string | undefined;
      fromProject?: string | undefined;
    }) {
      for (const r of all(qb.selectFrom("threads").selectAll().where("channel", "=", o.channel))) {
        const t = toThread(r);
        if ((t.channel?.person_id === o.owner) !== o.owners || t.agent_ids[0] !== o.from) continue;
        repo.write(t.id, {
          agent_ids: JSON.stringify([o.to, ...t.agent_ids.filter((a) => a !== o.from && a !== o.to)]),
          ...(t.project_id === o.fromProject ? { project_id: o.project ?? null } : {}),
        });
      }
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
    busy(ids: string[], exceptRun?: string): boolean {
      const run = one(
        qb
          .selectFrom("runs")
          .select("id")
          .where("thread_id", "in", ids)
          .where("id", "!=", exceptRun ?? "")
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
