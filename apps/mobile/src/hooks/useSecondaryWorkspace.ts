import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import type { ApxClient } from "../protocol";
import type { TaskColumn } from "../tasks/fields";
import { keepSame } from "./keepSame";
import type {
  Agent,
  Channel,
  Engine,
  NativeSession,
  Notice,
  PendingInput,
  Person,
  Project,
  Routine,
  Task,
  Workspace,
} from "./useWorkspace";

export function useSecondaryWorkspace(client: ApxClient, setData: Dispatch<SetStateAction<Workspace>>) {
  const latest = useRef(0);
  return useCallback(async () => {
    const revision = ++latest.current;
    const get = <T>(method: string, params?: Record<string, unknown>) =>
      (client.call(method as never, params as never) as Promise<T>).catch(() => undefined);
    const [
      projects,
      agents,
      open,
      done,
      dropped,
      inbox,
      pending,
      routines,
      engines,
      jobs,
      owner,
      channels,
      memory,
      contacts,
      disk,
    ] = await Promise.all([
      get<{ projects: Project[] }>("projects.list", { include_unregistered: true }),
      get<{ agents: Agent[] }>("agents.list", {}),
      get<{ tasks: Task[]; columns: TaskColumn[] }>("tasks.list", { state: "open", limit: 200 }),
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
      get<{ persons: Person[] }>("contacts.list", {}),
      get<Workspace["disk"]>("storage.status", {}),
    ]);
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
    // Recovery can overlap an older workspace load that still carries a settled input.
    setData((d) =>
      revision !== latest.current
        ? d
        : keepSame(d, {
            ...d,
            projects: projects?.projects ?? d.projects,
            agents: agents?.agents ?? d.agents,
            tasks: open ? [...open.tasks, ...(done?.tasks ?? []), ...(dropped?.tasks ?? [])] : d.tasks,
            columns: open?.columns.length ? open.columns : d.columns,
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
            persons: contacts?.persons ?? d.persons,
            memories: memory?.total ?? d.memories,
            disk: disk ?? d.disk,
          }),
    );
  }, [client, setData]);
}
