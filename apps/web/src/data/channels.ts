// Channels the owner runs (channels.*), the people on them (contacts.*) and who waits for approval (pairing.*).
import type { ChannelInfo, NoticePrefs, OutboxItem, PairingRequest, Person, Sticker, Thread } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { type MessageKey, t } from "../i18n/index.ts";
import { loadThread } from "./actions.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

type State = {
  channels: ChannelInfo[];
  persons: Person[];
  pairing: PairingRequest[];
  outbox: OutboxItem[];
  notices: NoticePrefs | undefined;
  /** iMessage as tools on this Mac: whether this machine has it, and whether the owner turned it on. */
  imessage: { available: boolean; on: boolean } | undefined;
  ready: boolean;
};
const store = createStore<State>({
  channels: [],
  persons: [],
  pairing: [],
  outbox: [],
  notices: undefined,
  imessage: undefined,
  ready: false,
});

export const useChannels = <T>(select: (s: State) => T): T => useSlice(store, select);

/** The channel a pairing request came on, while it still waits. */
export const pairingChannel = (code: string) => store.get().pairing.find((r) => r.code === code)?.channel;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadChannels(): Promise<void> {
  try {
    const [c, p, r, o, n, im] = await Promise.all([
      client.call("channels.list", {}),
      client.call("contacts.list", {}),
      client.call("pairing.list", {}),
      client.call("channels.outbox", { limit: 20 }),
      client.call("notices.get", {}),
      client.call("imessage.get", {}),
    ]);
    store.set({
      channels: c.channels,
      persons: p.persons,
      pairing: r.requests,
      outbox: o.items,
      notices: n,
      imessage: im,
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
  /** Discord: the server rooms it reads and may speak in (kept on every save, or they would be dropped). */
  rooms?: ChannelInfo["rooms"];
  /** Silence or an emoji for a message that needs no answer (kept on every save). */
  closers?: ChannelInfo["closers"];
  /** Who may have its rooms and contacts' chats search the web (kept on every save). */
  research?: ChannelInfo["research"];
  /** When it answers contacts; none: at any hour (kept on every save). */
  hours?: ChannelInfo["hours"] | undefined;
  /** Email: the mailbox and its servers (kept on every save). */
  email?: ChannelInfo["email"];
};

/** Lets agents read and send iMessages on this Mac (or stops them). */
export async function setIMessage(on: boolean): Promise<void> {
  try {
    store.set({ imessage: await client.call("imessage.set", { on }) });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
  }
}

const TYPES = [
  "telegram",
  "whatsapp",
  "discord",
  "slack",
  "matrix",
  "mattermost",
  "signal",
  "email",
  "imessage",
  "googlechat",
  "sms",
  "ntfy",
  "nextcloud",
  "irc",
  "twitch",
  "teams",
  "line",
] as const satisfies readonly ChannelInfo["type"][];

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
  supervised?: boolean;
  /** Answered at any hour, past the attention hours of the channel they write on. */
  any_hour?: boolean;
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

/** Asks the channel again for a chat's files that never arrived; the messages update by themselves as they come. */
export async function recoverFiles(thread: string): Promise<void> {
  try {
    const r = await client.call("channels.recover", { thread });
    if (r.recovered.length) notify(t("ch.recover.done", { n: r.recovered.length, total: r.asked }), "info");
    else notify(t("ch.recover.none", { reason: r.reason ?? r.missing[0]?.reason ?? "" }));
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
  }
}

/**
 * A contact's chat on a channel, made empty when they have none yet, ready in the app to write in. Undefined (and a
 * notice) when it could not be opened.
 */
export async function openContactChat(person: string, channel: string): Promise<Thread | undefined> {
  try {
    const thread = await client.call("channels.open", { person, channel });
    data.set((s) => ({ threads: { ...s.threads, [thread.id]: thread } }));
    // Loaded before anything is sent in it: a load landing after the answer would put back an older list.
    await loadThread(thread.id);
    return thread;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return undefined;
  }
}

export type PresenceState = { online: boolean; last_seen?: string | undefined };

/** Who of a channel's contacts is online, by person id; empty when the channel does not tell (or is down). */
export async function loadPresence(channel: string): Promise<Record<string, PresenceState>> {
  try {
    const r = await client.call("channels.presence", { channel });
    return Object.fromEntries(r.people.map(({ person_id, ...p }) => [person_id, p]));
  } catch {
    return {};
  }
}

/** The stickers kept from a channel type, and whether new ones are the agent's to use as they come. */
export async function loadStickers(platform: string): Promise<{ stickers: Sticker[]; auto: boolean } | undefined> {
  try {
    return await client.call("stickers.list", { platform });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return undefined;
  }
}

export async function setStickersAuto(on: boolean): Promise<boolean | undefined> {
  try {
    return (await client.call("stickers.auto", { on })).on;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return undefined;
  }
}

/** The owner's words for a sticker, or whether the agent may send it; the sticker as it is now. */
export async function setSticker(
  id: string,
  patch: { meaning?: string; blocked?: boolean },
): Promise<Sticker | undefined> {
  try {
    return await client.call("stickers.set", { id, ...patch });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return undefined;
  }
}

export async function removeSticker(id: string): Promise<boolean> {
  try {
    return (await client.call("stickers.remove", { id })).removed;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}
