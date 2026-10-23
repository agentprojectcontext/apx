import type { Thread } from "@apx/protocol";
import { useEffect } from "react";
import { loadChannels, useChannels } from "../data/channels.ts";

/**
 * Whether a chat is a contact's (not the owner's own chat on a channel, nor a room's): undefined until the channels
 * and their people are known, which this asks for once.
 */
export function useContactChat(thread: Thread | undefined): boolean | undefined {
  const ready = useChannels((s) => s.ready);
  const personId = thread?.channel?.person_id;
  const role = useChannels((s) => s.persons.find((p) => p.id === personId)?.role);
  const known = useChannels((s) => s.channels.some((c) => c.id === thread?.channel?.id));
  useEffect(() => {
    if (personId && !ready) void loadChannels();
  }, [personId, ready]);
  if (!personId) return false;
  if (!ready) return undefined;
  return known && role !== undefined && role !== "owner";
}
