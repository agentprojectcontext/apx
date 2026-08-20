import { useCallback } from "react";
import useSWR from "swr";
import { Inbox, type InboxRow } from "../lib/api/inbox";
import { useLiveMessages } from "./useLiveMessages";

/** Every agent as a conversation, most recent first, super-agent pinned. */
export function useInbox(includeEmpty = false) {
  const { data, error, isLoading, mutate } = useSWR<InboxRow[]>(
    `/api/inbox?include_empty=${includeEmpty ? 1 : 0}`,
    () => Inbox.list(includeEmpty),
    // The live feed below is what makes this list move in real time. The poll
    // stays as the floor for when the socket cannot connect at all (a proxy
    // that drops upgrades, a token that has not landed yet) — a list that is
    // 15s stale is a slow inbox; one that never updates is a broken one.
    { refreshInterval: 15_000 },
  );

  // ANY message anywhere reorders this list — a new row, a new preview, a new
  // timestamp — so there is nothing to match on: revalidate and let the daemon
  // say what the list is now.
  useLiveMessages(useCallback(() => { void mutate(); }, [mutate]));

  return { rows: data ?? [], error, isLoading, mutate };
}
