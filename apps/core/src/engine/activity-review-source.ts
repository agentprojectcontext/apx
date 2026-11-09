import type { ReviewSource } from "../domain/activity-review-proposals.ts";
import { memoryEligibleChat } from "../domain/chat-access.ts";
import { memorySensitive } from "../domain/memories.ts";
import { messageText, ownerMemorySource } from "../domain/memory-evidence.ts";
import type { Store } from "../domain/store.ts";
import { redactedJson } from "../log.ts";

/** Only completed owner turns qualify; automated work and sealed conversations never become review input. */
export function activityReviewSources(store: Store, from: string, until: string): ReviewSource[] {
  const sources: ReviewSource[] = [];
  let remaining = 20_000;
  for (const run of store.runs.completedSince(from, until)) {
    const thread = store.threads.get(run.thread_id);
    if (!thread || thread.archived || !memoryEligibleChat(store, thread) || thread.kind === "routine") continue;
    if (store.tasks.byThread(thread.id)?.tags.includes("Activity review")) continue;
    if (run.input?.project_at_start && run.input.project_at_start.id !== thread.project_id) continue;
    const ended = run.ended_at;
    if (!ended) continue;
    for (const source of ownerMemorySource(store, run)) {
      if (remaining < 200 || sources.length >= 24) return sources;
      const text = source.text.slice(0, Math.min(2000, remaining));
      // Recognizable credentials and sensitive topics are not sent, even when the owner wrote them.
      if (memorySensitive(text) || JSON.parse(redactedJson(text)) !== text) continue;
      const reply = store.messages
        .ofRun(thread.id, run.id)
        .filter((m) => m.author.kind === "agent")
        .map(messageText)
        .join("\n")
        .slice(0, Math.min(1000, remaining - text.length));
      const safeReply = memorySensitive(reply) ? "" : (JSON.parse(redactedJson(reply)) as string);
      sources.push({
        id: source.id,
        thread: thread.id,
        project: thread.project_id,
        at: ended,
        text,
        reply: safeReply,
      });
      remaining -= text.length + safeReply.length;
    }
  }
  return sources;
}

export function activityReviewBatches(sources: ReviewSource[]): ReviewSource[][] {
  const groups = new Map<string | undefined, ReviewSource[]>();
  for (const source of sources) {
    const group = groups.get(source.project);
    if (group) group.push(source);
    else if (groups.size < 3) groups.set(source.project, [source]);
  }
  return [...groups.values()];
}

export function reviewReference(store: Store, sources: ReviewSource[]) {
  const project = sources[0]?.project;
  if (sources.some((source) => source.project !== project))
    throw new Error("Review reference must have one project scope");
  const projects = project ? [project] : [];
  return {
    language: store.settings.get("owner_language") === "en" ? "English" : "Spanish",
    sources,
    projects: projects.flatMap((id) => {
      const p = store.projects.get(id);
      if (!p) return [];
      const text = `${p.description ?? ""}\n${p.context ?? ""}\n${p.memory ?? ""}`.slice(0, 1200);
      return [{ id, name: p.name, context: memorySensitive(text) ? "" : (JSON.parse(redactedJson(text)) as string) }];
    }),
    existing_tasks: store.tasks
      .list({ state: "open", limit: 100 })
      .filter((t) => t.project_id === project && !memorySensitive(`${t.title} ${t.goal ?? ""}`))
      .map((t) => ({
        title: t.title,
        project: t.project_id,
        goal: t.goal?.slice(0, 200),
      })),
  };
}
