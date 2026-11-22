import type { ReviewSource } from "../domain/activity-review-proposals.ts";
import { canReadChat, memoryEligibleChat } from "../domain/chat-access.ts";
import { memorySensitive } from "../domain/memories.ts";
import { messageText, ownerMemorySource } from "../domain/memory-evidence.ts";
import type { Store } from "../domain/store.ts";
import { redactedJson } from "../log.ts";

export function discoveryActivity(
  store: Store,
  project: string | undefined,
  from: string,
  until: string,
): ReviewSource[] {
  const secretary = store.agents.list().find((agent) => agent.kind === "secretary");
  if (!secretary) return [];
  const sources: ReviewSource[] = [];
  let remaining = 20_000;
  for (const run of store.runs.completedSince(from, until)) {
    const thread = store.threads.get(run.thread_id);
    if (
      !thread ||
      thread.project_id !== project ||
      thread.archived ||
      thread.kind === "routine" ||
      !memoryEligibleChat(store, thread) ||
      !canReadChat(store, secretary, thread)
    )
      continue;
    if (store.tasks.byThread(thread.id)?.tags.includes("Activity review")) continue;
    if (run.input?.project_at_start && run.input.project_at_start.id !== project) continue;
    if (!run.ended_at) continue;
    for (const source of ownerMemorySource(store, run)) {
      if (remaining < 200 || sources.length >= 24) return sources;
      const text = source.text.slice(0, Math.min(2000, remaining));
      if (memorySensitive(text) || JSON.parse(redactedJson(text)) !== text) continue;
      const reply = store.messages
        .ofRun(thread.id, run.id)
        .filter((m) => m.author.kind === "agent")
        .map(messageText)
        .join("\n")
        .slice(0, Math.min(1000, remaining - text.length));
      const safeReply = memorySensitive(reply) ? "" : (JSON.parse(redactedJson(reply)) as string);
      sources.push({ id: source.id, thread: thread.id, project, at: run.ended_at, text, reply: safeReply });
      remaining -= text.length + safeReply.length;
    }
  }
  return sources;
}
