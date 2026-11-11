import type { Thread } from "@apx/protocol";
import { inInbox, inProject, isTopLevel } from "../data/identity.ts";

/** `routines`: routine runs that told something are listed too. */
type Filter = { projectId?: string; query?: string; routines?: boolean };

/** A chat an agent delegated: it hangs under the chat it came from. */
const isDelegated = (t: Thread) => t.kind === "a2a" && !!t.parent_id && !t.archived;

const delegatedCache = new WeakMap<Record<string, Thread>, Map<string, Thread[]>>();

/** Each chat's delegated chats, newest first (one pass per threads snapshot, shared by every row). */
export function delegatedByChat(threads: Record<string, Thread>): Map<string, Thread[]> {
  const cached = delegatedCache.get(threads);
  if (cached) return cached;
  const out = new Map<string, Thread[]>();
  for (const t of Object.values(threads))
    if (isDelegated(t)) out.set(t.parent_id as string, [...(out.get(t.parent_id as string) ?? []), t]);
  for (const list of out.values()) list.sort(newest);
  delegatedCache.set(threads, out);
  return out;
}

/**
 * A delegated chat listed on its own: its caller is not loaded, or (in a project's list) the caller is outside that
 * project while the delegated chat works in it. Anywhere else it only shows under its caller.
 */
export function standsAlone(t: Thread, threads: Record<string, Thread>, projectId?: string): boolean {
  if (!isDelegated(t)) return false;
  const parent = threads[t.parent_id as string];
  if (!parent) return true;
  return !!projectId && inProject(t, projectId) && !inProject(parent, projectId);
}

/** Top-level chats the Inbox shows; a chat's delegated chats hang under it (`delegatedByChat`). */
function visible(
  threads: Record<string, Thread>,
  opts: Filter,
  keep: (t: Thread) => boolean = (t) => inInbox(t, !!opts.routines) || standsAlone(t, threads, opts.projectId),
): Thread[] {
  const q = opts.query?.trim().toLowerCase();
  return Object.values(threads).filter(
    (t) =>
      keep(t) &&
      (!opts.projectId || inProject(t, opts.projectId)) &&
      (!q || `${t.title} ${t.preview}`.toLowerCase().includes(q)),
  );
}

const newest = (a: Thread, b: Thread) => b.updated_at.localeCompare(a.updated_at);

/** Within a group: pinned chats first, then the most recent. */
export const pinnedFirst = (a: Thread, b: Thread) => Number(!!b.pinned) - Number(!!a.pinned) || newest(a, b);

/** Every chat a list shows: its rows and the delegated chats under them (what "Mark all as read" reads). */
export function listedThreads(threads: Record<string, Thread>, opts: Filter): Thread[] {
  const nested = delegatedByChat(threads);
  const seen = new Set<string>();
  const out: Thread[] = [];
  const pending = [...visible(threads, opts)].reverse();
  while (pending.length) {
    const t = pending.pop();
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    pending.push(...[...(nested.get(t.id) ?? [])].reverse());
  }
  return out;
}

/** The Inbox's rows, pinned first then newest: each chat on its own, each task's and each routine's chats bundled. */
export function inboxEntries(threads: Record<string, Thread>, opts: Filter): ListEntry[] {
  return bundleTasks(visible(threads, opts).sort(pinnedFirst));
}

/** What "Mark all as read" reads: the unread chats the list shows, delegated ones under them included. */
export const unreadListed = (threads: Record<string, Thread>, opts: Filter): string[] =>
  listedThreads(threads, opts)
    .filter((t) => t.unread > 0)
    .map((t) => t.id);

/** The unread among `roots` and the chats delegated under them (one tab's or one section's "Mark all as read"). */
export function unreadUnder(threads: Record<string, Thread>, roots: readonly Thread[]): string[] {
  const nested = delegatedByChat(threads);
  const seen = new Set<string>();
  const out: string[] = [];
  const pending = [...roots];
  while (pending.length) {
    const t = pending.pop();
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.unread > 0) out.push(t.id);
    pending.push(...(nested.get(t.id) ?? []));
  }
  return out;
}

/** Every unread chat `keep` takes, archived ones too: what a sidebar row counts (a channel account, an engine). */
export const unreadWhere = (threads: Record<string, Thread>, keep: (t: Thread) => boolean): string[] =>
  Object.values(threads)
    .filter((t) => t.unread > 0 && keep(t))
    .map((t) => t.id);

/** The archived chats, most recent first: shown apart, under Archived. */
export function archivedThreads(threads: Record<string, Thread>, opts: Filter): Thread[] {
  return visible(threads, opts, (t) => !!t.archived && isTopLevel(t)).sort(newest);
}

/** A row of a chat list: a chat, or (`task`) every chat the agents keep for one task, together. */
export type ListEntry =
  | { kind: "thread"; thread: Thread }
  | { kind: "task"; taskId: string; threads: Thread[] }
  | { kind: "routine"; routineId: string; threads: Thread[] };

/** Chats agents keep for a task go together, where the task's most recent one would be; the rest stay as they are. */
export function bundleTasks(list: Thread[]): ListEntry[] {
  const out: ListEntry[] = [];
  const tasks = new Map<string, Extract<ListEntry, { kind: "task" }>>();
  const routines = new Map<string, Extract<ListEntry, { kind: "routine" }>>();
  for (const thread of list) {
    if (thread.kind === "routine" && thread.routine_id) {
      const bundle = routines.get(thread.routine_id);
      if (bundle) bundle.threads.push(thread);
      else {
        const entry = { kind: "routine" as const, routineId: thread.routine_id, threads: [thread] };
        routines.set(thread.routine_id, entry);
        out.push(entry);
      }
      continue;
    }
    if (!thread.task_id) {
      out.push({ kind: "thread", thread });
      continue;
    }
    const bundle = tasks.get(thread.task_id);
    if (bundle) bundle.threads.push(thread);
    else {
      const entry = { kind: "task" as const, taskId: thread.task_id, threads: [thread] };
      tasks.set(thread.task_id, entry);
      out.push(entry);
    }
  }
  return out;
}

/** A row of the Chats tab: a chat, or (`channel`) every chat on one channel account, together. */
export type ChatEntry = { kind: "thread"; thread: Thread } | { kind: "channel"; account: string; threads: Thread[] };

/** Chats on a channel account go together, where the account's most recent one would be; the rest stay as they are. */
export function bundleChannels(list: readonly Thread[]): ChatEntry[] {
  const out: ChatEntry[] = [];
  const accounts = new Map<string, Extract<ChatEntry, { kind: "channel" }>>();
  for (const thread of list) {
    const account = thread.channel?.id;
    if (!account) {
      out.push({ kind: "thread", thread });
      continue;
    }
    const bundle = accounts.get(account);
    if (bundle) bundle.threads.push(thread);
    else {
      const entry = { kind: "channel" as const, account, threads: [thread] };
      accounts.set(account, entry);
      out.push(entry);
    }
  }
  return out;
}

/** The agents that took part in a task: those the core counts (its agent, chats, teammates asked) and its chats'. */
export function tookPart(agents: readonly string[] | undefined, threads: readonly Thread[]): Set<string> {
  return new Set([...(agents ?? []), ...threads.flatMap((th) => th.agent_ids[0] ?? [])]);
}
