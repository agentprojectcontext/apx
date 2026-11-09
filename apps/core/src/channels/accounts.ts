// A channel's accounts: how a new one is named and what it starts with, and the new ones not connected yet, which a
// restart drops (the panel closed while one was added). See DECISIONS.md#d-205
import { randomBytes } from "node:crypto";
import { CHANNEL_DEFAULTS, type ChannelType } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { CHANNEL_CATALOG } from "./catalog.ts";
import type { ChannelConfig } from "./types.ts";

type Saved = Pick<ChannelConfig, "id" | "type" | "label">;
const hex = (chars: number) =>
  randomBytes(Math.ceil(chars / 2))
    .toString("hex")
    .slice(0, chars);

/**
 * A new account's id: the app's name for the first one (as the setup and `apx channels add` make it), a random suffix
 * after it, never its number, address or token. A mailbox always gets one of its own: its signatures are kept by it.
 */
export function newAccountId(type: ChannelType, saved: readonly Pick<Saved, "id">[]): string {
  if (type === "email") return `email-${hex(24)}`;
  return saved.some((c) => c.id === type) ? `${type}-${hex(10)}` : type;
}

/** Why another account of `type` cannot be added, when it cannot: iMessage reads this Mac's one Messages. */
export function cannotAdd(type: ChannelType, saved: readonly Saved[], id?: string): string | undefined {
  if (type === "imessage" && saved.some((c) => c.type === "imessage" && c.id !== id))
    return "iMessage is one per Mac, and it is already set up: change it in its settings";
  return undefined;
}

/** The app's name, numbered from the second account of it on ("WhatsApp 2") so the list tells them apart. */
export function defaultLabel(type: ChannelType, id: string, saved: readonly Saved[]): string {
  const name = CHANNEL_CATALOG[type]?.label ?? type;
  const others = new Set(saved.filter((c) => c.type === type && c.id !== id).map((c) => c.label));
  if (!others.size) return name;
  let n = others.size + 1;
  while (others.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

/** What a new account starts with: the super-agent answers it, and the defaults every channel has. */
export function newAccount(
  type: ChannelType,
  superAgent: string,
  o: Pick<ChannelConfig, "label" | "self_owner" | "email">,
): Omit<ChannelConfig, "id"> {
  return {
    type,
    label: o.label,
    enabled: true,
    agent_id: superAgent,
    strangers: CHANNEL_DEFAULTS.strangers,
    // Mail answers one message after another: a second mail never cuts the answer to the first.
    concurrency: type === "email" ? "queue" : CHANNEL_DEFAULTS.concurrency,
    owner_thread: CHANNEL_DEFAULTS.owner_thread,
    research: CHANNEL_DEFAULTS.research,
    ...(o.self_owner !== undefined ? { self_owner: o.self_owner } : {}),
    ...(o.email ? { email: o.email } : {}),
  };
}

const UNCONNECTED = "channels_unconnected";
function unconnected(store: Store): string[] {
  try {
    const v = JSON.parse(store.settings.get(UNCONNECTED) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** A new account is kept only once it connects. */
export function addedUnconnected(store: Store, id: string): void {
  const ids = unconnected(store);
  if (!ids.includes(id)) store.settings.set(UNCONNECTED, JSON.stringify([...ids, id]));
}

/** It connected (or the owner saved it as it is): it stays. */
export function keptConnected(store: Store, id: string): void {
  const ids = unconnected(store);
  if (ids.includes(id)) store.settings.set(UNCONNECTED, JSON.stringify(ids.filter((x) => x !== id)));
}

/** At boot: the new accounts that never connected, taken out of the saved channels (their sign-in is the caller's). */
export function dropUnconnected(store: Store): ChannelConfig[] {
  const ids = new Set(unconnected(store));
  if (!ids.size) return [];
  const all = store.settings.read("channels");
  store.tx(() => {
    store.settings.write(
      "channels",
      all.filter((c) => !ids.has(c.id)),
    );
    store.settings.set(UNCONNECTED, "[]");
  });
  return all.filter((c) => ids.has(c.id));
}

/** Whether a settings change needs the channel started again (what its adapter is built with). */
export function restartsFor(a: Omit<ChannelConfig, "id">, b: Omit<ChannelConfig, "id">): boolean {
  // The rooms a bot listens to are part of its connection (Discord subscribes to server messages only with some).
  const rooms = (c: Omit<ChannelConfig, "id">) =>
    (c.rooms?.rooms ?? [])
      .map((r) => r.id)
      .sort()
      .join(",");
  return (
    a.type !== b.type ||
    a.enabled !== b.enabled ||
    Boolean(a.self_owner) !== Boolean(b.self_owner) ||
    rooms(a) !== rooms(b) ||
    JSON.stringify(a.email ?? null) !== JSON.stringify(b.email ?? null)
  );
}
