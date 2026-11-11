import type { Thread } from "@apx/protocol";
import { data } from "../data/state.ts";
import { go } from "../shell/nav.ts";
import { onlyFilter } from "./inboxFilter.ts";

/** An account's newest chat, the one its list opens on. */
function newestChatOf(threads: Record<string, Thread>, account: string): Thread | undefined {
  let newest: Thread | undefined;
  for (const th of Object.values(threads)) {
    if (th.channel?.id !== account || th.archived || th.parent_id) continue;
    if (!newest || th.updated_at > newest.updated_at) newest = th;
  }
  return newest;
}

/** Narrow the Inbox to one account and open its newest chat, so the switch shows; with none, just its list. */
export function openAccount(account: string): void {
  onlyFilter("accounts", account);
  const chat = newestChatOf(data.get().threads, account);
  if (chat) go.inboxThread(chat.id);
  else go.inbox();
}
