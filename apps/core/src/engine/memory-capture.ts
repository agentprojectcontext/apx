import { createHash } from "node:crypto";
import { z } from "zod";
import { memorySensitive } from "../domain/memories.ts";
import { duplicateMemory, durableMemory } from "../domain/memory-content.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { MemoryWork } from "../domain/memory-work.ts";
import type { Store } from "../domain/store.ts";
import type { InternalCall } from "../rpc/internal.ts";

const Candidates = z.object({
  memories: z
    .array(
      z.object({
        kind: z.enum(["user", "feedback", "project", "reference"]),
        message_id: z.string(),
        quote: z.string().min(12).max(1500),
      }),
    )
    .max(4),
});

export async function captureMemories(store: Store, call: InternalCall, job: MemoryWork, out: string): Promise<number> {
  const view = { agent_id: job.agent_id, project_id: job.project_id ?? undefined };
  const ctx = { actor: "agent" as const, agent: { id: job.agent_id, thread_id: job.thread_id, run_id: job.run_id } };
  const textOf = (message: { parts: Array<{ type: string; text?: string }> }) =>
    message.parts.flatMap((p) => (p.type === "text" ? [p.text ?? ""] : [])).join("\n");
  let changed = 0;
  for (const candidate of Candidates.parse(JSON.parse(out.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""))).memories) {
    const settings = memorySettings(store);
    if (
      settings.mode === "off" ||
      settings.auto_capture === false ||
      store.threads.get(job.thread_id)?.project_id !== view.project_id
    )
      break;
    const message = store.messages.get(candidate.message_id);
    if (
      !message ||
      !store.memorySources.forRun(job.run_id).includes(message.id) ||
      message.author.kind !== "user" ||
      !textOf(message).includes(candidate.quote) ||
      !durableMemory(candidate.quote) ||
      memorySensitive(candidate.quote) ||
      store.memories.excluded(view, candidate.quote, { message_id: message.id, run_id: job.run_id })
    )
      continue;
    if (store.memories.list({ view, limit: 500 }).some((m) => duplicateMemory(m.text, candidate.quote))) continue;
    await call(
      "memory.add",
      {
        scope: "agent",
        text: candidate.quote,
        kind: candidate.kind,
        evidence: [{ message_id: message.id, quote: candidate.quote }],
        tainted: false,
      },
      ctx,
      `capture:${job.id}:${message.id}:${createHash("sha256").update(candidate.quote).digest("hex")}`,
    );
    changed++;
  }
  return changed;
}
