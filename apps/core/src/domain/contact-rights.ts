import { type ContactRights, contactRightsOf, type Person } from "@apx/protocol";
import type { Store } from "./store.ts";

/** What a person's chat on an account may do: what the owner set for them, else what the account sets for contacts. */
export function contactRights(store: Store, person: Pick<Person, "perms"> | undefined, channel: string): ContactRights {
  const account = store.settings.read("channels").find((c) => c.id === channel)?.contacts;
  return contactRightsOf(person?.perms, account);
}
