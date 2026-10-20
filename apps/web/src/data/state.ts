import type {
  Agent,
  BaseProject,
  EngineStatus,
  Health,
  Job,
  Message,
  Project,
  Run,
  Surface,
  SurfaceState,
  SurfaceSummary,
  TabInfo,
  Thread,
} from "@apx/protocol";
import { useMemo } from "react";
import { createStore, useSlice } from "./createStore.ts";

export type Connection = "connecting" | "online" | "offline";
export type LoadState = "loading" | "ready" | "error";
/** `unavailable` = this core does not answer engines.* yet (older build): the UI explains instead of failing. */
export type EnginesLoad = "idle" | "loading" | "ready" | "unavailable";

export type DataState = {
  connection: Connection;
  /** Last connection/bootstrap error, for the offline banner. */
  error: string | undefined;
  /** First bootstrap finished (agents, projects, threads, surfaces). */
  ready: boolean;
  agents: Record<string, Agent>;
  /** Agents archived or deleted: only so the chats they spoke in show their name and face. */
  former: Record<string, Agent>;
  projects: Project[];
  /** The base project's name, description and kind, as the owner set them. */
  base: BaseProject;
  threads: Record<string, Thread>;
  /** How many chats each chat delegated, as the core counted them when the list loaded. */
  delegated: Record<string, number>;
  /** Messages per thread, ordered by seq. Only threads opened in this session are present. */
  messages: Record<string, Message[]>;
  threadLoad: Record<string, LoadState>;
  runs: Record<string, Run>;
  surfaces: Record<string, SurfaceSummary>;
  /** Full surface documents (html), fetched on demand; without their state, which changes apart. */
  surfaceDocs: Record<string, Surface>;
  /** What each open surface remembers (APX.state), kept live by surface.state events. */
  surfaceStates: Record<string, SurfaceState>;
  tabs: TabInfo[];
  /** Agent engines (native / Claude Code / Codex): installed → logged in → default. */
  engines: EngineStatus[];
  enginesLoad: EnginesLoad;
  /** Last system.health answer (Settings › Advanced). */
  health: Health | undefined;
  /** Background view: running work and the latest finished background runs (jobs.list). */
  jobs: { running: Job[]; finished: Job[] };
};

export const data = createStore<DataState>({
  connection: "connecting",
  error: undefined,
  ready: false,
  agents: {},
  former: {},
  projects: [],
  base: { name: "Default" },
  threads: {},
  delegated: {},
  messages: {},
  threadLoad: {},
  runs: {},
  surfaces: {},
  surfaceDocs: {},
  surfaceStates: {},
  tabs: [],
  engines: [],
  enginesLoad: "idle",
  health: undefined,
  jobs: { running: [], finished: [] },
});

export function useData<T>(select: (s: DataState) => T): T {
  return useSlice(data, select);
}

/**
 * Agents to name and show in chats and lists: today's, plus the archived or deleted ones their old chats still
 * speak with. Never for pickers or sending: a former agent cannot be asked anything.
 */
export function useShownAgents(): Record<string, Agent> {
  const agents = useData((s) => s.agents);
  const former = useData((s) => s.former);
  return useMemo(() => ({ ...former, ...agents }), [agents, former]);
}

/** Insert or replace a message, keeping seq order and dropping optimistic placeholders it supersedes. */
export function upsertMessage(list: Message[] | undefined, msg: Message): Message[] {
  const base = (list ?? []).filter((m) => m.id !== msg.id);
  base.push(msg);
  base.sort((a, b) => a.seq - b.seq);
  return base;
}
