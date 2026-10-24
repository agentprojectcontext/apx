// apx_settings, the people the owner talks to and how: contacts, channels and their stickers, the owner's own profile
// and when they are notified. A channel's sign-in and what its sealed chats may do stay the owner's (DECISIONS.md#d-138).
import type { ChannelHours, Person } from "@apx/protocol";
import { autoApproves } from "../channels/stickers.ts";
import { noticePrefs } from "../domain/notices.ts";
import { ownerIdentity, ownerTimeZone } from "../domain/owner.ts";
import type { Store } from "../domain/store.ts";
import { hoursText } from "./directory.ts";
import { inlineName } from "./result.ts";
import { merged, ownersField, type Params, type Setting, str } from "./settings-kit.ts";

const personOf = (p: Params, store: Store) => (typeof p.id === "string" ? store.persons.get(p.id) : undefined);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** One line per contact with everything the owner edits on their card, and each address's id (contacts.claim). */
export function contactLine(p: Person): string {
  const on = p.addresses.map((a) => `${a.channel} (${a.id})`).join(", ") || "no channel";
  const flags = [
    p.muted ? "silenced" : "",
    p.supervised ? "supervised" : "",
    p.any_hour ? "any hour" : "",
    ...Object.entries(p.perms)
      .filter(([, on]) => on)
      .map(([k]) => `may: ${k}`),
  ].filter(Boolean);
  const bits = [
    p.role !== "contact" ? p.role : "",
    p.relation ?? "",
    p.nickname ? `nickname "${inlineName(p.nickname)}"` : "",
    `on ${on}`,
    ...flags,
  ].filter(Boolean);
  const text = [p.note ? `note: ${p.note}` : "", p.rules ? `rules: ${p.rules}` : ""].filter(Boolean).join("; ");
  return `- ${inlineName(p.name) || "someone"} [${p.id}] (${bits.join(", ")})${text ? ` ${text.slice(0, 600)}` : ""}`;
}

const SHOWN_CONTACTS = 100;

const channelsOf = (store: Store) => store.settings.read("channels");
type Channel = ReturnType<typeof channelsOf>[number];
const channelOf = (store: Store, id: unknown) => channelsOf(store).find((c) => c.id === id);
/** A channel's settings without its id, as channels.set takes them. */
const channelNow = (store: Store, id: unknown): Params | undefined => {
  const ch = channelOf(store, id);
  if (!ch) return undefined;
  const { id: _, ...rest } = ch;
  return rest;
};

function channelLine(store: Store, c: Channel): string {
  const rooms = (c.rooms?.rooms ?? []).map((r) => `#${inlineName(r.name || r.id)} (${r.mode})`).join(", ");
  const bits = [
    c.type,
    c.enabled ? "on" : "off",
    `answered by ${inlineName(store.agents.get(c.agent_id)?.name ?? c.agent_id)}`,
    `strangers: ${c.strangers}`,
    `closers: ${c.closers}`,
    `research: ${c.research}`,
    c.hours ? `hours ${hoursText(c.hours)}` : "any hour",
  ];
  return `- ${inlineName(c.label ?? c.id)} [${c.id}] (${bits.join(", ")})${rooms ? `; rooms: ${rooms}` : ""}`;
}

/** A channel's hours as the owner reads them on the card; none: back to any hour. */
const hoursWords = (v: unknown, { store }: { store: Store }) =>
  v
    ? `Answers contacts ${hoursText(v as ChannelHours)} (${ownerTimeZone(store) ?? "this computer's time zone"}); outside them they wait until the hours begin`
    : "Answers contacts at any hour";

const SIGN_IN = "it carries the channel's sign-in, which the owner types in Settings › Channels";

const stickerOf = (p: Params, store: Store) => (typeof p.id === "string" ? store.stickers.get(p.id) : undefined);

