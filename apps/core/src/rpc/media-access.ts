import { canReadChat } from "../domain/chat-access.ts";
import type { MediaRecord } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";
import { boardScope, visibleTask } from "../domain/tasks.ts";
import { audienceOf } from "../engine/audience.ts";
import { notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";

export function assetCaller(store: Store, ctx: CallContext) {
  if (ctx.actor === "human" && !ctx.agent && !ctx.client && !ctx.channel) return undefined;
  const caller = ctx.agent;
  const run = caller && store.runs.get(caller.run_id);
  const current = caller && store.threads.get(caller.thread_id);
  const agent = caller && store.agents.get(caller.id);
  if (
    !caller ||
    !agent ||
    !current ||
    ctx.client ||
    run?.state !== "working" ||
    run.thread_id !== current.id ||
    run.agent_id !== agent.id ||
    audienceOf(store, current).kind !== "owner" ||
    store.threads.context(current.id).client
  )
    throw unauthorized("media unavailable outside a live owner chat");
  return agent;
}

/** A readable chat is not permission to export a contact's sealed attachments. */
export function readableMedia(store: Store, id: string, ctx: CallContext): MediaRecord {
  const agent = assetCaller(store, ctx);
  const media = store.media.get(id);
  if (!media) throw notFound("media unavailable");
  if (!agent) return media;
  if (store.taskAttachments.pending(id)) throw unauthorized("media unavailable while pending cleanup");
  const source = media.thread_id && store.threads.get(media.thread_id);
  if (!source || audienceOf(store, source).kind !== "owner" || store.threads.context(source.id).client)
    throw unauthorized("media unavailable in readable owner chats");
  const task = store.tasks.byThread(source.id);
  if (task) visibleTask(store, task.id, boardScope(store, ctx.agent));
  else if (!canReadChat(store, agent, source)) throw unauthorized("media unavailable in readable owner chats");
  return media;
}
