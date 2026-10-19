import { type Key, t } from "../i18n/index.ts";
import type { Agent, Job, Thread, Workspace } from "./useWorkspace";

type Translate = (key: Key, vars?: Record<string, string | number>) => string;

/** Matches the web's data/identity and NewChatMenu selection rules. */
export function isWorking(state?: string): boolean {
  return state === "submitted" || state === "working";
}

/** What a delegation card or session row shows for a run's state: a queued one is neither in progress nor done. */
export type StateMark = "queued" | "working" | "failed" | "done";

export function stateMark(state?: string): StateMark {
  if (state === "queued") return "queued";
  if (isWorking(state)) return "working";
  return state === "failed" ? "failed" : "done";
}

export function activeThreads(threads: Thread[]): Thread[] {
  return threads
    .filter((thread) => !thread.archived && (isWorking(thread.state) || thread.state === "input-required"))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function listedThreads(threads: Thread[]): Thread[] {
  return threads
    .filter((thread) => !thread.archived && !thread.parent_id && !["a2a", "task", "routine"].includes(thread.kind))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updated_at.localeCompare(a.updated_at));
}

/**
 * What Chats lists: the chats, and with `routines` the routine runs that told something, like the web's Inbox (a quiet
 * run is archived; one still running waits until it has said it).
 */
export function inboxThreads(threads: Thread[], routines: boolean): Thread[] {
  if (!routines) return listedThreads(threads);
  const runs = threads.filter(
    (thread) => thread.kind === "routine" && !thread.archived && !thread.parent_id && !isWorking(thread.state),
  );
  return [...listedThreads(threads), ...runs].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updated_at.localeCompare(a.updated_at),
  );
}

/** A routine run's chat is titled "<routine> · <when>". */
export const routineName = (thread: Pick<Thread, "title">): string => thread.title.split(" · ")[0] ?? thread.title;

const plain = (line: string) => line.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "").trim();

/** A routine run's words as a title (its first line, or that line's first sentence) and what follows it. */
function splitTold(preview: string): [string, string] {
  const lines = preview.split("\n").map(plain).filter(Boolean);
  const [first = "", ...rest] = lines;
  const cut = first.search(/[.!?](\s|$)/);
  if (cut > 0 && cut < first.length - 1)
    return [first.slice(0, cut + 1), [first.slice(cut + 1).trim(), ...rest].join(" ")];
  return [first, rest.join(" ")];
}

/** A chat's name in a list: a routine run's is the first thing it told, or its routine's name when it told one thing. */
export function chatTitle(thread: Thread): string {
  if (thread.kind !== "routine") return thread.title;
  const [title, rest] = splitTold(thread.preview);
  return rest ? title : routineName(thread);
}

/** A chat's second line: what was said last; a routine run's goes on after its title (all of it when it is short). */
export function chatPreview(thread: Thread): string {
  if (thread.kind !== "routine") return thread.preview;
  const [title, rest] = splitTold(thread.preview);
  return rest || title;
}

export function chatAgents(agents: Agent[], projectId?: string): Agent[] {
  const secretary = agents.filter((agent) => agent.kind === "secretary");
  const own = agents
    .filter((agent) => agent.kind !== "secretary" && (projectId ? agent.project_id === projectId : !agent.project_id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...secretary, ...own];
}

/** Agents the owner talked to lately, shown first in "New chat". */
const RECENT = 5;

/** Lowercase without accents, so "sao" finds "São". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * "New chat"'s agents, like the web's: in a project, its own and the super-agent; otherwise every project's (base
 * ones first). Every word of the query is in the name, role or project; with no query the recent ones come apart.
 */
export function pickAgents(
  agents: Agent[],
  threads: Thread[],
  o: { projectId?: string | undefined; query: string; projectName: (id: string) => string },
): { recent: Agent[]; rest: Agent[] } {
  const where = (a: Agent) => (a.project_id ? o.projectName(a.project_id) : "");
  const pool = o.projectId
    ? chatAgents(agents, o.projectId)
    : [...agents].sort(
        (a, b) =>
          Number(b.kind === "secretary") - Number(a.kind === "secretary") ||
          where(a).localeCompare(where(b)) ||
          a.name.localeCompare(b.name),
      );
  const words = fold(o.query).split(/\s+/).filter(Boolean);
  if (words.length) {
    const hay = (a: Agent) => fold(`${a.name} ${a.role ?? ""} ${a.description ?? ""} ${where(a)}`);
    return { recent: [], rest: pool.filter((a) => words.every((w) => hay(a).includes(w))) };
  }
  const offered = new Map(pool.map((a) => [a.id, a]));
  const recent: Agent[] = [];
  for (const thread of listedThreads(threads)) {
    if (thread.engine || (o.projectId && thread.project_id !== o.projectId)) continue;
    const agent = offered.get(thread.agent_ids[0] ?? "");
    if (agent && !recent.includes(agent)) recent.push(agent);
    if (recent.length === RECENT) break;
  }
  return { recent, rest: pool.filter((a) => !recent.includes(a)) };
}

const CHANNEL_NAMES: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
  slack: "Slack",
};
const ENGINE_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

/** A channel type's product name ("WhatsApp"); unknown ones keep their id. */
export function channelName(type: string): string {
  return CHANNEL_NAMES[type] ?? type;
}

/** An outside engine's product name ("Claude Code"); unknown ones keep their id. */
export function engineName(engine: string): string {
  return ENGINE_NAMES[engine] ?? engine;
}

/** The line under a chat's preview: its project, then where it happens (a channel, an engine, a group, the app). */
export function threadContext(
  thread: Thread,
  data: Pick<Workspace, "projects" | "channels">,
  tr: Translate = t,
): string {
  const project = data.projects.find((item) => item.id === thread.project_id)?.name ?? tr("defaultProject");
  const channel = thread.channel && data.channels.find((item) => item.id === thread.channel?.id);
  if (thread.kind === "routine") return `${project} · ${tr("routineOf", { name: routineName(thread) })}`;
  const where = thread.channel
    ? (CHANNEL_NAMES[channel?.type ?? ""] ?? channel?.label ?? thread.channel.id)
    : thread.engine
      ? engineName(thread.engine)
      : thread.agent_ids.length > 1
        ? tr("groupOf", { n: thread.agent_ids.length })
        : tr("inApp");
  return `${project} · ${where}`;
}

/**
 * A working chat's second line under its agent's name: what the chat is about, or where it is when its title is
 * only that name again.
 */
export function workSubject(
  thread: Thread,
  who: string,
  data: Pick<Workspace, "projects" | "channels">,
  tr: Translate = t,
): string {
  const about = chatTitle(thread).trim();
  return about && about.toLowerCase() !== who.trim().toLowerCase() ? about : threadContext(thread, data, tr);
}

/** What is going on right now: each active conversation with the job doing it, if one is running. */
export function workingNow(threads: Thread[], jobs: Job[]): Array<{ thread: Thread; job?: Job }> {
  return activeThreads(threads).map((thread) => ({
    thread,
    job: jobs.find((job) => job.thread_id === thread.id && job.kind === "agent"),
  }));
}

/** A row of the chat list: a chat, or (`task`) every chat the agents keep for one task, together. */
export type ChatEntry = { kind: "thread"; thread: Thread } | { kind: "task"; taskId: string; threads: Thread[] };

/** Chats agents keep for a task go together, where the task's most recent one would be; the rest stay as they are. */
export function bundleTasks(list: Thread[]): ChatEntry[] {
  const out: ChatEntry[] = [];
  const tasks = new Map<string, Extract<ChatEntry, { kind: "task" }>>();
  for (const thread of list) {
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