/** One line per kept sticker: what it means, how often it came and was sent, and whether the agent may send it. */
const stickerLine = (s: {
  id: string;
  meaning?: string;
  hint?: string;
  seen: number;
  sent: number;
  blocked: boolean;
  pending: boolean;
  adult: boolean;
}) => {
  const state = s.blocked ? ", you may not send it" : s.pending ? ", waits for the owner's OK" : "";
  const name = s.meaning ? `"${inlineName(s.meaning)}"` : "not named yet";
  return `- [${s.id}] ${name}${s.hint ? ` ${s.hint}` : ""}${s.adult ? " (18+)" : ""} (arrived ${s.seen}, sent ${s.sent}${state})`;
};

export const PEOPLE: Readonly<Record<string, Setting>> = {
  "contacts.list": {
    does: "the contacts with what the owner edits on their card (query narrows by name, nickname or note)",
    read: (p, { store }) => {
      const q = fold(str(p.query).trim());
      const all = store.persons
        .list()
        .filter((x) => x.role !== "owner")
        .filter((x) => !q || [x.name, x.nickname ?? "", x.note ?? ""].some((t) => fold(t).includes(q)));
      if (!all.length) return q ? `no contact matches "${str(p.query)}".` : "no contacts yet.";
      const lines = all.slice(0, SHOWN_CONTACTS).map(contactLine);
      if (all.length > SHOWN_CONTACTS)
        lines.push(`…and ${all.length - SHOWN_CONTACTS} more: narrow it with params.query.`);
      return lines.join("\n");
    },
  },
  "contacts.set": {
    does: "change a contact (id and only what changes: note says who they are, rules how to answer them, any_hour true answers them outside their channel's hours) or add one",
    says: (p, { store }) => {
      const cur = personOf(p, store);
      return cur ? `Change the contact ${inlineName(cur.name)}` : `Add the contact ${inlineName(str(p.name))}`;
    },
    now: (p, { store }) => personOf(p, store),
    words: { any_hour: (v) => (v ? "Answered at any hour" : "Waits for the hours like everyone") },
    keep: (p, { store }) => {
      const cur = personOf(p, store);
      return cur && p.name === undefined ? { ...p, name: cur.name } : p;
    },
    shows: (r) => contactLine(r as Person),
  },
  "contacts.remove": {
    does: "forget a contact (id), or only one of their addresses (address)",
    says: (p, { store }) => {
      const cur = personOf(p, store);
      return cur ? `Forget the contact ${inlineName(cur.name)}` : "Forget an address of a contact";
    },
  },
  "contacts.address": {
    does: "add an address (a phone, a username) on a channel to a contact (person), or to the owner with no person",
    named: ["channel", "address", "person"],
    says: (p, { store }) => {
      const who = typeof p.person === "string" ? store.persons.get(p.person) : undefined;
      const on = inlineName(channelOf(store, p.channel)?.label ?? str(p.channel));
      return `Add ${str(p.address)} on ${on} to ${who ? `the contact ${inlineName(who.name)}` : "you"}`;
    },
    shows: (r) => contactLine(r as Person),
  },
  "contacts.claim": {
    does: "the owner takes an address of a contact as their own (address: its id, as contacts.list shows it)",
    named: ["address"],
    says: (p, { store }) => {
      const from = store.persons.list().find((x) => x.addresses.some((a) => a.id === p.address));
      const a = from?.addresses.find((x) => x.id === p.address);
      return a && from
        ? `Take ${a.channel} ${a.external_id}, now ${inlineName(from.name)}'s, as your own address`
        : "Take an address as your own";
    },
  },
  "channels.list": {
    does: "each channel with who answers it, strangers, closers, research, hours and rooms",
    read: (_p, { store }) =>
      channelsOf(store)
        .map((c) => channelLine(store, c))
        .join("\n") || "no channels set up.",
  },
  "channels.set": {
    does: "change a channel already set up (id, and under channel only what changes: agent_id, strangers, rooms, hours when it answers contacts {days 0 = Sunday, from, to HH:MM in the owner's time zone} or null for any hour…); its sign-in, mail account and research stay the owner's",
    says: (p, { store }) => `Change the channel ${inlineName(channelOf(store, p.id)?.label ?? str(p.id))}`,
    refuse: (p, { store }) => {
      const now = channelNow(store, p.id);
      if (!now) return `no channel "${str(p.id)}": setting up a new one needs its sign-in, in Settings › Channels`;
      if (p.token !== undefined) return `token stays the owner's: ${SIGN_IN}`;
      if (p.channel === null)
        return "removing a channel stays the owner's (its sign-in goes with it): enabled: false turns it off";
      const ch = (p.channel ?? {}) as Params;
      return (
        ownersField(ch, now, "type", "a channel is one app; another one is a new channel") ??
        ownersField(ch, now, "email", SIGN_IN) ??
        ownersField(ch, now, "research", "what a channel's sealed chats may do stays the owner's (DECISIONS.md#d-059)")
      );
    },
    now: (p, { store }) => {
      const channel = channelNow(store, p.id);
      return channel ? { id: p.id, channel } : undefined;
    },
    words: { "channel.hours": hoursWords },
    keep: (p, { store }) => {
      if (!p.channel || typeof p.channel !== "object") return p;
      // hours: null is "any hour": the channel is saved without them.
      const { hours, ...channel } = merged(channelNow(store, p.id), p.channel as Params);
      return { ...p, channel: hours === null ? channel : { ...channel, ...(hours ? { hours } : {}) } };
    },
    shows: () => "saved; channels.list shows it now",
  },
  "imessage.set": {
    does: "turn the iMessage channel on or off (on), on a Mac that lets APX read Messages",
    says: (p) => `Turn iMessage ${p.on ? "on" : "off"}`,
    now: (_p, { store }) => ({ on: store.settings.read("imessage").on }),
  },
  "owner.get": {
    does: "the owner's own profile: name, about, language, time zone",
    read: (_p, { store }) => {
      const o = ownerIdentity(store);
      return [
        `name: ${inlineName(o.name) || "(none)"}`,
        `language: ${o.language}`,
        `time zone: ${o.timezone || "this computer's"}`,
        `about: ${o.about || "(none)"}`,
      ].join("\n");
    },
  },
  "owner.set": {
    does: "change the owner's own profile (only what changes: name, about, language, timezone)",
    says: () => "Change your profile",
    now: (_p, { store }) => ownerIdentity(store),
    keep: (p, { store }) => merged(ownerIdentity(store), p),
  },
  "notices.get": {
    does: "when the owner is notified: quiet hours, daily budget, gaps between notices, the channel they reach",
    read: (_p, { store }) =>
      Object.entries(noticePrefs(store))
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n"),
  },
  "notices.set": {
    does: "change when the owner is notified (only what changes: quiet_from/quiet_to, budget_per_day, channel…)",
    says: () => "Change when you are notified",
    now: (_p, { store }) => noticePrefs(store),
    keep: (p, { store }) => merged(noticePrefs(store), p),
  },
  "stickers.list": {
    does: "the stickers kept from a channel type (platform: whatsapp or telegram), what each means and if you may send it",
    read: (p, { store }) =>
      `New stickers ${autoApproves(store) ? "are yours to use as they come" : "wait for the owner's OK"}.\n` +
        store.stickers
          .list(String(p.platform ?? ""))
          .slice(0, 100)
          .map(stickerLine)
          .join("\n") || "no stickers kept there yet.",
  },
  "stickers.set": {
    does: "say what a sticker means (id, meaning), or approve it (blocked false) or block it (blocked true)",
    says: (p, { store }) => `Change the sticker ${inlineName(stickerOf(p, store)?.meaning ?? str(p.id))}`,
    named: ["id"],
    now: (p, { store }) => {
      const cur = stickerOf(p, store);
      return cur && { meaning: cur.meaning ?? "", blocked: cur.blocked };
    },
    shows: (r) => stickerLine(r as Parameters<typeof stickerLine>[0]),
  },
  "stickers.auto": {
    does: "whether new stickers are yours to use as they come (on), or each waits for the owner's OK; 18+ always waits",
    says: (p) => (p.on ? "Use new stickers as they come" : "Ask me before using each new sticker"),
    now: (_p, { store }) => ({ on: autoApproves(store) }),
  },
  "stickers.remove": {
    does: "forget a sticker and its file (id); if someone sends it again it is kept again",
    says: (p, { store }) => `Forget the sticker ${inlineName(stickerOf(p, store)?.meaning ?? str(p.id))}`,
    named: ["id"],
  },
};
