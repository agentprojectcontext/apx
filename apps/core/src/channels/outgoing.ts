// What goes out to people and rooms outside a turn's answer: the owner writing to a contact, an agent messaging a
// contact or posting in a room, and what a channel knows about a person (their picture, whether they are online).
import type { ChannelInfo, OutboxItem } from "@apx/protocol";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { audienceOf } from "../engine/audience.ts";
import type { Services } from "../services/registry.ts";
import type { createDelivery } from "./delivery.ts";
import type { createPoster, Posted } from "./post.ts";
import { type createRooms, quietMentions, roomMentions } from "./rooms.ts";
import type { ChannelAdapter, ChannelConfig, Presence } from "./types.ts";

const AVATAR_TTL_MS = 24 * 3600_000;
const SETTLE_POLL_MS = 100;

export function createOutgoing(deps: {
  store: Store;
  configs: () => ChannelConfig[];
  /** A channel's running adapter, when it has one. */
  live: (id: string) => { adapter: ChannelAdapter; status: ChannelInfo["status"] } | undefined;
  delivery: Pick<ReturnType<typeof createDelivery>, "enqueue">;
  poster: ReturnType<typeof createPoster>;
  rooms: Pick<ReturnType<typeof createRooms>, "thread">;
  services: Pick<Services, "keep">;
}) {
  const { store, configs, delivery, rooms } = deps;
  const { post, recentOf } = deps.poster;

  /**
   * The owner writing to a contact or a room themselves ("I'll write"): sent as is on its conversation, kept in the
   * chat as the owner's words, and noted for the agent so its next answer knows what was said. In a room nothing
   * comes back: the post is not kept as one message.
   */
  function sendAsOwner(
    threadId: string,
    text: string,
    options: { omit_signature?: boolean | undefined } = {},
  ): { outbox: string; message_id: string } | undefined {
    const thread = store.threads.get(threadId);
    const ch = thread?.channel;
    // In a room the owner's words go out as they are, through the bot's account (it is the only one APX has there).
    if (thread && ch && store.threads.context(threadId).room) {
      const named = roomMentions(quietMentions(text), store.channels.inbox.people(ch.id, ch.conversation));
      post(thread, ch.id, ch.conversation, named.text, { logged: false, mentions: named.mentions });
      return undefined;
    }
    if (!thread || !ch?.person_id || audienceOf(store, thread).kind !== "contact")
      throw new Error("only a contact's chat on a channel can be written to directly");
    const name = audienceOf(store, thread).kind === "contact" ? (store.persons.get(ch.person_id)?.name ?? "them") : "";
    const sent = store.tx(() => {
      const m = store.messages.add({
        thread_id: threadId,
        author: { kind: "user", direct: true },
        parts: [{ type: "text", text }],
      });
      store.modelLog.append(threadId, undefined, [
        { role: "user", content: `[Your owner wrote to ${name} directly in this chat:]\n${text}` },
      ]);
      store.threads.patch(threadId, { preview: previewOf(text) });
      return m;
    });
    const outbox = delivery.enqueue({
      channel: ch.id,
      conversation: ch.conversation,
      thread_id: threadId,
      message_id: sent.id,
      kind: "reply",
      body: { text, ...(options.omit_signature !== undefined ? { omit_signature: options.omit_signature } : {}) },
    });
    return { outbox, message_id: sent.id };
  }

  /**
   * A person's chat on a channel: the one with their latest words (on `channel`, an id or type, when given), else a new
   * empty one on the first channel that knows them, its answers going back to them.
   */
  function chatWith(personId: string, channel?: string) {
    const person = store.persons.get(personId);
    if (!person || person.role === "blocked") throw new Error(`${personId} is not one of the owner's contacts`);
    const wanted = channel?.toLowerCase();
    const options = person.addresses.flatMap((a) => {
      const cfg = configs().find((c) => c.id === a.channel);
      if (!cfg || (wanted && cfg.id !== wanted && cfg.type !== wanted)) return [];
      const chat = store.threads.byConversation(cfg.id, a.external_id);
      return [{ cfg, conversation: a.external_id, chat, running: deps.live(cfg.id)?.status === "running" }];
    });
    if (!options.length)
      throw new Error(
        wanted
          ? `${person.name} has no address on ${channel}`
          : `${person.name} has no address on any channel APX runs`,
      );
    const pick = [...options].sort(
      (a, b) =>
        (b.chat?.updated_at ?? "").localeCompare(a.chat?.updated_at ?? "") || Number(b.running) - Number(a.running),
    )[0] as (typeof options)[number];
    const owner = person.role === "owner";
    let thread = pick.chat ?? (owner ? store.threads.get(HOME_THREAD_ID) : undefined);
    if (!thread) {
      thread = store.threads.create({
        kind: "channel",
        title: person.name,
        agent_ids: [pick.cfg.agent_id],
        channel: { id: pick.cfg.id, conversation: pick.conversation, person_id: person.id },
      });
      store.threads.mergeContext(thread.id, { reply_to: { channel: pick.cfg.id, conversation: pick.conversation } });
    }
    return { person, pick, owner, thread };
  }

  /**
   * An agent writes to a contact for the owner: on the channel asked for, else the one with the contact's most recent
   * chat, else the first running one that knows them. Kept in their chat (where their answer will come in) and in what
   * that chat's agent reads, then sent through the outbox.
   */
  function messageContact(
    personId: string,
    text: string,
    /** `by`: the agent writing; none: the owner themselves. `files`: media ids sent with it. */
    o: {
      channel?: string | undefined;
      by?: string | undefined;
      files?: string[] | undefined;
      omit_signature?: boolean | undefined;
    },
  ): Posted {
    const { pick, owner, thread } = chatWith(personId, o.channel);
    // The chat's agent answers the contact's reply knowing it wrote this first (the owner's own chat logs its turns).
    const recent = recentOf(thread.id);
    const outbox = post(thread, pick.cfg.id, pick.conversation, text, { ...o, logged: !owner });
    return { thread: thread.id, channel: pick.cfg.label, recent, outbox };
  }

  /**
   * An agent posts in a public room (a Discord server's channel the owner listed) for the owner: kept in the room's
   * chat, sent with no pings to everyone; the room's people it names as @handle are mentioned. `room` is its exact
   * name, with or without "#"; `channel` (an id or type) tells two rooms of the same name apart. A near name only gets
   * suggestions: a public post cannot be taken back.
   */
  function postInRoom(
    room: string,
    text: string,
    o: { channel?: string | undefined; by?: string | undefined; files?: string[] | undefined },
  ): Posted {
    const wanted = room.trim().replace(/^#/, "").toLowerCase();
    const on = o.channel?.toLowerCase();
    const all = configs().flatMap((cfg) =>
      cfg.enabled && (!on || cfg.id === on || cfg.type === on)
        ? (cfg.rooms?.rooms ?? []).map((r) => ({ cfg, room: r, name: r.name || r.id }))
        : [],
    );
    const exact = all.filter((r) => r.name.toLowerCase() === wanted || r.room.id === wanted);
    if (exact.length !== 1) {
      const near = all.filter((r) => r.name.toLowerCase().includes(wanted) || wanted.includes(r.name.toLowerCase()));
      const list = (rs: typeof all) => rs.map((r) => `#${r.name} (${r.cfg.label})`).join(", ") || "none";
      throw new Error(
        exact.length
          ? `"${room}" is a room on several channels: ${list(exact)}; say which channel`
          : near.length
            ? `no room "${room}"; did you mean ${list(near)}?`
            : `no room "${room}". Rooms: ${list(all)}`,
      );
    }
    const { cfg, room: r } = exact[0] as (typeof exact)[number];
    const thread = rooms.thread(cfg, r);
    const recent = recentOf(thread.id);
    const named = roomMentions(quietMentions(text), store.channels.inbox.people(cfg.id, r.id));
    const outbox = post(thread, cfg.id, r.id, named.text, { ...o, logged: false, mentions: named.mentions });
    return { thread: thread.id, channel: cfg.label, recent, outbox };
  }

  /**
   * A person's profile picture from the first running channel that knows them and shows one, kept as media for a day
   * (a list asks for it on every screen; the platform is asked again only after that).
   */
  async function avatar(personId: string): Promise<string | undefined> {
    const key = `avatar:${personId}`;
    try {
      const was = JSON.parse(store.settings.get(key) ?? "null") as { media?: string; at: number } | null;
      if (was && Date.now() - was.at < AVATAR_TTL_MS && (!was.media || store.media.get(was.media))) return was.media;
    } catch {}
    const person = store.persons.get(personId);
    let asked = false;
    for (const a of person?.addresses ?? []) {
      const l = deps.live(a.channel);
      if (!l?.adapter.avatar || l.status !== "running") continue;
      asked = true;
      try {
        const pic = await l.adapter.avatar(a.external_id);
        if (!pic?.data.length) continue;
        const m = deps.services.keep(pic.data, pic.mime);
        store.settings.set(key, JSON.stringify({ media: m.id, at: Date.now() }));
        return m.id;
      } catch {
        // A picture that cannot be read is a list without a face, not an error to show.
      }
    }
    // None shown: not asked again for a day. No channel running: ask again next time.
    if (asked) store.settings.set(key, JSON.stringify({ at: Date.now() }));
    return undefined;
  }

  /** Who of the contacts on a channel is online, as far as it knows (WhatsApp); asking keeps it listening for them. */
  function presence(channelId: string): Array<{ person_id: string } & Presence> {
    const l = deps.live(channelId);
    if (!l?.adapter.presence || l.status !== "running") return [];
    const people = store.persons
      .list()
      .filter((p) => p.role === "contact")
      .flatMap((p) => p.addresses.filter((a) => a.channel === channelId).map((a) => ({ p, a })));
    const known = l.adapter.presence(people.map((x) => x.a.external_id));
    return people.flatMap(({ p, a }) => {
      const s = known[a.external_id];
      return s ? [{ person_id: p.id, ...s }] : [];
    });
  }

  /**
   * How a send went, waiting up to `ms` for the platform: sent, refused (failed, with why), uncertain, or still queued
   * (a channel that is down retries later).
   */
  async function settled(outboxId: string, ms: number): Promise<{ state: OutboxItem["state"]; error?: string }> {
    const end = Date.now() + ms;
    for (;;) {
      const o = store.channels.outbox.get(outboxId);
      const done = o && (o.state === "sent" || o.state === "failed" || o.state === "uncertain");
      if (!o || done || Date.now() >= end)
        return { state: o?.state ?? "failed", ...(o?.error && o.state !== "sent" ? { error: o.error } : {}) };
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
  }

  return {
    sendAsOwner,
    settled,
    messageContact,
    postInRoom,
    avatar,
    presence,
    /** A person's chat on a channel, made (empty) when they have none yet. */
    openChat: (personId: string, channel: string) => chatWith(personId, channel).thread,
  };
}
