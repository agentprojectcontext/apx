import type { Message, Part } from "@apx/protocol";

export type ChangePart = Extract<Part, { type: "changes" }>;
export type ChangeRow = {
  file: ChangePart["files"][number];
  cwd: string;
  message: string;
  part: number;
  /** In the chat's temp folder: the agent's scratch work, listed apart from the owner's folders. */
  scratch: boolean;
};

/** One row per path; history shows its most recent recorded edit instead of duplicate cards. */
export function recordedChanges(messages: readonly Message[], thread: string, scope: "latest" | "all"): ChangeRow[] {
  const batches = messages
    .filter((m) => m.thread_id === thread && m.author.kind === "agent")
    .flatMap((message) => {
      const parts = message.parts.flatMap((part, index) => (part.type === "changes" ? [{ changes: part, index }] : []));
      // The agent's own edits replace git's summary of the folder; temp-folder files are listed besides either.
      const owned = parts.filter((p) => !p.changes.scratch);
      const edits = owned.filter((p) => p.changes.edits);
      const selected = [...(edits.length ? edits : owned), ...parts.filter((p) => p.changes.scratch)];
      return selected.length ? [{ message, parts: selected }] : [];
    });
  const selected = scope === "latest" ? batches.slice(-1) : batches;
  const rows = new Map<string, ChangeRow>();
  for (const batch of selected)
    for (const { changes, index } of batch.parts)
      for (const file of changes.files)
        rows.set(`${changes.cwd}\0${file.path}`, {
          file,
          cwd: changes.cwd,
          message: batch.message.id,
          part: index,
          scratch: changes.scratch === true,
        });
  return [...rows.values()];
}
