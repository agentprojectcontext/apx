// Every write the panel makes. Components call these; they never call the client directly.
import type { ApprovalScope, Message, Part, SurfaceState, Thread } from "@apx/protocol";
import { secureRequestKey } from "@apx/protocol/client";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { type Attached, setThreadModel } from "./composer.ts";
import { refetchDelegations } from "./delegationWatch.ts";
import { loadEngines } from "./engines.ts";
import { DELEGATED_SHOWN } from "./identity.ts";
import { loadJobs } from "./jobs.ts";
import { loadCatalog, loadModelsConfig } from "./models.ts";
import { parseNewChat, takeNewChatModel } from "./newChat.ts";
import { notify } from "./notices.ts";
import { hasNoticesFor } from "./notifications.ts";
import { data, upsertMessage } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Agents, projects, threads, surfaces and browser tabs in one round. Throws if the core is unreachable. */
export async function bootstrap(): Promise<void> {
  const [agents, projects, threads, surfaces] = await Promise.all([
    client.call("agents.list", {}),
    client.call("projects.list", { include_unregistered: true }),
    // Archived chats too: the Inbox keeps them apart, under Archived. And a few of each chat's delegated chats.
    client.call("threads.list", { include_archived: true, delegated: DELEGATED_SHOWN }),
    client.call("surfaces.list", {}),
  ]);
  const prev = data.get().threads;
  // Keep sub-threads opened in this session: threads.list leaves them out.
  const keep = Object.fromEntries(
    Object.values(prev)
      .filter((t) => t.parent_id || t.kind === "a2a")
      .map((t) => [t.id, t]),
  );
  data.set({
    agents: Object.fromEntries(agents.agents.map((a) => [a.id, a])),
    former: Object.fromEntries((agents.former ?? []).map((a) => [a.id, a])),
    projects: projects.projects,
    base: projects.base,
    threads: { ...keep, ...Object.fromEntries(threads.threads.map((t) => [t.id, t])) },
    delegated: threads.delegated ?? {},
    surfaces: Object.fromEntries(surfaces.surfaces.map((s) => [s.id, s])),
    ready: true,
  });
  for (const id of opened) void loadProjectThreads(id);
  void loadTabs();
  void loadJobs();
  void loadEngines();
  void loadCatalog();
  void loadModelsConfig();
}

/** Projects whose own chats were loaded: a new bootstrap (a reconnect) loads them again. */
const opened = new Set<string>();

/**
 * A project's own chats, past the global list's recency cap: chats brought from elsewhere keep their old dates and
 * would otherwise be missing from the project.
 */
export async function loadProjectThreads(projectId: string): Promise<void> {
  opened.add(projectId);
  try {
    const { threads } = await client.call("threads.list", { project_id: projectId, include_archived: true });
    data.set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(threads.map((t) => [t.id, t])) } }));
  } catch {
    // The base space has no chats of its own to load; the global list stays as it is.
  }
}

/** Every chat `parent` delegated, past the few the list loads with it. */
export async function loadDelegated(parent: string): Promise<void> {
  try {
    const { threads } = await client.call("threads.list", { root_thread: parent });
    data.set((s) => ({
      threads: { ...s.threads, ...Object.fromEntries(threads.map((t) => [t.id, t])) },
      delegated: { ...s.delegated, [parent]: threads.filter((t) => t.parent_id === parent).length },
    }));
  } catch (e) {
    notify(t("error.openChat", { error: errText(e) }));
  }
}

export async function loadTabs(): Promise<void> {
  try {
    const { tabs } = await client.call("browser.tabs", {});
    data.set({ tabs });
  } catch {
    // No browser node connected: the panel shows its empty state.
    data.set({ tabs: [] });
  }
}

export async function loadThread(id: string): Promise<void> {
  const load = data.get().threadLoad[id];
  if (load === "loading") return;
  data.set((s) => ({ threadLoad: { ...s.threadLoad, [id]: s.messages[id] ? "ready" : "loading" } }));
  try {
    const r = await client.call("threads.get", { thread: id });
    data.set((s) => {
      const local = (s.messages[id] ?? []).filter((m) => m.id.startsWith("local_"));
      return {
        threads: { ...s.threads, [id]: r.thread },
        messages: { ...s.messages, [id]: [...r.messages, ...local].sort((a, b) => a.seq - b.seq) },
        runs: { ...s.runs, ...Object.fromEntries(r.runs.map((run) => [run.id, run])) },
        threadLoad: { ...s.threadLoad, [id]: "ready" },
      };
    });
  } catch (e) {
    data.set((s) => ({ threadLoad: { ...s.threadLoad, [id]: s.messages[id] ? "ready" : "error" } }));
    notify(t("error.openChat", { error: errText(e) }));
  }
}

