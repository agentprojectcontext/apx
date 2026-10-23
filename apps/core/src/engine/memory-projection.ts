import { memoryEligibleChat } from "../domain/chat-access.ts";
import { canSee } from "../domain/memories.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { LogEntry, MemorySnapshot } from "../domain/model-log.ts";
import type { Store } from "../domain/store.ts";
import type { ChatItem } from "../providers/types.ts";
import { frameInput } from "./context.ts";

const HEADER = "[memory: notes saved earlier]\n";

export function snapshotOf(
  store: Store,
  content: string,
  block: string,
  agentId: string,
  projectId?: string,
): MemorySnapshot | undefined {
  if (!block) return;
  const start = content.indexOf(HEADER + block);
  if (start < 0) return;
  const ids = [...block.matchAll(/\[(mem_[a-z0-9]+)\]/g)].map((m) => m[1] as string);
  const sources = [...block.matchAll(/"message":"([^"]+)"/g)].map((m) => m[1] as string);
  return {
    start,
    length: HEADER.length + block.length + 1,
    agent_id: agentId,
    project_id: projectId,
    notes: ids.map((id) => ({ id, revision: store.memories.get(id)?.revision ?? 1 })),
    sources,
  };
}

/** The runs whose turns are in the projected model history, and the current one. */
export function windowRuns(entries: LogEntry[], from: number, currentRun: string): Set<string> {
  const runs = new Set([currentRun]);
  for (const entry of entries) if (entry.seq >= from && entry.run_id) runs.add(entry.run_id);
  return runs;
}

/** Avoid re-injecting original turns or source fragments that remain in the projected model history. */
export function visibleMemoryRuns(store: Store, entries: LogEntry[], from: number, currentRun: string): Set<string> {
  const runs = windowRuns(entries, from, currentRun);
  for (const entry of entries) {
    if (entry.seq < from) continue;
    const item = entry.item as ChatItem;
    const snapshot = entry.memory;
    if (!snapshot || typeof item.content !== "string" || !item.content.slice(snapshot.start).startsWith(HEADER))
      continue;
    for (const id of snapshot.sources) {
      const run = store.memorySources.runFor(id);
      if (run) runs.add(run);
    }
  }
  return runs;
}

/** Before dependency metadata existed, the APX header and run time identify stale injected notes. */
function legacySnapshot(
  store: Store,
  entry: LogEntry,
  agentId: string,
  projectId: string | undefined,
  unsafe: Set<string | undefined>,
): LogEntry {
  const item = entry.item as ChatItem;
  if (entry.memory || item.role !== "user" || !item.content.startsWith("[context:")) return entry;
  const start = item.content.indexOf(HEADER);
  if (start < 0) return entry;
  const run = entry.run_id ? store.runs.get(entry.run_id) : undefined;
  const suffix = run?.input?.origin ? `\n\n${frameInput(run.input.origin, run.input.text)}` : undefined;
  if (!suffix || !item.content.endsWith(suffix)) {
    unsafe.add(entry.run_id);
    return entry;
  }
  const end = item.content.length - suffix.length;
  if (start >= end) return entry;
  // Legacy notes can contain blank lines and APX-like headers; only the original input proves their boundary.
  const body = item.content.slice(start, end);
  const ids = [...body.matchAll(/\[(mem_[a-z0-9]+)\]/g)].map((m) => m[1] as string);
  if (!ids.length) {
    unsafe.add(entry.run_id);
    return entry;
  }
  const at = run?.started_at;
  return {
    ...entry,
    memory: {
      start,
      length: end - start + 1,
      agent_id: agentId,
      project_id: projectId,
      sources: [],
      notes: ids.map((id) => {
        const note = store.memories.get(id);
        return { id, revision: note && at && note.updated_at <= at ? (note.revision ?? 1) : 0 };
      }),
    },
  };
}

/** Remove stale memory and derived replies; keep original owner input unless its source was forgotten. */
export function memoryHistory(store: Store, entries: LogEntry[], agentId: string, projectId?: string): LogEntry[] {
  const unsafe = new Set<string | undefined>();
  entries = entries.map((entry) => legacySnapshot(store, entry, agentId, projectId, unsafe));
  const view = { agent_id: agentId, project_id: projectId };
  const settings = memorySettings(store);
  const excluded = store.memories.exclusions(view);
  const banned = new Set<string | undefined>([...unsafe, ...excluded.flatMap((e) => (e.run_id ? [e.run_id] : []))]);
  for (const entry of entries) {
    if (!entry.run_id) continue;
    const item = entry.item as ChatItem;
    const snapshot = entry.memory;
    const content =
      typeof item.content === "string" && snapshot
        ? item.content.slice(0, snapshot.start) + item.content.slice(snapshot.start + snapshot.length)
        : item.content;
    if (typeof content === "string" && store.memories.excluded(view, content)) banned.add(entry.run_id);
  }
  const stale = new Set<string>();
  const agent = store.agents.get(agentId);
  for (const entry of entries) {
    const snapshot = entry.memory;
    if (!snapshot || !entry.run_id) continue;
    const invalid =
      settings.mode === "off" ||
      (settings.auto_recall === false && snapshot.sources.length > 0) ||
      snapshot.agent_id !== agentId ||
      snapshot.project_id !== projectId ||
      snapshot.notes.some((ref) => {
        const note = store.memories.get(ref.id);
        return !note || note.forgotten_at || note.revision !== ref.revision || !canSee(view, note);
      }) ||
      snapshot.sources.some((id) => {
        const message = store.messages.get(id);
        const thread = message && store.threads.get(message.thread_id);
        const sourceRun = store.memorySources.runFor(id);
        return (
          !agent ||
          !message ||
          message.author.kind !== "user" ||
          !sourceRun ||
          !thread ||
          !memoryEligibleChat(store, thread) ||
          thread.project_id !== projectId ||
          !thread.agent_ids.includes(agentId) ||
          store.memories.excluded(view, message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n"), {
            message_id: id,
            ...(sourceRun ? { run_id: sourceRun } : {}),
          })
        );
      });
    if (invalid) stale.add(entry.run_id);
  }
  return entries.flatMap((entry) => {
    if (banned.has(entry.run_id)) return [];
    if (!entry.run_id || !stale.has(entry.run_id)) return [entry];
    const item = entry.item as ChatItem;
    const snapshot = entry.memory;
    if (item.role !== "user" || !snapshot) return [];
    return [
      {
        ...entry,
        item: {
          ...item,
          content: item.content.slice(0, snapshot.start) + item.content.slice(snapshot.start + snapshot.length),
        },
      },
    ];
  });
}
