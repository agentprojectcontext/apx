import { useCallback, useEffect, useState } from "react";
import { APP_CLIENT } from "../appInfo";
import type { Creds } from "../creds";
import { t } from "../i18n";
import { showLiveNotice } from "../notifications";
import {
  ApxClient,
  type ApxSocket,
  type CoreEvent,
  type NoticePrefs,
  type RoutineRun,
  type Schedule,
} from "../protocol";

export type Agent = {
  id: string;
  name: string;
  description?: string;
  blob?: string;
  kind?: "secretary" | "agent";
  role?: string;
  project_id?: string;
  model_choice?: { model?: string; router: boolean };
};
export type Project = {
  id: string;
  name: string;
  description?: string;
  blob?: string;
  path?: string;
  registered?: boolean;
};
export type Thread = {
  id: string;
  kind: string;
  title: string;
  agent_ids: string[];
  project_id?: string;
  parent_id?: string;
  archived?: boolean;
  pinned?: boolean;
  engine?: string;
  channel?: { id: string; conversation: string };
  state: string;
  preview: string;
  unread: number;
  updated_at: string;
};
export type Task = {
  id: string;
  title: string;
  status: string;
  state: string;
  kind: "task" | "commitment" | "errand";
  priority: string;
  assignee?: string;
  project_id?: string;
  thread_id: string;
  due_at?: string;
  awaits_owner: boolean;
  activity_at: string;
};
export type Notice = {
  id: string;
  /** "run": a chat or session ended (or failed) while unread; kinds a newer core adds read as plain notices. */
  kind: "input" | "task" | "due" | "routine" | "channel" | "agent" | "run" | (string & {});
  level: string;
  title: string;
  body: string;
  thread_id?: string;
  ref?: string;
  created_at: string;
  read_at?: string;
};
export type PendingInput = {
  id: string;
  run_id: string;
  thread_id: string;
  agent_id: string;
  kind: "confirm" | "question";
  prompt: string;
  detail?: string;
  options?: string[];
  state: string;
};
export type Routine = {
  id: string;
  name: string;
  enabled: boolean;
  agent_id: string;
  project_id?: string;
  schedule: Schedule;
  action: string;
  prompt: string;
  pre_command?: string;
  post_command?: string;
  call_model: string;
  anchor: boolean;
  next_run_at?: string;
  last_run_at?: string;
  last?: { run_id: string; thread_id: string; state: string; started_at: string; delivered?: boolean };
};
/** A channel (Telegram bot, WhatsApp line…) as the phone lists it. */
export type Channel = { id: string; type: string; label: string; enabled: boolean; agent_id: string };
/** One running or finished piece of work, as jobs.list gives it. */
export type Job = {
  id: string;
  kind: "agent" | "terminal";
  title: string;
  state: string;
  thread_id: string;
  parent_thread_id?: string;
  agent_id?: string;
  started_at: string;
  ended_at?: string;
};
/** A note the office remembers: for everyone (global), one project, or one agent. */
export type Memory = {
  id: string;
  scope: "global" | "project" | "agent";
  project_id?: string;
  agent_id?: string;
  text: string;
  source: "owner" | "agent";
  author_agent?: string;
  tainted: boolean;
  updated_at: string;
};
export type MemoryQuery = { query?: string; scope?: Memory["scope"]; project?: string; limit?: number };
export type Health = {
  version: string;
  code_sha: string;
  started_at: string;
  uptime_s: number;
  rss_mb?: number;
  subsystems: Record<string, { status: "ok" | "degraded" | "down" | "off"; detail?: string }>;
};
export type FileEntry = { name: string; path: string; kind: "dir" | "file"; bytes?: number };
export type Engine = { id: string; label: string; installed: boolean; logged_in: boolean; detail?: string };
export type NativeSession = { id: string; title: string; cwd: string; updated_at: string };
export type Workspace = {
  threads: Thread[];
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  notices: Notice[];
  unread: number;
  inputs: PendingInput[];
  routines: Routine[];
  engines: Engine[];
  sessions: Record<string, NativeSession[]>;
  jobs: { running: Job[] };
  channels: Channel[];
  /** How many notes the office remembers (memory.settings), when known. */
  memories?: number;
  /** The owner's name as set in APX ("" until loaded or when unset). */
  owner: string;
};

