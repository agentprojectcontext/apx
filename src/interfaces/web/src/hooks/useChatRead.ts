import { useSyncExternalStore } from "react";
import type { InboxRow } from "../lib/api/inbox";
import { isRowUnread, readMarksVersion, subscribeReadMarks } from "../lib/chat-read";
import { channelEnabledIn } from "../lib/channels";
import { projectEnabledIn } from "../lib/provenance";
import { useChannelPrefs } from "./useChannelPrefs";
import { useProjectPrefs } from "./useProjectPrefs";
import { useInbox } from "./useInbox";

/** Does this row hold something the agent said that has not been read here? */
export function useRowUnread(row: InboxRow): boolean {
  return useSyncExternalStore(
    subscribeReadMarks,
    () => isRowUnread(row),
    () => isRowUnread(row),
  );
}

/**
 * How many conversations are waiting — the number on the Chats rail.
 *
 * Conversations, not messages: the daemon gives a row one preview and one
 * timestamp, so "three chats have something new" is a fact, and "seven new
 * messages" would be a guess dressed up as a count.
 *
 * Filtered by the SAME two switches the inbox list obeys. A badge for a channel
 * this device has hidden is a badge you cannot clear: you would open the inbox,
 * find nothing new, and the number would still be there.
 */
export function useUnreadChats(): number {
  const { rows } = useInbox();
  const view = useChannelPrefs("view");
  const scope = useProjectPrefs();
  // Re-read on every mark change; the count itself is derived below so the
  // snapshot stays a stable primitive.
  useSyncExternalStore(subscribeReadMarks, readMarksVersion, readMarksVersion);
  return rows.filter(
    (r) =>
      channelEnabledIn(view.prefs, "view", r.channel) &&
      projectEnabledIn(scope.prefs, r.project_id) &&
      isRowUnread(r),
  ).length;
}
