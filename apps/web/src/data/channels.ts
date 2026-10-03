// Channels the owner runs (channels.*), the people on them (contacts.*) and who waits for approval (pairing.*).
import type { ChannelInfo, NoticePrefs, OutboxItem, PairingRequest, Person } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { type MessageKey, t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = {
  channels: ChannelInfo[];
  persons: Person[];
  pairing: PairingRequest[];
  outbox: OutboxItem[];
  notices: NoticePrefs | undefined;
  ready: boolean;
};
const store = createStore<State>({
  channels: [],
  persons: [],
  pairing: [],
  outbox: [],
  notices: undefined,
  ready: false,
});

export const useChannels = <T>(select: (s: State) => T): T => useSlice(store, select);

/** The channel a pairing request came on, while it still waits. */
export const pairingChannel = (code: string) => store.get().pairing.find((r) => r.code === code)?.channel;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadChannels(): Promise<void> {
  try {
    const [c, p, r, o, n] = await Promise.all([
      client.call("channels.list", {}),
      client.call("contacts.list", {}),
      client.call("pairing.list", {}),
      client.call("channels.outbox", { limit: 20 }),
      client.call("notices.get", {}),
    ]);
    store.set({
      channels: c.channels,
      persons: p.persons,
      pairing: r.requests,
      outbox: o.items,
      notices: n,
      ready: true,
    });
  } catch (e) {
    store.set({ ready: true });
    notify(t("error.channels", { error: errText(e) }));
  }
}

export type ChannelDraft = {
  agent_id: string;
  enabled: boolean;
  strangers: ChannelInfo["strangers"];
  concurrency: ChannelInfo["concurrency"];
  owner_thread: ChannelInfo["owner_thread"];
  self_owner?: boolean | undefined;
};

const TYPES = ["telegram", "whatsapp", "discord", "slack"] as const;

/** Saves a channel (and its token when one was typed); the core restarts it. */
export async function saveChannel(id: string, draft: ChannelDraft | null, token?: string): Promise<boolean> {
  // A setting shows changed at once; the core's answer confirms it (or a failure puts it back).
  const before = store.get().channels;
  if (draft && before.some((c) => c.id === id))
    store.set({ channels: before.map((c) => (c.id === id ? { ...c, ...draft } : c)) });
  try {
    const r = await client.call("channels.set", {
      id,
      // One channel per kind for now: its id is its type.
      channel: draft ? { type: TYPES.find((k) => k === id) ?? "telegram", ...draft } : null,
      ...(token ? { token } : {}),
    });
    store.set({ channels: r.channels });
    return true;
  } catch (e) {
    store.set({ channels: before });
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}

/** What to tell the owner when a code was used already or ran out (the core says which in the error's detail). */
const PAIRING_WAS: Record<string, MessageKey> = {
  approved: "ch.code.approved",
  denied: "ch.code.denied",
  expired: "ch.code.expired",
};

export async function respondPairing(code: string, decision: "owner" | "contact" | "deny"): Promise<void> {
  try {
    await client.call("pairing.respond", { code, decision });
  } catch (e) {
    const was = e instanceof ApxError ? (e.detail as { pairing?: string } | undefined)?.pairing : undefined;
    const key = was ? PAIRING_WAS[was] : undefined;
    notify(key ? t(key, { code }) : t("error.channels", { error: errText(e) }));
  }
  await loadChannels();
}

/** The owner's own address on a channel, typed by hand (their phone number on WhatsApp). */
export async function addOwnerAddress(channel: string, address: string): Promise<boolean> {
  try {
    await client.call("contacts.address", { channel, address });
    notify(t("ch.claimed"), "info");
    await loadChannels();
    return true;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}

/** "This account is mine": an address approved as a contact's becomes the owner's. */
export async function claimAddress(address: string): Promise<boolean> {
  try {
    await client.call("contacts.claim", { address });
    notify(t("ch.claimed"), "info");
    await loadChannels();
    return true;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}

export async function setPersonRole(p: Person, role: "contact" | "blocked"): Promise<void> {
  try {
    await client.call("contacts.set", { id: p.id, name: p.name, role });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
  }
  await loadChannels();
}

export async function removePerson(id: string): Promise<void> {
  try {
    await client.call("contacts.remove", { id });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
  }
  await loadChannels();
}

export async function unlinkAddress(address: string): Promise<void> {
  try {
    await client.call("contacts.remove", { address });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
  }
  await loadChannels();
}

export async function saveNotices(prefs: NoticePrefs): Promise<void> {
  try {
    store.set({ notices: await client.call("notices.set", prefs) });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
  }
}

/** What the channel view changes about a contact. */
export type ContactDraft = {
  name: string;
  nickname?: string;
  relation?: Person["relation"] | null;
  note?: string;
  rules?: string;
  muted?: boolean;
  perms?: Partial<Person["perms"]>;
};

export async function saveContact(id: string, draft: ContactDraft): Promise<boolean> {
  try {
    const p = await client.call("contacts.set", { id, ...draft });
    store.set((s) => ({ persons: s.persons.map((x) => (x.id === p.id ? p : x)) }));
    return true;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}

/** The owner writes to the contact themselves, in that contact's chat. */
export async function sendDirect(thread: string, text: string): Promise<boolean> {
  try {
    await client.call("channels.send", { thread, text });
    return true;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}
