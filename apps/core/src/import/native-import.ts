// The owner's Claude Code and Codex work brought into APX as projects: each session a chat with its whole history, its
// images and the tools the engine ran, under the project of the folder it ran in. Importing again adds only what is
// new, so the owner can keep working there while moving. Read-only on the CLIs' folders.
import path from "node:path";
import type { Part } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { saveUpload } from "../services/uploads.ts";
import { codexState } from "./codex-state.ts";
import { type NativeItem, sessionFile, sessionItems, writtenPages } from "./native-read.ts";
import { type NativeEngine, type NativeHomes, type NativeSession, nativeSessions } from "./native-sessions.ts";

export type NativeProject = { name: string; cwd: string; sessions: NativeSession[] };
export type ImportedChat = { thread: string; session: string; title: string; added: number; created: boolean };

const TEXT_MAX = 100_000;
/** What of a long chat goes to the model log, newest first: the rest stays visible in the chat. */
const LOG_CHARS = 200_000;
const TOOLS_PER_ANSWER = 40;
const TOOL_SHOWN = 200;
const SCAN = 2000;

const doneKey = (engine: NativeEngine, id: string) => `native_import:${engine}:${id}`;
type Done = { thread: string; items: number };

/** Whether `dir` is `root` or inside it. */
const within = (dir: string, root: string) => dir === root || dir.startsWith(`${root}${path.sep}`);

/**
 * The engine's work on this machine grouped by project, newest first: Codex's own projects when its app keeps them,
 * else one per folder a session ran in.
 */
export function nativeProjects(homes: NativeHomes, engine: NativeEngine): NativeProject[] {
  const groups = new Map<string, NativeProject>();
  const add = (cwd: string, name: string, s: NativeSession) => {
    const g = groups.get(cwd) ?? { name, cwd, sessions: [] };
    g.sessions.push(s);
    groups.set(cwd, g);
  };
  const state = engine === "codex" ? codexState(homes.codex) : undefined;
  if (state) {
    for (const t of state.threads) {
      const file = sessionFile(t.file);
      if (!file) continue;
      const s: NativeSession = { id: t.id, engine, title: t.title, cwd: t.cwd, updated_at: t.updated_at, file };
      const project =
        state.projects.find((p) => p.id === t.project_id) ??
        state.projects
          .filter((p) => p.roots.some((r) => within(t.cwd, r)))
          .sort((a, b) => (b.roots[0]?.length ?? 0) - (a.roots[0]?.length ?? 0))[0];
      const root = project?.roots.find((r) => within(t.cwd, r)) ?? project?.roots[0];
      add(root ?? t.cwd, project?.name ?? path.basename(t.cwd), s);
    }
  } else for (const s of nativeSessions(homes, engine, SCAN)) add(s.cwd, path.basename(s.cwd), s);
  return [...groups.values()].sort((a, b) =>
    (b.sessions[0]?.updated_at ?? "").localeCompare(a.sessions[0]?.updated_at ?? ""),
  );
}

/** The chat a session was brought into, if it was. */
export function importedThread(store: Store, engine: NativeEngine, id: string): string | undefined {
  const done = JSON.parse(store.settings.get(doneKey(engine, id)) ?? "null") as Done | null;
  return done && store.threads.get(done.thread) ? done.thread : undefined;
}

/** The newest stretch of a log within `chars`, starting at an owner's turn. */
function newest<T extends { role: string; content: string }>(items: T[], chars: number): T[] {
  let i = items.length;
  for (let used = 0; i > 0 && used + (items[i - 1]?.content.length ?? 0) <= chars; i--)
    used += items[i - 1]?.content.length ?? 0;
  while (i < items.length && items[i]?.role !== "user") i++;
  return items.slice(i);
}

function partsOf(home: string, store: Store, thread: string, it: NativeItem, key: string): Part[] {
  const parts: Part[] = it.tools.slice(-TOOLS_PER_ANSWER).map((t, j) => ({
    type: "tool",
    call_id: `${key}-${j}`,
    tool: t.name,
    title: t.name,
    status: "ok",
    detail: t.detail.slice(0, TOOL_SHOWN),
  }));
  if (it.text) parts.push({ type: "text", text: it.text.slice(0, TEXT_MAX) });
  it.images.forEach((img, j) => {
    try {
      const ext = img.mime.split("/")[1] ?? "png";
      const m = saveUpload(home, store, { name: `${key}-${j}.${ext}`, mime: img.mime, bytes: img.bytes, thread });
      parts.push({ type: "image", media_id: m.id, mime: m.mime, alt: "" });
    } catch {
      // An image the store refuses (too big, not what its type says) stays out; the words still come.
    }
  });
  return parts;
}

/**
 * Brings sessions in as chats of `project` owned by `owner` (the agent that answers there until another takes it).
 * A session brought before gets only its new turns.
 */
export function importSessions(
  store: Store,
  home: string,
  o: {
    engine: NativeEngine;
    sessions: NativeSession[];
    codexHome: string;
    project_id: string | undefined;
    owner: string;
  },
): { chats: ImportedChat[]; pages: string[] } {
  const chats: ImportedChat[] = [];
  const pages = new Set<string>();
  for (const s of o.sessions) {
    const items = sessionItems(o.engine, s.file, { codexHome: o.codexHome, thread: s.id });
    for (const p of writtenPages(items, s.cwd)) pages.add(p);
    const done = JSON.parse(store.settings.get(doneKey(o.engine, s.id)) ?? "null") as Done | null;
    const existing = done ? store.threads.get(done.thread) : undefined;
    const fresh = items.slice(existing && done ? done.items : 0);
    if (!items.length || (existing && !fresh.length)) {
      if (existing) chats.push({ thread: existing.id, session: s.id, title: existing.title, added: 0, created: false });
      continue;
    }
    const thread =
      existing ??
      store.threads.create({
        kind: "loose",
        title: s.title.slice(0, 120),
        agent_ids: [o.owner],
        project_id: o.project_id,
        at: items[0]?.at,
      });
    const log: Array<{ role: "user" | "assistant"; content: string }> = [];
    let last = { at: items[0]?.at ?? new Date().toISOString(), text: "" };
    const base = existing && done ? done.items : 0;
    const rows = fresh.map((it, i) => ({ it, parts: partsOf(home, store, thread.id, it, `${s.id}-${base + i}`) }));
    store.tx(() => {
      if (!existing) store.threads.mergeContext(thread.id, { imported: { engine: o.engine, session: s.id } });
      for (const { it, parts } of rows) {
        if (!parts.length) continue;
        store.messages.add({
          thread_id: thread.id,
          author: it.role === "user" ? { kind: "user" } : { kind: "agent", id: thread.agent_ids[0] ?? o.owner },
          parts,
          ...(it.role === "assistant" ? { model: o.engine } : {}),
          ...(it.at ? { at: it.at } : {}),
          quiet: true,
        });
        if (it.text) {
          log.push({ role: it.role, content: it.text.slice(0, TEXT_MAX) });
          last = { at: it.at ?? last.at, text: it.text };
        }
      }
      // The model's view of the chat, so going on with it there has the earlier turns (its newest stretch).
      if (log.length) store.modelLog.append(thread.id, undefined, newest(log, LOG_CHARS));
      store.threads.settle(thread.id, last.at, last.text.slice(0, 140));
      store.settings.set(doneKey(o.engine, s.id), JSON.stringify({ thread: thread.id, items: items.length }));
    });
    chats.push({ thread: thread.id, session: s.id, title: thread.title, added: rows.length, created: !existing });
  }
  return { chats, pages: [...pages] };
}
