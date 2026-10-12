import { type Key, t } from "../i18n/index.ts";
import type { Agent, Job, Thread, Workspace } from "./useWorkspace";

type Translate = (key: Key, vars?: Record<string, string | number>) => string;

/** Matches the web's data/identity and NewChatMenu selection rules. */
export function isWorking(state?: string): boolean {
  return state === "submitted" || state === "working";
}

export function activeThreads(threads: Thread[]): Thread[] {
  return threads
    .filter((thread) => isWorking(thread.state) || thread.state === "input-required")
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

/** A chat's name in a list: a routine run's is what it told (its routine shows under it). */
export function chatTitle(thread: Thread): string {
  if (thread.kind !== "routine") return thread.title;
  const said = thread.preview.split("\n").find((line) => line.trim()) ?? "";
  return said.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "") || routineName(thread);
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

/** What is going on right now: each active conversation with the job doing it, if one is running. */
export function workingNow(threads: Thread[], jobs: Job[]): Array<{ thread: Thread; job?: Job }> {
  return activeThreads(threads).map((thread) => ({
    thread,
    job: jobs.find((job) => job.thread_id === thread.id && job.kind === "agent"),
  }));
}
