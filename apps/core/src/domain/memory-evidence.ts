import { createHash } from "node:crypto";
import type { Memory, MemoryEvidence } from "@apx/protocol";
import { memoryEligibleChat } from "./chat-access.ts";
import { memorySensitive } from "./memories.ts";
import { isMemoryGreeting } from "./memory-content.ts";
import { ownerOrigin, type RunRecord } from "./runs.ts";
import type { Store } from "./store.ts";

export const messageText = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.flatMap((p) => (p.type === "text" ? [p.text ?? ""] : [])).join("\n");

export function ownerMemorySource(store: Store, run: RunRecord) {
  const thread = store.threads.get(run.thread_id);
  if (
    run.state !== "completed" ||
    !ownerOrigin(run.input?.origin) ||
    !thread ||
    !memoryEligibleChat(store, thread) ||
    !thread.agent_ids.includes(run.agent_id) ||
    !store.agents.list().some((a) => a.id === run.agent_id)
  )
    return [];
  const view = { agent_id: run.agent_id, project_id: thread.project_id };
  return store.memorySources.forRun(run.id).flatMap((id) => {
    const m = store.messages.get(id);
    if (!m || m.thread_id !== thread.id || m.author.kind !== "user") return [];
    const text = messageText(m);
    return text.trim().length < 12 ||
      isMemoryGreeting(text) ||
      memorySensitive(text) ||
      store.memories.excluded(view, text, { message_id: id, run_id: run.id })
      ? []
      : [{ id, text: text.slice(0, 4000), run_id: run.id }];
  });
}

/** Historical work is anchored to its own time, never to later messages in the live chat. */
export function memorySourceWindow(store: Store, run: RunRecord) {
  return store.runs.memoryWindow(run).flatMap((r) => ownerMemorySource(store, r));
}

export function evidenceIsLive(store: Store, run: RunRecord, evidence: MemoryEvidence[]): boolean {
  const sources = memorySourceWindow(store, run);
  const view = { agent_id: run.agent_id, project_id: store.threads.get(run.thread_id)?.project_id };
  return (
    evidence.length > 0 &&
    evidence.length <= 4 &&
    evidence.every((e) => {
      const source = sources.find((s) => s.id === e.message_id);
      return (
        !!source &&
        source.text.includes(e.quote) &&
        !memorySensitive(e.quote) &&
        !store.memories.excluded(view, e.quote, { message_id: source.id, run_id: source.run_id })
      );
    })
  );
}

/** Internal review is bound to exact text and sources; it is not a model-supplied boolean. */
export const memoryClaimKey = (text: string, evidence: MemoryEvidence[]) =>
  createHash("sha256").update(JSON.stringify({ text, evidence })).digest("hex");

export const retirementKey = (old: Memory, replacement?: Memory) =>
  memoryClaimKey(
    JSON.stringify({
      old: { id: old.id, revision: old.revision, text: old.text },
      replacement: replacement && { id: replacement.id, revision: replacement.revision, text: replacement.text },
    }),
    [],
  );
