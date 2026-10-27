import type { Thread } from "@apx/protocol";
import { useChannels } from "../data/channels.ts";

/** Person IDs are meaningful only on a channel where that person has an address. */
export function useThreadPerson(thread: Thread) {
  return useChannels((s) =>
    thread.channel?.person_id
      ? s.persons.find(
          (p) => p.id === thread.channel?.person_id && p.addresses.some((a) => a.channel === thread.channel?.id),
        )
      : undefined,
  );
}
