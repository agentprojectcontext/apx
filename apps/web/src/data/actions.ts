// Every write the panel makes. Components call these; they never call the client directly.
import type { Message, Thread } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { loadEngines } from "./engines.ts";
import { notify } from "./notices.ts";
import { data, upsertMessage } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Agents, projects, threads, surfaces and browser tabs in one round. Throws if the core is unreachable. */
export async function bootstrap(): Promise<void> {
  const [agents, projects, threads, surfaces] = await Promise.all([
    client.call("agents.list", {}),
    client.call("projects.list", {}),
    client.call("threads.list", {}),
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
    projects: projects.projects,
    threads: { ...keep, ...Object.fromEntries(threads.threads.map((t) => [t.id, t])) },
    surfaces: Object.fromEntries(surfaces.surfaces.map((s) => [s.id, s])),
    ready: true,
  });
  void loadTabs();
  void loadEngines();
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
  await Promise.all(ids.map((id) => loadThread(id)));
}

export async function send(threadId: string, text: string): Promise<void> {
  const list = data.get().messages[threadId] ?? [];
  const local: Message = {
    id: `local_${crypto.randomUUID()}`,
    thread_id: threadId,
    seq: (list[list.length - 1]?.seq ?? 0) + 0.5,
    author: { kind: "user" },
    parts: [{ type: "text", text }],
    created_at: new Date().toISOString(),
  };
  data.set((s) => ({
    messages: { ...s.messages, [threadId]: upsertMessage(s.messages[threadId], local) },
    threads: patchThread(s.threads, threadId, { state: "submitted" }),
  }));
  try {
    const r = await client.call("threads.send", { thread: threadId, text });
    data.set((s) => {
      const without = (s.messages[threadId] ?? []).filter((m) => m.id !== local.id);
      return {
        messages: { ...s.messages, [threadId]: upsertMessage(without, r.message) },
        runs: r.run ? { ...s.runs, [r.run.id]: r.run } : s.runs,
      };
    });
  } catch (e) {
    data.set((s) => ({
      messages: { ...s.messages, [threadId]: (s.messages[threadId] ?? []).filter((m) => m.id !== local.id) },
      threads: patchThread(s.threads, threadId, { state: "idle" }),
    }));
    notify(t("error.send", { error: errText(e) }));
    throw e;
  }
}

export async function createThread(input: { agentId: string; projectId?: string; title?: string }): Promise<Thread> {
  const thread = await client.call("threads.create", {
    kind: "loose",
    agent_id: input.agentId,
    project_id: input.projectId,
    title: input.title,
  });
  data.set((s) => ({
    threads: { ...s.threads, [thread.id]: thread },
    messages: { ...s.messages, [thread.id]: s.messages[thread.id] ?? [] },
    threadLoad: { ...s.threadLoad, [thread.id]: "ready" },
  }));
  return thread;
}

export async function cancel(threadId: string): Promise<void> {
  try {
    await client.call("threads.cancel", { thread: threadId });
  } catch (e) {
    notify(t("error.stop", { error: errText(e) }));
  }
}

export async function markRead(threadId: string): Promise<void> {
  const t = data.get().threads[threadId];
  if (!t || t.unread === 0) return;
  data.set((s) => ({ threads: patchThread(s.threads, threadId, { unread: 0 }) }));
  try {
    await client.call("threads.read", { thread: threadId });
  } catch {
    // Harmless: the next thread.updated restores the real count.
  }
}

export async function loadSurfaceDoc(id: string): Promise<void> {
  try {
    const doc = await client.call("surfaces.get", { surface: id });
    data.set((s) => ({ surfaceDocs: { ...s.surfaceDocs, [id]: doc } }));
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

/** A widget's sendPrompt(): the text goes to the thread that owns the surface. */
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
