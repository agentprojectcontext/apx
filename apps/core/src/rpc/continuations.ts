import type { ChatContinuation } from "@apx/protocol";
import { continuationAuthority, continuationNotice } from "../domain/continuation-scope.ts";
import { worksForOwner } from "../domain/owner-work.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

const MAX_WAIT_MS = 7 * 24 * 3600_000;
const MAX_ACTIVE = 100;

export function continuationHandlers(store: Store, clock: () => Date = () => new Date()) {
  function scope(threadId: string, ctx: CallContext, active = true) {
    if (ctx.client || (ctx.agent && ctx.agent.thread_id !== threadId))
      throw unauthorized("Continuations stay in the current chat");
    const thread = store.threads.get(threadId);
    if (!thread) throw notFound("chat");
    if (ctx.agent && !worksForOwner(store, thread))
      throw unauthorized("Only the owner's own chats can manage follow-ups");
    const agent = ctx.agent?.id ?? thread.agent_ids[0];
    const authority = agent && continuationAuthority(store, threadId, agent);
    if (!agent || (active && !authority)) throw badRequest("Choose an active chat with one of your agents");
    return { thread, agent, authority: authority ?? "" };
  }
  function itemIn(thread: string, id: string): ChatContinuation {
    const item = store.continuations.get(id)?.value;
    if (!item || item.thread_id !== thread) throw notFound("continuation");
    return item;
  }
  return {
    "continuations.create": (params, ctx) => {
      const { thread, agent, authority } = scope(params.thread, ctx);
      if (ctx.agent && store.runs.get(ctx.agent.run_id)?.input?.origin.kind === "continuation")
        throw badRequest("A follow-up cannot schedule another follow-up");
      const at = clock();
      const expires = new Date(params.expires_at);
      const condition =
        params.condition.kind === "time"
          ? { ...params.condition, at: new Date(params.condition.at).toISOString() }
          : params.condition;
      if (expires.getTime() <= at.getTime() || expires.getTime() - at.getTime() > MAX_WAIT_MS)
        throw badRequest("Choose an expiry within the next seven days");
      if (
        condition.kind === "time" &&
        (Date.parse(condition.at) <= at.getTime() || Date.parse(condition.at) >= expires.getTime())
      )
        throw badRequest("Choose a future time before the expiry");
      if (condition.kind === "task_done") {
        const task = store.tasks.get(condition.task);
        if (!task || task.project_id !== thread.project_id)
          throw badRequest("Choose an open task in this chat's project");
        if (task.state !== "open") throw badRequest("That task has already ended; check it now instead");
      }
      if (store.continuations.list(undefined, true).length >= MAX_ACTIVE)
        throw conflict("Too many pending continuations; cancel one first");
      return store.tx(() => {
        const item = store.continuations.create(
          {
            thread_id: thread.id,
            agent_id: agent,
            project_id: thread.project_id,
            purpose: params.purpose,
            condition,
            expires_at: expires.toISOString(),
            created_at: at.toISOString(),
          },
          authority,
        );
        const when = condition.kind === "time" ? condition.at : (store.tasks.get(condition.task)?.title ?? "");
        continuationNotice(
          store,
          item,
          condition.kind === "time" ? "scheduled" : "waiting",
          condition.kind === "time"
            ? `I'll return for “${item.purpose}” at ${when}. Expires ${item.expires_at}. Ask me to cancel it here.`
            : `I'll return for “${item.purpose}” when “${when}” is completed. Expires ${item.expires_at}. Ask me to cancel it here.`,
          { when, expires: item.expires_at },
        );
        return item;
      });
    },
    "continuations.list": ({ thread }, ctx) => {
      scope(thread, ctx, false);
      return { continuations: store.continuations.list(thread) };
    },
    "continuations.cancel": ({ thread, id }, ctx) => {
      scope(thread, ctx, false);
      return store.tx(() => {
        const item = itemIn(thread, id);
        if (item.state === "canceled") return item;
        if (!store.continuations.change(id, "pending", "canceled"))
          throw conflict("This continuation has already started or ended; canceling cannot undo its actions", {
            state: item.state,
          });
        const canceled = itemIn(thread, id);
        continuationNotice(store, canceled, "canceled", `Canceled: ${item.purpose}. I won't return for this request.`);
        return canceled;
      });
    },
  } satisfies Pick<Handlers, "continuations.create" | "continuations.list" | "continuations.cancel">;
}
