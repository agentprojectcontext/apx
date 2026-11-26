import { createHash } from "node:crypto";
import type { ChatContinuation } from "@apx/protocol";
import { worksForOwner } from "./owner-work.ts";
import type { Store } from "./store.ts";

export function continuationAuthority(store: Store, threadId: string, agentId: string): string | undefined {
  const thread = store.threads.get(threadId);
  const agent = store.agents.get(agentId);
  if (
    !thread ||
    !agent ||
    thread.archived ||
    !["home", "agent", "loose", "code", "channel"].includes(thread.kind) ||
    !worksForOwner(store, thread)
  )
    return;
  if (!thread.agent_ids.includes(agentId) || (agent.project_id && agent.project_id !== thread.project_id)) return;
  const project = thread.project_id ? store.projects.get(thread.project_id) : undefined;
  if (thread.project_id && !project) return;
  const context = store.threads.context(threadId);
  return createHash("sha256")
    .update(
      JSON.stringify({
        agent,
        project,
        channel: thread.channel,
        reply_to: context.reply_to,
        project_id: thread.project_id,
        write: thread.write,
        flow: context.flow_step,
        routine: context.routine_autonomy,
      }),
    )
    .digest("hex");
}

export function continuationNotice(
  store: Store,
  item: ChatContinuation,
  code: string,
  text: string,
  vars: Record<string, string | number> = {},
): void {
  const saved = store.continuations.get(item.id)?.value ?? item;
  const target = saved.run_id ? store.messages.ofRun(item.thread_id, saved.run_id)[0]?.id : undefined;
  const part = {
    type: "notice" as const,
    code: "continuation.receipt",
    level: saved.state === "failed" || saved.state === "blocked" ? ("warn" as const) : ("info" as const),
    text,
    vars: {
      ...vars,
      id: saved.id,
      thread: saved.thread_id,
      purpose: saved.purpose,
      state: saved.state,
      condition: saved.condition.kind,
      when: saved.condition.kind === "time" ? saved.condition.at : (store.tasks.get(saved.condition.task)?.title ?? ""),
      expires: saved.expires_at,
      reason: code,
      ...(target ? { target } : {}),
    },
  };
  const receipt = store.messages
    .notices(item.thread_id, "continuation.receipt")
    .find((m) => m.parts.some((p) => p.type === "notice" && p.vars?.id === item.id));
  if (receipt) store.messages.update({ ...receipt, parts: [part] });
  else store.messages.add({ thread_id: item.thread_id, author: { kind: "system" }, parts: [part] });
}