/** Re-read every thread whose transcript is in memory (after a reconnect or a seq gap). */
export async function refetchLoaded(): Promise<void> {
  const ids = Object.keys(data.get().messages);
  await Promise.all([...ids.map((id) => loadThread(id)), refetchDelegations()]);
}

/**
 * Sends the owner's text, with any attached files. While the agent works it stops the running turn and answers
 * this (`interrupt`), or waits for that turn to end (`queue`).
 */
export async function send(
  threadId: string,
  text: string,
  opts: { attachments?: Attached[]; queue?: boolean } = {},
): Promise<void> {
  const files = opts.attachments ?? [];
  const list = data.get().messages[threadId] ?? [];
  const busy = data.get().threads[threadId]?.state === "working";
  let localId: string | undefined;
  try {
    const local: Message = {
      id: `local_${secureRequestKey()}`,
      thread_id: threadId,
      seq: (list[list.length - 1]?.seq ?? 0) + 0.5,
      author: { kind: "user" },
      parts: [{ type: "text", text }, ...files.map(attachedPart)],
      created_at: new Date().toISOString(),
    };
    data.set((s) => ({
      messages: { ...s.messages, [threadId]: upsertMessage(s.messages[threadId], local) },
      threads: busy ? s.threads : patchThread(s.threads, threadId, { state: "submitted" }),
    }));
    localId = local.id;
    const r = await client.call("threads.send", {
      thread: threadId,
      text,
      // Written while the agent works, it joins that turn instead of cutting it (the core queues it when it can't).
      mode: busy && !opts.queue ? "steer" : "queue",
      ...(files.length ? { attachments: files.map((f) => f.id) } : {}),
    });
    data.set((s) => {
      const without = (s.messages[threadId] ?? []).filter((m) => m.id !== local.id);
      return {
        messages: { ...s.messages, [threadId]: upsertMessage(without, r.message) },
        runs: r.run ? { ...s.runs, [r.run.id]: r.run } : s.runs,
      };
    });
  } catch (e) {
    data.set((s) => ({
      messages: { ...s.messages, [threadId]: (s.messages[threadId] ?? []).filter((m) => m.id !== localId) },
      threads:
        localId && !busy && s.threads[threadId]?.state === "submitted"
          ? patchThread(s.threads, threadId, { state: "idle" })
          : s.threads,
    }));
    notify(t("error.send", { error: errText(e) }));
    throw e;
  }
}

export async function createThread(
  input: {
    agentId: string;
    projectId?: string;
    title?: string;
    /** A code thread in the project's folder, with its write policy. */
    code?: { write: "ask" | "auto" | "read-only" };
    /** A code session with an outside engine itself ("claude", "codex"…). */
    engine?: string;
  },
  idem?: string,
): Promise<Thread> {
  const thread = await client.call(
    "threads.create",
    {
      kind: input.code || input.engine ? "code" : "loose",
      agent_id: input.agentId,
      project_id: input.projectId,
      title: input.title,
      ...(input.code ? { write: input.code.write } : {}),
      ...(input.engine ? { engine: input.engine } : {}),
    },
    idem,
  );
  data.set((s) => ({
    threads: { ...s.threads, [thread.id]: thread },
    messages: { ...s.messages, [thread.id]: s.messages[thread.id] ?? [] },
    threadLoad: { ...s.threadLoad, [thread.id]: "ready" },
  }));
  return thread;
}

/** Makes a new chat (see newChat.ts) in the core, with the model picked in it before; says why when it could not. */
export async function makeChat(id: string): Promise<Thread> {
  const spec = parseNewChat(id);
  if (!spec) throw new Error(`not a new chat: ${id}`);
  const engine = spec.engine ? data.get().engines.find((e) => e.id === spec.engine) : undefined;
  let thread: Thread;
  try {
    thread = await createThread({
      agentId: spec.agent,
      ...(spec.project ? { projectId: spec.project } : {}),
      // A code session is named after its folder by the core; a plain chat after its agent, until upkeep titles it.
      ...(spec.engine
        ? { engine: spec.engine, title: t("engine.newTitle", { engine: engine?.label ?? spec.engine }) }
        : spec.code
          ? { code: { write: "ask" as const } }
          : {}),
    });
  } catch (e) {
    notify(t("error.createChat", { error: errText(e) }));
    throw e;
  }
  const choice = takeNewChatModel(id);
  if (choice) await setThreadModel(thread.id, choice);
  return thread;
}

