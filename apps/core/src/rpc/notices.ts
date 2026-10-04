// An agent telling the owner something unasked: through the interruption budget (engine/nudges.ts), like a routine's
// news, and into the attention tray either way.
import { channelTexts } from "../channels/texts.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import type { Nudges } from "../engine/nudges.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function noticeHandlers(store: Store, nudges: Nudges) {
  return {
    "notices.notify": ({ text, critical }, ctx) => {
      if (!ctx.agent) throw unauthorized("only an agent at work tells the owner this way");
      const thread = store.threads.get(ctx.agent.thread_id);
      const agent = store.agents.get(ctx.agent.id);
      if (!thread || !agent) throw notFound("the agent's thread");
      // Between agents the answer goes back to the one who asked; the owner hears it from there.
      if (thread.kind === "a2a") throw badRequest("in another agent's thread: answer it there instead");
      if (thread.kind === "routine") throw badRequest("a routine's answer already reaches the owner: say it there");
      const state = nudges.offer({
        kind: `agent:${agent.id}`,
        text: channelTexts(store).routine(agent.name, text),
        thread_id: thread.id,
        project_id: thread.project_id,
        critical,
      });
      store.notifications.add({
        kind: "agent",
        level: critical ? "warn" : "info",
        title: agent.name,
        body: previewOf(text),
        thread_id: thread.id,
      });
      return { state };
    },
  } satisfies Partial<Handlers>;
}
