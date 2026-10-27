import type { Thread } from "@apx/protocol";
import { isChannelKind } from "../channels/kinds.ts";
import { useChannels } from "../data/channels.ts";

/** A thread keeps a channel instance ID; only its channel metadata identifies the platform. */
export function useThreadChannel(thread: Thread) {
  const kind = useChannels((s) => s.channels.find((channel) => channel.id === thread.channel?.id)?.type);
  return kind && isChannelKind(kind) ? kind : undefined;
}
