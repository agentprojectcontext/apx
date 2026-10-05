// What channels receive and send, durably. Inbound rows are written before the platform hears "got it"; outbound rows
// before anything is sent, so a crash leaves an honest state (a send that may have gone out is "uncertain", never
// silently repeated).

import { randomInt } from "node:crypto";
import type { OutboxItem, PairingRequest } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { OutboxTable, PairingTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

/** What an adapter hands over for one platform message. */
export type Inbound = {
  /** The platform's id for this message (dedupes a redelivery). */
  external_id: string;
  /** Where to answer (a chat id). */
  conversation: string;
  sender: { id: string; name: string };
  text: string;
  /** A one-to-one conversation; anything else reaches the agent only as a listed room (see `room`). */
  private: boolean;
  /** A message in a server's room the owner listed: whether it called the bot (an @mention or a reply to it). */
  room?: { called: boolean } | undefined;
  /** A voice note or audio, to be transcribed before an agent reads it. */
  voice?: { mime: string; data: string } | undefined;
};

/** A button press: the platform's id for it, the conversation, who pressed and the button's data. */
export type InboundAction = { conversation: string; sender: { id: string; name: string }; data: string };

/** What goes out: text, and buttons when the owner is asked something. */
export type Presentation = {
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  /** A channel without buttons leaves them out instead of numbering them (a 👍/👎 nobody needs to answer). */
  optionalButtons?: boolean;
  /** Delivered without sound (quiet hours). */
  silent?: boolean;
  /** Parts already delivered by an earlier attempt (text chunks first, then media). */
  skip?: number;
  /** Images and voice notes APX made, sent after the text. */
  media?: Array<{ id: string; kind: "image" | "audio"; mime: string }>;
  /** A voice note and what it says: the audio first, the text as its caption where the channel allows one. */
  mediaFirst?: boolean;
  /** In a room: the message this answers (shown as a reply to it). */
  reply_to?: string;
};

export type InboxRow = { id: string; channel: string; payload: Inbound; state: string };
export type OutboxRow = OutboxItem & { body: Presentation; next_at: string; external_id?: string };

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
    next_at: r.next_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
};

export const publicOutbox = ({ body: _b, next_at: _n, external_id: _e, ...o }: OutboxRow): OutboxItem => o;

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
      done(id: string, state: "done" | "ignored" | "failed", error?: string): void {
        run(
          qb
            .updateTable("channel_inbox")
            .set({ state, error: error ?? null })
            .where("id", "=", id),
        );
      },
    },
    outbox: {
      add(o: {
        channel: string;
        conversation: string;
        thread_id?: string | undefined;
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
      get(id: string): OutboxRow | undefined {
        const r = outRow(id);
        return r ? toOut(r) : undefined;
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
        return run(
          qb
            .updateTable("outbox")
            .set({ state: "uncertain", error: "cut by a restart while sending", updated_at: now() })
            .where("state", "=", "sending"),
        );
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
