// The one service every permission question about an agent goes through: the mode it acts in (its own, its project's,
// its callers'), how far its files reach, and what a running call was let use. The executor, outside agents' tool
// callbacks and every method a tool calls ask it, so no path answers with less than the agent may do
// (DECISIONS.md#d-115).
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import {
  type Access,
  type FolderThread,
  folderAccess,
  harnessRoots,
  judge,
  type Root,
  rootsOf,
  type workDir,
} from "../tools/folders.ts";
import { actingAs, reachOf, withProjectAutonomy } from "../tools/policy.ts";
import { callersOf } from "./ancestry.ts";

type ThreadOf = Parameters<typeof workDir>[2] & { id: string; parent_id?: string | undefined };

/** Who called a method from a tool, as the router passes it (CallContext.agent). */
export type Caller = { id: string; run_id: string; thread_id: string; call_id?: string | undefined };

export type Permissions = ReturnType<typeof createPermissions>;

export function createPermissions(o: { store: Store; home: string }) {
  const { store, home } = o;
  /** Each running call's thread as the executor let it run (lent folders included), by run and call. */
  const held = new Map<string, FolderThread>();
  const key = (runId: string, callId: string) => `${runId}\n${callId}`;

  /** The agent as it acts in a thread: its own mode, else its project's; a helper in its callers' (DECISIONS.md#d-106). */
  const agentIn = (agent: AgentRecord, threadId: string): AgentRecord =>
    actingAs(
      withProjectAutonomy(store, agent),
      callersOf(store, threadId).map((a) => withProjectAutonomy(store, a)),
    );

  /** The thread as the folder rule sees it for an agent as it acts (agentIn): its reach and the folders granted for good. */
  function scope<T extends ThreadOf>(agent: AgentRecord, thread: T): T & FolderThread {
    const reach = reachOf(agent);
    if (reach === "all" || reach === "fenced") return { ...thread, reach };
    const granted = store.approvals.writeFolders(agent.id);
    return { ...thread, reach, ...(granted.length ? { granted } : {}) };
  }

  return {
    agentIn,
    scope,
    /** While a tool runs, the thread its call was let use, for the methods it calls; the returned function lets go. */
    hold(runId: string, callId: string, thread: FolderThread): () => void {
      const k = key(runId, callId);
      held.set(k, thread);
      return () => {
        if (held.get(k) === thread) held.delete(k);
      };
    },
    /**
     * The thread a method called from an agent's tool judges paths with: the running call's own, else the agent's in
     * that thread now. Undefined when the agent or the thread is gone.
     */
    forCaller(caller: Caller): FolderThread | undefined {
      const own = caller.call_id ? held.get(key(caller.run_id, caller.call_id)) : undefined;
      if (own) return own;
      const thread = store.threads.get(caller.thread_id);
      const agent = store.agents.get(caller.id);
      return thread && agent ? scope(agentIn(agent, thread.id), thread) : undefined;
    },
    /** What the agent may do with a path it names (folders.ts folderAccess). */
    path: (thread: FolderThread, file: string, opts?: Parameters<typeof folderAccess>[4]): Access =>
      folderAccess(store, home, thread, file, opts),
    roots: (thread: FolderThread): Root[] => rootsOf(store, home, thread),
    /** The same folders for an outside agent (Claude, Codex, ACP), which works in its side folder. */
    harnessRoots: (thread: FolderThread): Root[] => harnessRoots(store, home, thread),
    /** What an outside agent may do with a path its own tool names, from the folder it works in. */
    harnessPath(thread: FolderThread, file: string, write: boolean): Access {
      const roots = harnessRoots(store, home, thread);
      return judge(roots, file, roots[0]?.dir ?? home, { home, project: Boolean(thread.project_id), write });
    },
  };
}
