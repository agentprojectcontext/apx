import type { Memory, MemoryEvidence } from "@apx/protocol";
import { memorySensitive } from "../domain/memories.ts";
import { duplicateMemory, durableMemory, factSupported } from "../domain/memory-content.ts";
import { evidenceIsLive, memoryClaimKey } from "../domain/memory-evidence.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { MemoryWork } from "../domain/memory-work.ts";
import type { Store } from "../domain/store.ts";
import type { InternalCall } from "../rpc/internal.ts";
import { CaptureCandidates, candidateEvidence, memoryJson } from "./memory-review.ts";

/** Only this notebook can deduplicate a private capture; pending global notes cannot certify it. */
export function captureNotebook(store: Store, job: Pick<MemoryWork, "agent_id" | "project_id">): Memory[] {
  const view = { agent_id: job.agent_id, project_id: job.project_id ?? undefined };
  return store.memories
    .list({ view, scope: "agent", agent_id: job.agent_id, project_id: view.project_id, limit: 500 })
    .filter((m) => m.project_id === (job.project_id ?? undefined));
}

export const captureNeedsEvidence = (note: Memory) =>
  note.source === "agent" && !note.evidence?.length && !note.pending;

export function captureCandidates(store: Store, job: MemoryWork, out: string) {
  const run = store.runs.get(job.run_id);
  if (!run) return [];
  const view = { agent_id: job.agent_id, project_id: job.project_id ?? undefined };
  const result: Array<{
    kind: "user" | "feedback" | "project" | "reference";
    text: string;
    evidence: MemoryEvidence[];
    id?: string;
    expected_revision?: number;
  }> = [];
  for (const candidate of CaptureCandidates.parse(memoryJson(out)).memories) {
    const evidence = candidateEvidence(candidate);
    const quote = evidence.map((e) => e.quote).join("\n");
    const text = candidate.fact;
    if (
      !text ||
      !evidenceIsLive(store, run, evidence) ||
      !durableMemory(quote) ||
      !factSupported(text, quote) ||
      memorySensitive(text) ||
      store.memories.excluded(view, text)
    )
      continue;
    const duplicates = captureNotebook(store, job).filter((m) => duplicateMemory(m.text, text));
    if (duplicates.some((m) => !captureNeedsEvidence(m))) continue;
    const repair = duplicates[0];
    result.push({
      kind: candidate.kind,
      text,
      evidence,
      ...(repair ? { id: repair.id, expected_revision: repair.revision } : {}),
    });
  }
  return result;
}

export async function captureMemories(
  store: Store,
  call: InternalCall,
  job: MemoryWork,
  out: string,
  reviewed: readonly string[] = [],
): Promise<number> {
  let changed = 0;
  for (const candidate of captureCandidates(store, job, out)) {
    const settings = memorySettings(store);
    if (
      settings.mode === "off" ||
      settings.auto_capture === false ||
      store.threads.get(job.thread_id)?.project_id !== (job.project_id ?? undefined)
    )
      break;
    const key = memoryClaimKey(candidate.text, candidate.evidence);
    if (!reviewed.includes(key)) continue;
    await call(
      "memory.add",
      { scope: "agent", ...candidate, tainted: false },
      {
        actor: "agent",
        agent: { id: job.agent_id, thread_id: job.thread_id, run_id: job.run_id },
        memoryReviewed: reviewed,
      },
      `capture:${job.id}:${key}:${candidate.id ?? "new"}:${candidate.expected_revision ?? 0}`,
    );
    changed++;
  }
  return changed;
}
