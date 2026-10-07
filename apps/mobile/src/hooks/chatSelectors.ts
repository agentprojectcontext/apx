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

export function chatAgents(agents: Agent[], projectId?: string): Agent[] {
  const secretary = agents.filter((agent) => agent.kind === "secretary");
  const own = agents
    .filter((agent) => agent.kind !== "secretary" && (projectId ? agent.project_id === projectId : !agent.project_id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...secretary, ...own];
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
