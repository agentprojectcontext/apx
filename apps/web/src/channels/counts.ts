import { useMemo } from "react";
import { useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";

export type AccountCounts = { unread: number; waiting: number };

/** Per account: the unread messages in its chats and who waits to be let in. */
export function useAccountCounts(): Map<string, AccountCounts> {
  const threads = useData((s) => s.threads);
  const pairing = useChannels((s) => s.pairing);
  return useMemo(() => {
    const counts = new Map<string, AccountCounts>();
    const at = (id: string) => {
      const c = counts.get(id) ?? { unread: 0, waiting: 0 };
      counts.set(id, c);
      return c;
    };
    for (const thread of Object.values(threads)) if (thread.channel) at(thread.channel.id).unread += thread.unread;
    for (const request of pairing) at(request.channel).waiting += 1;
    return counts;
  }, [threads, pairing]);
}
