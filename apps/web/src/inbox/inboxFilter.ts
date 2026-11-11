import type { Project, Thread } from "@apx/protocol";
import { createStore, useSlice } from "../data/createStore.ts";
import { DEFAULT_PID, inProject } from "../data/identity.ts";

/**
 * Who and where the Inbox narrows to: any of the agents, the projects (a project takes its subprojects), the channel
 * accounts, the channel apps (WhatsApp, Telegram…) and the outside engines (Claude Code, Codex…).
 */
export type InboxFilter = {
  agents: string[];
  projects: string[];
  accounts: string[];
  channels: string[];
  engines: string[];
};
export type FilterKind = keyof InboxFilter;

const EMPTY: InboxFilter = { agents: [], projects: [], accounts: [], channels: [], engines: [] };
const FILTER_KINDS = Object.keys(EMPTY) as FilterKind[];

const store = createStore<InboxFilter>(EMPTY);
export const useInboxFilter = <T>(select: (s: InboxFilter) => T): T => useSlice(store, select);

export function toggleFilter(kind: FilterKind, id: string): void {
  store.set((s) => ({ [kind]: s[kind].includes(id) ? s[kind].filter((x) => x !== id) : [...s[kind], id] }));
}

/** The Inbox narrowed to this one alone (a channel account or an engine picked in the sidebar). */
export function onlyFilter(kind: FilterKind, id: string): void {
  store.set({ ...EMPTY, [kind]: [id] });
}

export function clearFilter(): void {
  store.set(EMPTY);
}

/** How many things the filter holds, of every kind. */
export const filterCount = (f: InboxFilter): number => FILTER_KINDS.reduce((n, k) => n + f[k].length, 0);

/** The one thing the filter holds, when it holds exactly one. */
export function soleFilter(f: InboxFilter): { kind: FilterKind; id: string } | undefined {
  if (filterCount(f) !== 1) return undefined;
  const kind = FILTER_KINDS.find((k) => f[k].length === 1);
  const id = kind && f[kind][0];
  return kind && id ? { kind, id } : undefined;
}

/**
 * Whether a chat passes the filter: each kind chosen must match (any of its picks); nothing chosen of a kind lets
 * every chat through for that kind. `kindOf` names a channel account's app ("whatsapp") for the channels kind.
 */
export function passesFilter(
  thread: Thread,
  f: InboxFilter,
  projects: readonly Project[],
  kindOf: (account: string) => string | undefined = () => undefined,
): boolean {
  const agentOk = !f.agents.length || thread.agent_ids.some((id) => f.agents.includes(id));
  const projectOk =
    !f.projects.length ||
    f.projects.some((pid) => {
      if (inProject(thread, pid)) return true;
      // A project's subprojects are part of it here.
      const own = projects.find((p) => p.id === thread.project_id);
      return Boolean(own?.parent) && (own?.parent === pid || (pid === DEFAULT_PID && own?.parent === DEFAULT_PID));
    });
  const account = thread.channel?.id;
  const accountOk = !f.accounts.length || (!!account && f.accounts.includes(account));
  const app = account ? kindOf(account) : undefined;
  const channelOk = !f.channels.length || (!!app && f.channels.includes(app));
  const engineOk = !f.engines.length || (!!thread.engine && f.engines.includes(thread.engine));
  return agentOk && projectOk && accountOk && channelOk && engineOk;
}
