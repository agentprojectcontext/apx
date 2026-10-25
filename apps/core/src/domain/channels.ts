// What channels receive and send, durably. Inbound rows are written before the platform hears "got it"; outbound rows
// before anything is sent, so a crash leaves an honest state (a send that may have gone out is "uncertain", never
// silently repeated).

import { randomInt } from "node:crypto";
import type { OutboxItem, PairingRequest } from "@apx/protocol";
import { type Selectable, sql } from "kysely";
import type { OutboxTable, PairingTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

/**
 * The channels whose owner messages act directly: the platform proves the sending account (WhatsApp and Signal by its
 * end-to-end keys). Elsewhere its word for who wrote is weaker (a topic, a nick, a From line), so the owner's words
 * reach the super-agent to check first (DECISIONS.md#d-144, DECISIONS.md#d-150).
 */
const OWNER_ACTS_ON: ReadonlySet<string> = new Set(["telegram", "whatsapp", "signal"]);
export const ownerActsOn = (type: string | undefined): boolean => type !== undefined && OWNER_ACTS_ON.has(type);

/** What an adapter hands over for one platform message. */
export type Inbound = {
  /** The platform's id for this message (dedupes a redelivery). */
  external_id: string;
  /** Where to answer (a chat id). */
  conversation: string;
  /** `handle`: the name others write to mention them (a Discord @username), where the platform has one. */
  sender: { id: string; name: string; handle?: string | undefined };
  text: string;
  /** A button choice carried by this message; deduped with its platform id before it is handled. */
  action?: string | undefined;
  /** Other people the message @mentions (the bot itself left out), written as @handle in `text`. */
  mentions?: Array<{ id: string; handle: string }> | undefined;
  /** A one-to-one conversation; anything else reaches the agent only as a listed room (see `room`). */
  private: boolean;
  /** A message in a server's room the owner listed: whether it called the bot (an @mention or a reply to it). */
  room?: { called: boolean } | undefined;
  /**
   * Downloaded attachments, persisted in the inbox before the platform confirms delivery. `sticker`: the file is one
   * (`hint`: the emoji the platform says it stands for).
   */
  files?:
    | Array<{ name: string; mime: string; data: string; sticker?: { hint?: string | undefined } | undefined }>
    | undefined;
  /** A voice note or audio, to be transcribed before an agent reads it. */
  voice?: { mime: string; data: string } | undefined;
  /** The platform's id of the message itself, to react to it, when `external_id` is something else (an update id). */
  ref?: string | undefined;
};

/** An emoji someone put on a message (`target`: the platform's id of it); `emoji` empty when they took it off. */
export type InboundReaction = {
  conversation: string;
  sender: { id: string; name: string };
  target: string;
  emoji: string;
  private: boolean;
};

/** A button press: the platform's id for it, the conversation, who pressed and the button's data. */
export type InboundAction = {
  conversation: string;
  sender: { id: string; name: string };
  data: string;
  /** The platform's id of the message whose button was pressed, where its buttons can be changed. */
  ref?: string;
};

/** What goes out: text, and buttons when the owner is asked something. */
export type Presentation = {
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  /** A notice the owner may rate with a reaction (👍/👎): the nudge it is. */
  rate?: string;
  /** Delivered without sound (quiet hours). */
  silent?: boolean;
  /** Parts already delivered by an earlier attempt (text chunks first, then media). */
  skip?: number;
  /** Images, voice notes, stickers and files (a document, sent as one, with its name), after the text. */
  media?: Array<{
    id: string;
    kind: "image" | "audio" | "file" | "sticker";
    mime: string;
    name?: string | undefined;
    /** What a sticker shows, for the list of what was sent (adapters ignore it). */
    about?: string | undefined;
  }>;
  /** An emoji the agent put on a message: recorded as sent, never queued (the adapter's `react` put it). */
  reaction?: string;
  /** A voice note and what it says: the audio first, the text as its caption where the channel allows one. */
  mediaFirst?: boolean;
  /** In a room: the message this answers (shown as a reply to it). */
  reply_to?: string;
  /** People of the room the text names as @handle: they get pinged where the channel can (never @everyone). */
  mentions?: Array<{ id: string; handle: string }>;
  /** A notice for the owner: the channels that already refused it, so the next try goes elsewhere. */
  refused_by?: string[];
  /** Internal correlation for free-form replies to an input; adapters ignore it. */
  input_id?: string;
};

/** A contact's chat waiting for its channel's hours: where to answer, and since when it waits. */
export type HeldChat = {
  thread_id: string;
  channel: string;
  conversation: string;
  sender: string;
  person_id: string;
  since: string;
};

export type InboxRow = { id: string; channel: string; payload: Inbound; state: string };
export type OutboxRow = OutboxItem & { body: Presentation; next_at: string; external_id?: string; message_id?: string };

const toOut = (r: Selectable<OutboxTable>): OutboxRow => {
  const body = JSON.parse(r.body) as Presentation;
  return {
    id: r.id,
    channel: r.channel,
    conversation: r.conversation,
    ...opt("thread_id", r.thread_id),
    kind: r.kind as OutboxItem["kind"],
    text: body.text,
    body,
    state: r.state as OutboxItem["state"],
    attempts: r.attempts,
    ...opt("error", r.error),
    ...opt("external_id", r.external_id),
    ...opt("message_id", r.message_id),
    next_at: r.next_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
};

export const publicOutbox = ({ body, next_at: _n, external_id: _e, message_id: _m, ...o }: OutboxRow): OutboxItem => {
  const sticker = body.media?.find((m) => m.kind === "sticker");
  return {
    ...o,
    ...(sticker ? { sticker: sticker.about ?? "" } : {}),
    ...(body.reaction ? { reaction: body.reaction } : {}),
  };
};

const PAIRING_TTL_MS = 24 * 3600_000;

export function channelsRepo({ one, all, run }: Sql) {
  const outRow = (id: string) => one(qb.selectFrom("outbox").selectAll().where("id", "=", id));
  const pairingRow = (code: string) => one(qb.selectFrom("pairing").selectAll().where("code", "=", code));
  return {
    inbox: {
      /** Stores a message; false when this platform message was already stored (a redelivery). */
      add(channel: string, m: Inbound): string | undefined {
        const id = newId("in");
        const changes = run(
          qb
            .insertInto("channel_inbox")
            .values({
              id,
              channel,
              external_id: m.external_id,
              conversation: m.conversation,
              sender: m.sender.id,
              payload: JSON.stringify(m),
              state: "received",
              created_at: now(),
            })
            .onConflict((c) => c.doNothing()),
        );
        return changes > 0 ? id : undefined;
      },
      pending(): InboxRow[] {
        return all(
          qb.selectFrom("channel_inbox").selectAll().where("state", "=", "received").orderBy("created_at"),
        ).map((r) => ({
          id: r.id,
          channel: r.channel,
          payload: JSON.parse(r.payload) as Inbound,
          state: r.state,
        }));
      },
      /**
       * Who wrote or was mentioned in a conversation's latest messages, by handle (newest first, one per person): those
       * an answer there may mention.
       */
      people(channel: string, conversation: string, limit = 500): Array<{ id: string; handle: string }> {
        const rows = all(
          qb
            .selectFrom("channel_inbox")
            .select("payload")
            .where("channel", "=", channel)
            .where("conversation", "=", conversation)
            .orderBy("created_at", "desc")
            .limit(limit),
        );
        const seen = new Map<string, { id: string; handle: string }>();
        for (const r of rows) {
          const m = JSON.parse(r.payload) as Inbound;
          // Rows kept before senders had a handle carry it in their name, "Name (@handle)" (see discord.ts nameOf).
          const handle = m.sender.handle ?? /\(@([^\s()]+)\)$/.exec(m.sender.name)?.[1];
          for (const p of [...(handle ? [{ id: m.sender.id, handle }] : []), ...(m.mentions ?? [])])
            if (!seen.has(p.id)) seen.set(p.id, p);
        }
        return [...seen.values()];
      },
      /** A conversation's messages as they came in (oldest first), each with the platform's id and its arrival. */
      history(
        channel: string,
        conversation: string,
        limit = 2000,
      ): Array<{ external_id: string; created_at: string; payload: Inbound }> {
        const newest = qb
          .selectFrom("channel_inbox")
          .select(["external_id", "created_at", "payload"])
          .where("channel", "=", channel)
          .where("conversation", "=", conversation)
          .orderBy("created_at", "desc")
          .limit(limit);
        return all(qb.selectFrom(newest.as("m")).selectAll().orderBy("created_at")).map((r) => ({
          external_id: r.external_id,
          created_at: r.created_at,
          payload: JSON.parse(r.payload) as Inbound,
        }));
      },
      /** The last message that came in on a conversation. */
      latest(channel: string, conversation: string): Inbound | undefined {
        const r = one(
          qb
            .selectFrom("channel_inbox")
            .select("payload")
            .where("channel", "=", channel)
            .where("conversation", "=", conversation)
            .orderBy("created_at", "desc")
            .limit(1),
        );
        return r ? (JSON.parse(r.payload) as Inbound) : undefined;
      },
      /** Handled: its files' bytes leave the row (they are in media by now), so reading the inbox stays cheap. */
      done(id: string, state: "done" | "ignored" | "failed", error?: string): void {
        const row = one(qb.selectFrom("channel_inbox").select("payload").where("id", "=", id));
        const m = row ? (JSON.parse(row.payload) as Inbound) : undefined;
        const light =
          m && (m.files?.length || m.voice)
            ? JSON.stringify({
                ...m,
                ...(m.files ? { files: m.files.map((f) => ({ ...f, data: "" })) } : {}),
                ...(m.voice ? { voice: { ...m.voice, data: "" } } : {}),
              })
            : undefined;
        run(
          qb
            .updateTable("channel_inbox")
            .set({ state, error: error ?? null, ...(light ? { payload: light } : {}) })
            .where("id", "=", id),
        );
      },
    },
    /** Contacts' chats whose messages came outside their channel's hours (DECISIONS.md#d-136). */
    held: {
      /** Marks a chat as waiting; one already waiting keeps the time it began to. */
      mark(h: Omit<HeldChat, "since">): void {
        run(
          qb
            .insertInto("channel_held")
            .values({ ...h, since: now() })
            .onConflict((c) => c.column("thread_id").doUpdateSet({ conversation: h.conversation, sender: h.sender })),
        );
      },
      /** The chats waiting longest first. */
      list(limit = 100): HeldChat[] {
        return all(qb.selectFrom("channel_held").selectAll().orderBy("since").orderBy("thread_id").limit(limit));
      },
      get(threadId: string): HeldChat | undefined {
        return one(qb.selectFrom("channel_held").selectAll().where("thread_id", "=", threadId));
      },
      /** No longer waiting; false when it was not (someone else took it). */
      clear(threadId: string): boolean {
        return run(qb.deleteFrom("channel_held").where("thread_id", "=", threadId)) > 0;
      },
    },
    outbox: {
      add(o: {
        channel: string;
        conversation: string;
        thread_id?: string | undefined;
        /** The chat message this sends: it follows how far the send got. */
        message_id?: string | undefined;
        kind: OutboxItem["kind"];
        body: Presentation;
        at?: Date | undefined;
      }): OutboxRow {
        const id = newId("out");
        const ts = now();
        run(
          qb.insertInto("outbox").values({
            id,
            channel: o.channel,
            conversation: o.conversation,
            thread_id: o.thread_id ?? null,
            message_id: o.message_id ?? null,
            kind: o.kind,
            body: JSON.stringify(o.body),
            state: "queued",
            next_at: (o.at ?? new Date()).toISOString(),
            created_at: ts,
            updated_at: ts,
          }),
        );
        return toOut(outRow(id) as Selectable<OutboxTable>);
      },
      /** Something that already went out (or failed) without the queue, kept so the owner sees it with the rest. */
      settled(o: {
        channel: string;
        conversation: string;
        thread_id?: string | undefined;
        body: Presentation;
        error?: string | undefined;
      }): void {
        const ts = now();
        run(
          qb.insertInto("outbox").values({
            id: newId("out"),
            channel: o.channel,
            conversation: o.conversation,
            thread_id: o.thread_id ?? null,
            message_id: null,
            kind: "reply",
            body: JSON.stringify(o.body),
            state: o.error ? "failed" : "sent",
            error: o.error ?? null,
            next_at: ts,
            created_at: ts,
            updated_at: ts,
          }),
        );
      },
      get(id: string): OutboxRow | undefined {
        const r = outRow(id);
        return r ? toOut(r) : undefined;
      },
      /** Whether an owner's card (a confirmation or question) already went out, or waits to, on some channel. */
      hasInput(inputId: string): boolean {
        return Boolean(
          one(
            qb
              .selectFrom("outbox")
              .select("id")
              .where("kind", "=", "input")
              .where(sql<string>`json_extract(body, '$.input_id')`, "=", inputId),
          ),
        );
      },
      /** Queued items whose time came, oldest first. */
      due(limit = 20): OutboxRow[] {
        return all(
          qb
            .selectFrom("outbox")
            .selectAll()
            .where("state", "=", "queued")
            .where("next_at", "<=", now())
            .orderBy("next_at")
            .limit(limit),
        ).map(toOut);
      },
      /** The last thing sent or queued to a conversation, of any kind (an emoji put on a message is not one). */
      last(channel: string, conversation: string): OutboxRow | undefined {
        const r = one(
          qb
            .selectFrom("outbox")
            .selectAll()
            .where("channel", "=", channel)
            .where("conversation", "=", conversation)
            .where(sql`json_extract(body, '$.reaction')`, "is", null)
            .orderBy("created_at", "desc")
            .orderBy("id", "desc")
            .limit(1),
        );
        return r ? toOut(r) : undefined;
      },
      /** What went out to one conversation since `at` from chats other than `except`, newest first. */
      sentFromOthers(channel: string, conversation: string, except: string, at: string, limit: number): OutboxRow[] {
        return all(
          qb
            .selectFrom("outbox")
            .selectAll()
            .where("channel", "=", channel)
            .where("conversation", "=", conversation)
            .where("thread_id", "is not", null)
            .where("thread_id", "!=", except)
            .where("created_at", ">", at)
            .orderBy("created_at", "desc")
            .limit(limit),
        ).map(toOut);
      },
      /** The next time something queued is due, if anything is. */
      nextDue(): string | undefined {
        const r = one(
          qb
            .selectFrom("outbox")
            .select((eb) => eb.fn.min("next_at").as("at"))
            .where("state", "=", "queued"),
        );
        return r?.at ? String(r.at) : undefined;
      },
      /** Takes an item to send: only one sender wins it. */
      claim(id: string): boolean {
        return (
          run(
            qb
              .updateTable("outbox")
              .set((eb) => ({ state: "sending", attempts: eb("attempts", "+", 1), updated_at: now() }))
              .where("id", "=", id)
              .where("state", "=", "queued"),
          ) > 0
        );
      },
      sent(id: string, externalId: string | undefined): void {
        run(
          qb
            .updateTable("outbox")
            .set({ state: "sent", external_id: externalId ?? null, error: null, updated_at: now() })
            .where("id", "=", id),
        );
      },
      /** Back to the queue for later; `body` replaces what is left to send (a long text sent in part). */
      retry(id: string, at: Date, error: string, body?: Presentation): void {
        run(
          qb
            .updateTable("outbox")
            .set({
              state: "queued",
              next_at: at.toISOString(),
              error,
              ...(body ? { body: JSON.stringify(body) } : {}),
              updated_at: now(),
            })
            .where("id", "=", id),
        );
      },
      fail(id: string, state: "failed" | "uncertain", error: string): void {
        run(qb.updateTable("outbox").set({ state, error, updated_at: now() }).where("id", "=", id));
      },
      /** Boot: a send cut by a restart may or may not have reached the platform. */
      reconcile(): number {
        run(
          qb
            .updateTable("messages")
            .set({ delivery: "failed" })
            .where("delivery", "=", "pending")
            .where("id", "in", qb.selectFrom("outbox").select("message_id").where("state", "=", "sending")),
        );
        return run(
          qb
            .updateTable("outbox")
            .set({ state: "uncertain", error: "cut by a restart while sending", updated_at: now() })
            .where("state", "=", "sending"),
        );
      },
      /** What asked this confirmation or question on a channel, sent or still queued. */
      forInput(inputId: string): OutboxRow[] {
        return all(
          qb
            .selectFrom("outbox")
            .selectAll()
            .where("kind", "=", "input")
            .where(sql`json_extract(body, '$.input_id')`, "=", inputId),
        ).map(toOut);
      },
      /** What was sent as this platform message (a receipt names it). */
      byExternal(channel: string, externalId: string): OutboxRow | undefined {
        const r = one(
          qb.selectFrom("outbox").selectAll().where("channel", "=", channel).where("external_id", "=", externalId),
        );
        return r ? toOut(r) : undefined;
      },
      recent(limit: number): OutboxRow[] {
        return all(qb.selectFrom("outbox").selectAll().orderBy("created_at", "desc").limit(limit)).map(toOut);
      },
    },
    pairing: {
      /** The open request of this sender, or a new one with a fresh code. */
      request(r: { channel: string; external_id: string; conversation: string; name: string; text?: string }): {
        request: PairingRequest;
        fresh: boolean;
      } {
        const open = one(
          qb
            .selectFrom("pairing")
            .selectAll()
            .where("channel", "=", r.channel)
            .where("external_id", "=", r.external_id)
            .where("state", "=", "pending")
            .where("expires_at", ">", now()),
        );
        if (open) return { request: toPairing(open), fresh: false };
        let code = "";
        do code = String(randomInt(100_000, 1_000_000));
        while (one(qb.selectFrom("pairing").select("code").where("code", "=", code)));
        const at = new Date();
        run(
          qb.insertInto("pairing").values({
            code,
            channel: r.channel,
            external_id: r.external_id,
            conversation: r.conversation,
            name: r.name,
            text: r.text?.slice(0, 500) ?? null,
            state: "pending",
            created_at: at.toISOString(),
            expires_at: new Date(at.getTime() + PAIRING_TTL_MS).toISOString(),
          }),
        );
        return { request: toPairing(pairingRow(code) as Selectable<PairingTable>), fresh: true };
      },
      open(): Array<PairingRequest & { conversation: string }> {
        return all(
          qb
            .selectFrom("pairing")
            .selectAll()
            .where("state", "=", "pending")
            .where("expires_at", ">", now())
            .orderBy("created_at"),
        ).map((r) => ({ ...toPairing(r), conversation: r.conversation }));
      },
      get(code: string): (PairingRequest & { conversation: string }) | undefined {
        const r = one(
          qb
            .selectFrom("pairing")
            .selectAll()
            .where("code", "=", code)
            .where("state", "=", "pending")
            .where("expires_at", ">", now()),
        );
        return r ? { ...toPairing(r), conversation: r.conversation } : undefined;
      },
      /** What became of a code: still open, answered, past its time, or never given. */
      status(code: string): "pending" | "approved" | "denied" | "expired" | undefined {
        const r = one(qb.selectFrom("pairing").select(["state", "expires_at"]).where("code", "=", code));
        if (!r) return undefined;
        if (r.state === "pending" && r.expires_at <= now()) return "expired";
        return r.state as "pending" | "approved" | "denied";
      },
      close(code: string, state: "approved" | "denied"): void {
        run(qb.updateTable("pairing").set({ state }).where("code", "=", code));
      },
    },
  };
}

const toPairing = (r: Selectable<PairingTable>): PairingRequest => ({
  code: r.code,
  channel: r.channel,
  external_id: r.external_id,
  name: r.name,
  ...opt("text", r.text),
  created_at: r.created_at,
  expires_at: r.expires_at,
});
