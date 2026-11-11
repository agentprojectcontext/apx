import type { Inbound, InboxRow } from "../domain/channels.ts";
import type { Store } from "../domain/store.ts";
import type { RestoreMail } from "./types.ts";

export function restoreMail(
  store: Store,
  process: (row: Pick<InboxRow, "id" | "channel" | "payload">) => Promise<"done" | "ignored" | "failed">,
) {
  return async (channel: string, message: Inbound): ReturnType<RestoreMail> => {
    const payload: Inbound = { ...message, mail_handling: "history", action: undefined };
    const previous = store.channels.inbox.get(channel, payload.external_id);
    if (previous?.state === "ignored") return "skipped";
    if (previous?.state === "failed" && !store.channels.inbox.retryHistory(previous.id, payload)) return "failed";
    const id = previous?.state === "failed" ? previous.id : store.channels.inbox.add(channel, payload);
    if (!id) return "already_seen";
    const state = await process({ id, channel, payload });
    return state === "done" ? "stored" : state === "ignored" ? "skipped" : "failed";
  };
}
