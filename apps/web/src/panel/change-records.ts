import type { Message, Part } from "@apx/protocol";

export type ChangePart = Extract<Part, { type: "changes" }>;
export type ChangeRow = { file: ChangePart["files"][number]; cwd: string; message: string; part: number };

/** One row per path; history shows its most recent recorded edit instead of duplicate cards. */
export function recordedChanges(messages: readonly Message[], thread: string, scope: "latest" | "all"): ChangeRow[] {
  const batches = messages
    .filter((m) => m.thread_id === thread && m.author.kind === "agent")
    .flatMap((message) => {
      const parts = message.parts.flatMap((part, index) => (part.type === "changes" ? [{ changes: part, index }] : []));
      const edits = parts.filter((p) => p.changes.edits);
      const selected = edits.length ? edits : parts;
      return selected.length ? [{ message, parts: selected }] : [];
    });
  const selected = scope === "latest" ? batches.slice(-1) : batches;
  const rows = new Map<string, ChangeRow>();
  for (const batch of selected)
    for (const { changes, index } of batch.parts)
      for (const file of changes.files)
        rows.set(`${changes.cwd}\0${file.path}`, { file, cwd: changes.cwd, message: batch.message.id, part: index });
  return [...rows.values()];
}