export const emptyWorkspace: Workspace = {
  threads: [],
  projects: [],
  agents: [],
  tasks: [],
  notices: [],
  unread: 0,
  inputs: [],
  routines: [],
  engines: [],
  sessions: {},
  jobs: { running: [] },
  channels: [],
  owner: "",
};

async function rpc<T>(client: ApxClient, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return (await client.call(method as never, params as never)) as T;
}

export function useWorkspace(creds: Creds) {
  const [client] = useState(() => new ApxClient({ url: creds.url, token: creds.token, client: APP_CLIENT }));
  const [data, setData] = useState(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");

  const loadPrimary = useCallback(async () => {
    try {
      const r = await rpc<{ threads: Thread[] }>(client, "threads.list", {
        include_subthreads: true,
        include_archived: true,
      });
      setData((d) => ({
        ...d,
        threads: r.threads ?? [],
      }));
      setOnline(true);
      setError("");
      setLoading(false);
    } catch (e) {
      setOnline(false);
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [client]);

  const loadSecondary = useCallback(async () => {
    const get = <T>(method: string, params?: Record<string, unknown>) =>
      rpc<T>(client, method, params).catch(() => undefined);
    const [projects, agents, open, done, dropped, inbox, pending, routines, engines, jobs, owner, channels, memory] =
      await Promise.all([
        get<{ projects: Project[] }>("projects.list", { include_unregistered: true }),
        get<{ agents: Agent[] }>("agents.list", {}),
        get<{ tasks: Task[] }>("tasks.list", { state: "open", limit: 200 }),
        get<{ tasks: Task[] }>("tasks.list", { state: "done", limit: 25 }),
        get<{ tasks: Task[] }>("tasks.list", { state: "dropped", limit: 25 }),
        get<{ notifications: Notice[]; unread: number }>("notifications.list", { limit: 100 }),
        get<{ inputs: PendingInput[] }>("runs.pending", {}),
        get<{ routines: Routine[] }>("routines.list", {}),
        get<{ engines: Engine[] }>("engines.status", {}),
        get<Workspace["jobs"]>("jobs.list", { finished: 12 }),
        get<{ name: string }>("owner.get", {}),
        get<{ channels: Channel[] }>("channels.list", {}),
        get<{ total: number }>("memory.settings", {}),
      ]);
    // Each engine's sessions, or undefined where the list did not load (it keeps the one it had).
    let native: Array<[string, NativeSession[] | undefined]> | undefined;
    if (engines?.engines) {
      const installed = engines.engines.filter((engine) => engine.installed && ["claude", "codex"].includes(engine.id));
      const lists = await Promise.all(
        installed.map((engine) =>
          get<{ sessions: NativeSession[] }>("sessions.native", { engine: engine.id, limit: 100 }),
        ),
      );
      native = installed.map((engine, i) => [engine.id, lists[i]?.sessions]);
    }
    setData((d) => ({
      ...d,
      projects: projects?.projects ?? d.projects,
      agents: agents?.agents ?? d.agents,
      tasks: open ? [...open.tasks, ...(done?.tasks ?? []), ...(dropped?.tasks ?? [])] : d.tasks,
      notices: inbox?.notifications ?? d.notices,
      unread: inbox?.unread ?? d.unread,
      inputs: pending?.inputs ?? d.inputs,
      routines: routines?.routines ?? d.routines,
      engines: engines?.engines ?? d.engines,
      sessions: native
        ? Object.fromEntries(native.map(([id, list]) => [id, list ?? d.sessions[id] ?? []]))
        : d.sessions,
      jobs: jobs ?? d.jobs,
      owner: owner?.name ?? d.owner,
      channels: channels?.channels ?? d.channels,
      memories: memory?.total ?? d.memories,
    }));
  }, [client]);

  const refresh = useCallback(async () => {
    await loadPrimary();
    await loadSecondary();
  }, [loadPrimary, loadSecondary]);

  useEffect(() => {
    void loadPrimary();
    void loadSecondary();
    const timer = setInterval(() => {
      void loadPrimary();
      void loadSecondary();
    }, 30_000);
    return () => clearInterval(timer);
  }, [loadPrimary, loadSecondary]);

  useEffect(() => {
    let socket: ApxSocket | undefined;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const connect = async (): Promise<void> => {
      try {
        socket = await client.connect();
        attempt = 0;
        setOnline(true);
        socket.onEvent((frame) => {
          if (stopped || frame.stream !== "core") return;
          const event = frame.payload as CoreEvent;
          if (event.type === "notification.updated") {
            void showLiveNotice(event.notification, creds.device).catch((error) => setError(String(error)));
          }
          if (event.type === "thread.updated") {
            setData((current) => ({
              ...current,
              threads: [...current.threads.filter((thread) => thread.id !== event.thread.id), event.thread],
            }));
          } else if (event.type === "thread.deleted") {
            const deleted = new Set([event.thread_id, ...event.children]);
            setData((current) => ({
              ...current,
              threads: current.threads.filter((thread) => !deleted.has(thread.id)),
            }));
          } else if (event.type === "message.created" || event.type === "message.updated") {
            const preview = event.message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(" ");
            if (preview)
              setData((current) => ({
                ...current,
                threads: current.threads.map((thread) =>
                  thread.id === event.message.thread_id
                    ? { ...thread, preview, updated_at: event.message.created_at }
                    : thread,
                ),
              }));
          }
          // Throttle rather than resetting on every streamed token, which can starve updates.
          if (!syncTimer)
            syncTimer = setTimeout(() => {
              syncTimer = undefined;
              void refresh();
            }, 500);
        });
        await refresh();
        await socket.closed;
        if (!stopped) setOnline(false);
      } catch {
        setOnline(false);
      }
      if (!stopped) {
        const delays = [1000, 2000, 5000, 10000];
        retryTimer = setTimeout(() => void connect(), delays[Math.min(attempt++, delays.length - 1)]);
      }
    };
    void connect();
    return () => {
      stopped = true;
      socket?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (syncTimer) clearTimeout(syncTimer);
    };
  }, [client, refresh, creds.device]);

  const openThread = useCallback(
    async (threadId: string) => {
      try {
        await rpc(client, "threads.read", { thread: threadId });
      } catch {
        /* Read state can wait for the next sync. */
      }
      return rpc<{ thread: Thread; messages: import("../protocol").Message[]; runs: unknown[] }>(
        client,
        "threads.get",
        { thread: threadId },
      );
    },
    [client],
  );

  const readNotice = useCallback(
    async (notice: Notice) => {
      await rpc(client, "notifications.read", { ids: [notice.id] }).catch(() => undefined);
      setData((d) => ({
        ...d,
        unread: Math.max(0, d.unread - (notice.read_at ? 0 : 1)),
        notices: d.notices.map((n) => (n.id === notice.id ? { ...n, read_at: new Date().toISOString() } : n)),
      }));
    },
    [client],
  );

  const respond = useCallback(
    async (input: string, response: { decision?: "approve" | "deny"; text?: string }) => {
      await rpc(client, "runs.respond", { input, ...response });
      await loadSecondary();
    },
    [client, loadSecondary],
  );

  const toggleRoutine = useCallback(
    async (routine: Routine, enabled: boolean) => {
      await rpc(client, "routines.set", {
        id: routine.id,
        name: routine.name,
        agent: routine.agent_id,
        project: routine.project_id,
        schedule: routine.schedule,
        action: routine.action,
        prompt: routine.prompt,
        pre_command: routine.pre_command,
        post_command: routine.post_command,
        call_model: routine.call_model,
        anchor: routine.anchor,
        enabled,
      });
      await loadSecondary();
    },
    [client, loadSecondary],
  );

  const runRoutine = useCallback(
    async (routineId: string) => {
      await rpc(client, "routines.run", { routine: routineId });
      await loadSecondary();
    },
    [client, loadSecondary],
  );

  const routineRuns = useCallback(
    async (routineId: string, limit = 14) =>
      (await rpc<{ runs: RoutineRun[] }>(client, "routines.runs", { routine: routineId, limit })).runs,
    [client],
  );

  const memories = useCallback(
    async (params: MemoryQuery) =>
      (await rpc<{ memories: Memory[] }>(client, "memory.list", { limit: 100, ...params })).memories,
    [client],
  );
  const addMemory = useCallback(
    async (text: string, project?: string) => {
      const memory = await rpc<Memory>(
        client,
        "memory.add",
        project ? { text, scope: "project", project } : { text, scope: "global" },
      );
      setData((d) => ({ ...d, memories: (d.memories ?? 0) + 1 }));
      return memory;
    },
    [client],
  );
  const removeMemory = useCallback(
    async (id: string) => {
      await rpc(client, "memory.remove", { id });
      setData((d) => ({ ...d, memories: Math.max(0, (d.memories ?? 1) - 1) }));
    },
    [client],
  );

  const fileTree = useCallback(
    async (project: string, dir: string) =>
      rpc<{ entries: FileEntry[]; truncated: boolean }>(client, "files.tree", { project, dir }),
    [client],
  );
  const readFile = useCallback(
    async (project: string, path: string) =>
      rpc<{ path: string; bytes: number; binary: boolean; truncated: boolean; text?: string }>(client, "files.read", {
        project,
        path,
      }),
    [client],
  );
  const fileMedia = useCallback(
    async (project: string, path: string) =>
      rpc<{ mime: string; data: string; bytes: number }>(client, "files.media", { project, path }),
    [client],
  );

  /** What `apx status` tells about the core, plus how many devices are paired. */
  const serverInfo = useCallback(async () => {
    const [health, devices] = await Promise.all([
      rpc<Health>(client, "system.health", {}),
      rpc<{ devices: unknown[] }>(client, "devices.list", {}).catch(() => undefined),
    ]);
    return { health, devices: devices?.devices.length };
  }, [client]);

  const noticePrefs = useCallback(async () => rpc<NoticePrefs>(client, "notices.get", {}), [client]);
  /** Interruption settings are saved whole: the core fills anything left out with its default. */
  const setNoticePrefs = useCallback(
    async (prefs: NoticePrefs) => rpc<NoticePrefs>(client, "notices.set", prefs),
    [client],
  );

  const createSession = useCallback(
    async (engineId: string, projectId: string) => {
      const agent = data.agents.find((item) => item.kind === "secretary") ?? data.agents[0];
      if (!agent) throw new Error(t("noAgentForSession"));
      const project = data.projects.find((item) => item.id === projectId);
      if (!project?.path || project.registered === false) throw new Error(t("noLocalProjects"));
      const thread = await rpc<Thread>(client, "threads.create", {
        kind: "code",
        agent_id: agent.id,
        project_id: projectId,
        engine: engineId,
        title: `${engineId === "claude" ? "Claude Code" : engineId === "codex" ? "Codex" : engineId}`,
      });
      setData((d) => ({ ...d, threads: [thread, ...d.threads] }));
      return thread;
    },
    [client, data.agents, data.projects],
  );

  const resumeSession = useCallback(
    async (engine: string, id: string) => {
      const thread = await rpc<Thread>(client, "sessions.resume", { engine, id });
      setData((d) => ({ ...d, threads: [thread, ...d.threads.filter((item) => item.id !== thread.id)] }));
      return thread;
    },
    [client],
  );

  const createChat = useCallback(
    async (agentId: string, projectId?: string) => {
      const thread = await rpc<Thread>(client, "threads.create", {
        kind: "loose",
        agent_id: agentId,
        ...(projectId ? { project_id: projectId } : {}),
      });
      setData((d) => ({ ...d, threads: [thread, ...d.threads] }));
      return thread;
    },
    [client],
  );

  return {
    data,
    loading,
    online,
    error,
    client,
    refresh,
    openThread,
    readNotice,
    respond,
    toggleRoutine,
    runRoutine,
    routineRuns,
    memories,
    addMemory,
    removeMemory,
    noticePrefs,
    setNoticePrefs,
    serverInfo,
    fileTree,
    readFile,
    fileMedia,
    createChat,
    createSession,
    resumeSession,
  };
}
