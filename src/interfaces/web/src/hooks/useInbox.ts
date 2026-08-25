import { useCallback } from "react";
import useSWR from "swr";
import { Inbox, type InboxRow } from "../lib/api/inbox";
import { useLiveMessages } from "./useLiveMessages";

/**
 * Every agent as a conversation, most recent first, super-agent pinned.
 *
 * Scoped to the WEB channel by default: this hook feeds the inbox and the phone,
 * and both are web-only — a Telegram (or any other channel) thread must not
 * surface there. a2a group rows always come through regardless. Pass `channel:
 * null` for the full every-channel roster (the "new chat" agent picker uses it).
 */
export function useInbox(includeEmpty = false, channel: string | null = "web") {
  const { data, error, isLoading, mutate } = useSWR<InboxRow[]>(
    `/api/inbox?include_empty=${includeEmpty ? 1 : 0}&channel=${channel ?? ""}`,
    () => Inbox.list(includeEmpty, channel ?? undefined),
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
