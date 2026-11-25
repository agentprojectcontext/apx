// Files on a task's conversation: what an agent hands the owner for review shows next to its words, not only in the
// task's attachments or in the agent's own chat for the task.
import type { Message, Part, Task } from "@apx/protocol";
import type { MediaRecord } from "../domain/media.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";

type FilePart = Extract<Part, { type: "file" | "image" }> & { media_id: string };

/** How a file shows in a conversation. */
function partOf(m: MediaRecord): FilePart {
  const name = m.prompt ?? m.id;
  return m.kind === "image"
    ? { type: "image", media_id: m.id, mime: m.mime, alt: name }
    : { type: "file", media_id: m.id, mime: m.mime, name, bytes: m.bytes };
}

/** The message with these files shown under its words. */
export function withFiles(store: Store, message: Message, files: MediaRecord[]): Message {
  if (!files.length) return message;
  return store.messages.update({ ...message, parts: [...message.parts, ...files.map(partOf)] });
}

/** The files and images APX keeps that an answer showed (not pictures from the web), in order, once each. */
function filesIn(parts: Part[]): FilePart[] {
  const out: FilePart[] = [];
  for (const p of parts) {
    const id = p.type === "file" || p.type === "image" ? p.media_id : undefined;
    if (id && !out.some((o) => o.media_id === id)) out.push({ ...p, media_id: id } as FilePart);
  }
  return out;
}

/** The media a conversation already shows. */
function shownIn(store: Store, threadId: string): Set<string> {
  return new Set(store.messages.list(threadId, 500).flatMap((m) => filesIn(m.parts).map((p) => p.media_id)));
}

/**
 * A line naming the files an answer showed, by id, for the agent it goes back to (a delegation, a consult, a task's
 * report): it opens them with file_read and shows them to the owner with send_file; its words alone carry no file.
 */
export function filesNote(parts: Part[]): string {
  const files = filesIn(parts);
  if (!files.length) return "";
  const name = (p: FilePart) => (p.type === "file" ? p.name : p.alt || p.media_id);
  return `Files it showed: ${files.map((p) => `${name(p)} (${p.media_id})`).join(", ")}.`;
}

/** `answer` with the files its run showed named under it. */
export function withFilesNote(store: Store, run: RunRecord, answer: string): string {
  const note = filesNote(store.messages.ofRun(run.thread_id, run.id).flatMap((m) => m.parts));
  return note ? `${answer}\n\n${note}` : answer;
}

/** Keeps files on a task and returns the task's copy of each (rpc/task-assets.ts share). */
export type ShareOnTask = (task: Task, sources: MediaRecord[], by: string) => MediaRecord[];

/**
 * The files a turn in the agent's chat for the task showed go with its answer on the task, kept as the task's
 * attachments too; a file the conversation already shows is not shown again, so a retried turn repeats none.
 */
export function showTurnFiles(store: Store, task: Task, run: RunRecord, comment: Message, share?: ShareOnTask): void {
  const parts = store.messages.ofRun(run.thread_id, run.id).flatMap((m) => m.parts);
  const sources = filesIn(parts).flatMap((p) => store.media.get(p.media_id) ?? []);
  if (!sources.length) return;
  const shown = shownIn(store, task.thread_id);
  let files = sources;
  try {
    if (share) files = share(task, sources, run.agent_id);
  } catch {
    // Over the task's attachment limit: the files still show, from the agent's chat for the task.
  }
  withFiles(
    store,
    comment,
    files.filter((f) => !shown.has(f.id)),
  );
}
