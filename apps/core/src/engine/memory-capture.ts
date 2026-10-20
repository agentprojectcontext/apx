import type { MemoryEvidence } from "@apx/protocol";
import { memorySensitive } from "../domain/memories.ts";
import { duplicateMemory, durableMemory, factSupported } from "../domain/memory-content.ts";
import { evidenceIsLive, memoryClaimKey } from "../domain/memory-evidence.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { MemoryWork } from "../domain/memory-work.ts";
import type { Store } from "../domain/store.ts";
import type { InternalCall } from "../rpc/internal.ts";
import { CaptureCandidates, candidateEvidence, memoryJson } from "./memory-review.ts";

export function captureCandidates(store: Store, job: MemoryWork, out: string) {
  const run = store.runs.get(job.run_id);
  if (!run) return [];
  const view = { agent_id: job.agent_id, project_id: job.project_id ?? undefined };
  const result: Array<{
    kind: "user" | "feedback" | "project" | "reference";
    text: string;
    evidence: MemoryEvidence[];
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
    if (
      store.memories
        .list({ view, limit: 500 })
        .some(
          (m) =>
            duplicateMemory(m.text, text) ||
            m.evidence?.some((e) => evidence.some((source) => duplicateMemory(e.quote, source.quote))),
        )
    )
      continue;
    result.push({ kind: candidate.kind, text, evidence });
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
      `capture:${job.id}:${key}`,
    );
    changed++;
  }
  return changed;
}