/** Summarizes the thread's older turns now; says why when there was nothing to do. */
export async function compactThread(threadId: string): Promise<void> {
  try {
    const r = await client.call("threads.compact", { thread: threadId });
    if (!r.compacted) notify(t("chat.compactSkipped", { reason: r.reason ?? "" }), "info");
  } catch (e) {
    notify(t("error.compact", { error: errText(e) }));
  }
}

/** Stops a background job: a terminal command is killed, an agent's run is canceled. */
export async function cancelJob(job: string): Promise<void> {
  try {
    await client.call("jobs.cancel", { job });
  } catch (e) {
    notify(t("error.stop", { error: errText(e) }));
  }
}

export async function cancel(threadId: string): Promise<void> {
  try {
    await client.call("threads.cancel", { thread: threadId });
  } catch (e) {
    notify(t("error.stop", { error: errText(e) }));
  }
}

/** Marks every one of these chats read (the Inbox's or a project's "Mark all as read"). */
export async function markAllRead(threadIds: readonly string[]): Promise<void> {
  await Promise.all(threadIds.map((id) => markRead(id)));
}

export async function markRead(threadId: string): Promise<void> {
  const t = data.get().threads[threadId];
  if (!t || (t.unread === 0 && !hasNoticesFor(threadId))) return;
  data.set((s) => ({ threads: patchThread(s.threads, threadId, { unread: 0 }) }));
  try {
    await client.call("threads.read", { thread: threadId });
  } catch {
    // Harmless: the next thread.updated restores the real count.
  }
}

export async function loadSurfaceDoc(id: string): Promise<void> {
  try {
    const { state, ...doc } = await client.call("surfaces.get", { surface: id });
    data.set((s) => ({
      surfaceDocs: { ...s.surfaceDocs, [id]: doc },
      surfaceStates: { ...s.surfaceStates, [id]: state ?? {} },
    }));
  } catch (e) {
    notify(t("error.loadWidget", { error: errText(e) }));
  }
}

export async function setSurfaceFlags(id: string, flags: { pinned?: boolean; app?: boolean }): Promise<void> {
  try {
    const summary = await client.call("surfaces.update", { surface: id, ...flags });
    data.set((s) => ({ surfaces: { ...s.surfaces, [id]: summary } }));
  } catch (e) {
    notify(t("error.updateWidget", { error: errText(e) }));
  }
}

/** Deletes a widget for good, with what it remembers; false when it could not. */
export async function removeSurface(id: string): Promise<boolean> {
  try {
    await client.call("surfaces.remove", { surface: id });
    data.set((s) => {
      const { [id]: _gone, ...surfaces } = s.surfaces;
      return { surfaces };
    });
    return true;
  } catch (e) {
    notify(t("error.updateWidget", { error: errText(e) }));
    return false;
  }
}

/** Copies a widget into a project (none: the base project), pinned to its board when asked. */
export async function copySurface(id: string, projectId: string | undefined, pinned: boolean): Promise<void> {
  try {
    const copy = await client.call("surfaces.copy", { surface: id, project_id: projectId ?? null, pinned });
    data.set((s) => ({ surfaces: { ...s.surfaces, [copy.id]: copy } }));
  } catch (e) {
    notify(t("error.updateWidget", { error: errText(e) }));
  }
}

/** The owner's answer to something an agent is waiting on (a confirmation or a question). */
export async function respond(
  input: string,
  a: { decision?: "approve" | "deny"; text?: string; scope?: ApprovalScope },
): Promise<void> {
  try {
    await client.call("runs.respond", { input, ...a });
  } catch (e) {
    notify(t("error.respond", { error: errText(e) }));
  }
}

/** A widget's sendPrompt(): the text goes to the thread that owns the surface. */
/** A widget changed what it remembers; the core's surface.state event brings the result to every open copy. */
export async function setSurfaceState(id: string, patch: SurfaceState): Promise<void> {
  try {
    const { state } = await client.call("surfaces.set_state", { surface: id, patch });
    data.set((s) => ({ surfaceStates: { ...s.surfaceStates, [id]: state } }));
  } catch (e) {
    notify(t("error.widgetState", { error: errText(e) }));
  }
}

export async function surfacePrompt(id: string, text: string): Promise<void> {
  try {
    await client.call("surfaces.prompt", { surface: id, text: text.slice(0, 4000) });
  } catch (e) {
    notify(t("error.widgetPrompt", { error: errText(e) }));
  }
}

