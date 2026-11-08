import { createHash } from "node:crypto";
import type { ChannelInfo, Thread } from "@apx/protocol";
import type { Store } from "../domain/store.ts";

/** A delegated task retains the originating channel's limits. Review chats never execute service work. */
export function channelService(store: Store, thread: Thread) {
  let source: Thread | undefined = store.threads.get(thread.id);
  for (let depth = 0; source && depth < 10; depth++) {
    const context = store.threads.context(source.id);
    if (context.service_review) return undefined;
    if (context.room) return undefined;
    if (source.channel) {
      const channel = store.settings.read("channels").find((c) => c.id === source?.channel?.id);
      const person = store.persons.get(source.channel.person_id ?? "");
      if (!channel || !person) return undefined;
      return { source, channel, person, mode: channel.service_mode ?? "base" };
    }
    source = source.parent_id ? store.threads.get(source.parent_id) : undefined;
  }
  return undefined;
}

export function serviceBinding(store: Store, thread: Thread, agent: string): string {
  const service = channelService(store, thread);
  if (!service?.channel.enabled || service.person.role === "blocked" || service.person.muted) return "";
  const active = store.agents.list();
  if (
    !active.some((a) => a.id === agent) ||
    !active.some((a) => a.id === service.channel.agent_id) ||
    service.source.agent_ids[0] !== service.channel.agent_id
  )
    return "";
  return createHash("sha256")
    .update(
      JSON.stringify({
        channel: service.channel,
        source: service.source.id,
        agents: service.source.agent_ids,
        project: service.source.project_id,
        person: {
          id: service.person.id,
          role: service.person.role,
          perms: service.person.perms,
          supervised: service.person.supervised,
          rules: service.person.rules,
        },
        agent: store.agents.get(agent),
        reviewer:
          service.mode === "review"
            ? store.agents.get(active.find((a) => a.kind === "secretary")?.id ?? "")
            : undefined,
        projectSettings: store.projects.get(thread.project_id ?? ""),
      }),
    )
    .digest("hex");
}

export const serviceEnabled = (mode: ChannelInfo["service_mode"]) => mode === "review" || mode === "full";
