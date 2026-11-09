// One person a platform knew under two addresses (WhatsApp's private id and the number it stands for) becomes one
// contact and one chat once the line can tell, each time it connects.
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { ChannelAdapter } from "./types.ts";

/** How many contacts or chats changed; a chat with a turn going is joined on a later connect. */
export async function joinSplitContacts(
  store: Store,
  channel: string,
  adapter: ChannelAdapter,
  log?: Log,
): Promise<number> {
  if (!adapter.sameAs) return 0;
  try {
    const pairs = await adapter.sameAs(store.persons.addressesOn(channel));
    let joined = 0;
    for (const { from, to } of pairs) {
      if (alreadyOne(store, channel, from, to)) continue;
      const changed = store.tx(() => {
        // What they wrote is found under the number too: a reaction answers their last message there.
        store.channels.inbox.readdress(channel, from, to);
        const people = store.persons.joinPeople(channel, from, to);
        return store.threads.joinChats(channel, from, to) === "joined" || people;
      });
      if (changed) joined++;
    }
    if (joined) log?.info({ channel, joined }, "contacts known under two addresses joined");
    return joined;
  } catch (err) {
    log?.warn({ channel, err: errorMessage(err, 200) }, "split contacts not joined");
    return 0;
  }
}

/** Joined on an earlier connect: one person has both addresses and no chat is left under the first. */
function alreadyOne(store: Store, channel: string, from: string, to: string): boolean {
  const person = store.persons.byAddress(channel, from);
  return (
    person !== undefined &&
    store.persons.byAddress(channel, to)?.id === person.id &&
    !store.threads.byConversation(channel, from)
  );
}