export async function browserControl(tab: string, mode: "user" | "idle" | "done"): Promise<void> {
  try {
    const info = await client.call("browser.control", { tab, mode });
    data.set((s) => ({ tabs: s.tabs.map((t) => (t.tab === tab ? info : t)) }));
  } catch (e) {
    notify(t("error.browserControl", { error: errText(e) }));
  }
}

/** Latest JPEG of a tab as a data URL. */
export async function screenshot(tab: string): Promise<string> {
  const r = await client.call("browser.screenshot", { tab });
  return `data:${r.mime};base64,${r.data}`;
}

function attachedPart(f: Attached): Part {
  return f.kind === "image"
    ? { type: "image", media_id: f.id, mime: f.mime, alt: f.name }
    : f.kind === "audio"
      ? { type: "audio", media_id: f.id, mime: f.mime }
      : { type: "file", media_id: f.id, name: f.name, mime: f.mime, bytes: f.bytes };
}

function patchThread(threads: Record<string, Thread>, id: string, patch: Partial<Thread>): Record<string, Thread> {
  const t = threads[id];
  return t ? { ...threads, [id]: { ...t, ...patch } } : threads;
}

/** Operator navigation in the address bar. Only http(s). */
export async function browserNavigate(tab: string, url: string): Promise<void> {
  try {
    await client.call("browser.navigate", { tab, url, by: "operator" });
    void loadTabs();
  } catch (e) {
    notify(t("error.navigate", { error: errText(e) }));
  }
}

export async function browserHistory(tab: string, action: "back" | "forward" | "reload"): Promise<void> {
  try {
    await client.call("browser.history", { tab, action, by: "operator" });
    void loadTabs();
  } catch (e) {
    notify(t(action === "reload" ? "error.reload" : "error.navigate", { error: errText(e) }));
  }
}

export async function browserOpen(url: string): Promise<string | undefined> {
  try {
    const info = await client.call("browser.open", { url, by: "operator" });
    data.set((s) => ({ tabs: [...s.tabs.filter((t) => t.tab !== info.tab), info] }));
    return info.tab;
  } catch (e) {
    notify(t("error.openTab", { error: errText(e) }));
    return undefined;
  }
}

export async function browserClose(tab: string): Promise<void> {
  try {
    await client.call("browser.close", { tab });
    data.set((s) => ({ tabs: s.tabs.filter((t) => t.tab !== tab) }));
  } catch (e) {
    notify(t("error.closeTab", { error: errText(e) }));
  }
}

/** Publish (or revoke) a surface as a standalone page; the summary carries share_path when public. */
export async function shareSurface(id: string, shared: boolean): Promise<string | undefined> {
  try {
    const summary = await client.call("surfaces.share", { surface: id, shared });
    data.set((s) => {
      const doc = s.surfaceDocs[id];
      return {
        surfaces: { ...s.surfaces, [id]: summary },
        surfaceDocs: doc ? { ...s.surfaceDocs, [id]: { ...doc, share_path: summary.share_path } } : s.surfaceDocs,
      };
    });
    return summary.share_path;
  } catch (e) {
    notify(t("error.share", { error: errText(e) }));
    return undefined;
  }
}

export async function setAgentBrowserProfile(
  agent: string,
  browser_profile: "shared" | "isolated" | "incognito",
): Promise<void> {
  try {
    const next = await client.call("agents.update", { agent, browser_profile });
    data.set((s) => ({ agents: { ...s.agents, [next.id]: next } }));
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
  }
}

export async function cookieSources() {
  try {
    // Only the desktop app reads the browsers: without it the section says so, with no call bound to fail.
    const health = await client.call("system.health", {});
    if (health.subsystems.browser?.status === "off") return [];
    return (await client.call("browser.cookie_sources", {})).sources;
  } catch (e) {
    notify(t("browser.import.needsDesktop", { error: errText(e) }));
    return [];
  }
}

export async function cookieDomains(source: string, filter: string) {
  try {
    return (await client.call("browser.cookie_domains", { source, filter })).domains;
  } catch (e) {
    notify(t("error.readDomains", { error: errText(e) }));
    return [];
  }
}

export async function importCookies(source: string, domains: string[]): Promise<void> {
  try {
    const r = await client.call("browser.import_cookies", { source, domains, profile: "shared" });
    const skipped = r.skipped ? t("browser.import.expired", { n: r.skipped }) : "";
    const failed = r.failed ? t("browser.import.failed", { n: r.failed }) : "";
    notify(`${t("browser.import.done", { n: r.imported })}${skipped}${failed}.`, "info");
  } catch (e) {
    notify(t("error.import", { error: errText(e) }));
  }
}
