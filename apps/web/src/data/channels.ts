// Channels the owner runs (channels.*), the people on them (contacts.*) and who waits for approval (pairing.*).
import type { ChannelInfo, OutboxItem, PairingRequest, Person } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = {
  channels: ChannelInfo[];
  persons: Person[];
  pairing: PairingRequest[];
  outbox: OutboxItem[];
  ready: boolean;
};
const store = createStore<State>({ channels: [], persons: [], pairing: [], outbox: [], ready: false });

export const useChannels = <T>(select: (s: State) => T): T => useSlice(store, select);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadChannels(): Promise<void> {
  try {
    const [c, p, r, o] = await Promise.all([
      client.call("channels.list", {}),
      client.call("contacts.list", {}),
      client.call("pairing.list", {}),
      client.call("channels.outbox", { limit: 20 }),
    ]);
    store.set({ channels: c.channels, persons: p.persons, pairing: r.requests, outbox: o.items, ready: true });
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
};

/** Saves a channel (and its token when one was typed); the core restarts it. */
export async function saveChannel(id: string, draft: ChannelDraft | null, token?: string): Promise<boolean> {
  try {
    const r = await client.call("channels.set", {
      id,
      channel: draft ? { type: "telegram", ...draft } : null,
      ...(token ? { token } : {}),
    });
    store.set({ channels: r.channels });
    return true;
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
    return false;
  }
}

export async function respondPairing(code: string, decision: "owner" | "contact" | "deny"): Promise<void> {
  try {
    await client.call("pairing.respond", { code, decision });
  } catch (e) {
    notify(t("error.channels", { error: errText(e) }));
  }
  await loadChannels();
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
