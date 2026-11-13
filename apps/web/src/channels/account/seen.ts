// Who wrote on a channel account and what the owner keeps of them: read only by the account's settings, which load
// late, so the first screen never carries it (AGENTS.md rule 27).
import type { Person, Result } from "@apx/protocol";
import { loadChannels } from "../../data/channels.ts";
import { client } from "../../data/client.ts";
import { createStore, useSlice } from "../../data/createStore.ts";
import { notify } from "../../data/notices.ts";
import { t } from "../../i18n/index.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Who wrote on each account (in private or its rooms), read when its settings open. */
const store = createStore<{ seen: Record<string, Seen[]> }>({ seen: {} });

/** "This is not me": one of the owner's addresses becomes a contact again, unreviewed. */
export async function unclaimAddress(address: string): Promise<boolean> {
  try {
    await client.call("contacts.unclaim", { address });
    notify(t("acct.unclaimed"), "info");
    await loadChannels();
    return true;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}

/** Someone who wrote on the account, as the app lists them; `person_id` when they are on file. */
export type Seen = Result<"contacts.seen">["seen"][number];

/** Everyone who wrote on an account, in its rooms or in private, newest first; none when it cannot be read. */
export async function loadSeen(channel: string): Promise<void> {
  try {
    const { seen } = await client.call("contacts.seen", { channel });
    store.set((s) => ({ seen: { ...s.seen, [channel]: seen } }));
  } catch {
    // Unreadable now: the list shows who is on file.
  }
}

const NOBODY: Seen[] = [];
/** Who wrote on an account, once its settings read it. */
export const useSeen = (channel: string): Seen[] => useSlice(store, (s) => s.seen[channel] ?? NOBODY);

/** The people an account lists: those on file with an address on it, and whoever wrote there and is not. */
export function accountPeople(persons: Person[], seen: Seen[], channel: string) {
  const onFile = persons.filter((p) => p.addresses.some((a) => a.channel === channel));
  const known = new Set(
    onFile.flatMap((p) => p.addresses.filter((a) => a.channel === channel).map((a) => a.external_id)),
  );
  return { onFile, wroteOnly: seen.filter((s) => !known.has(s.address)) };
}

/** Someone who wrote on the account kept as a person: the owner, or a contact not yet approved to be answered. */
export async function keepSeen(
  channel: string,
  address: string,
  as: "contact" | "owner",
  relation?: NonNullable<Person["relation"]>,
): Promise<boolean> {
  try {
    await client.call("contacts.keep", { channel, address, as, ...(relation ? { relation } : {}) });
    if (as === "owner") notify(t("ch.claimed"), "info");
    await loadChannels();
    return true;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}
