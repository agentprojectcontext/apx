import useSWR from "swr";
import { Inbox, type InboxRow } from "../lib/api/inbox";

/** Every agent as a conversation, most recent first, super-agent pinned. */
export function useInbox(includeEmpty = false) {
  const { data, error, isLoading, mutate } = useSWR<InboxRow[]>(
    `/api/inbox?include_empty=${includeEmpty ? 1 : 0}`,
    () => Inbox.list(includeEmpty),
    { refreshInterval: 15_000 },
  );
  return { rows: data ?? [], error, isLoading, mutate };
}
