// What channels receive and send, durably. Inbound rows are written before the platform hears "got it"; outbound rows
// before anything is sent, so a crash leaves an honest state (a send that may have gone out is "uncertain", never
// silently repeated).

import { randomInt } from "node:crypto";
import type { OutboxItem, PairingRequest } from "@apx/protocol";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

/** What an adapter hands over for one platform message. */
export type Inbound = {
  /** The platform's id for this message (dedupes a redelivery). */
  external_id: string;
  /** Where to answer (a chat id). */
  conversation: string;
  sender: { id: string; name: string };
  text: string;
  /** Only one-to-one conversations reach the agent; groups are ignored. */
  private: boolean;
};

/** A button press: the platform's id for it, the conversation, who pressed and the button's data. */
export type InboundAction = { conversation: string; sender: { id: string; name: string }; data: string };

/** What goes out: text, and buttons when the owner is asked something. */
export type Presentation = {
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  /** Delivered without sound (quiet hours). */
  silent?: boolean;
};

export type InboxRow = { id: string; channel: string; payload: Inbound; state: string };
export type OutboxRow = OutboxItem & { body: Presentation; next_at: string; external_id?: string };

const toOut = (r: Row): OutboxRow => {
  const body = JSON.parse(String(r.body)) as Presentation;
  return {
    id: String(r.id),
    channel: String(r.channel),
    conversation: String(r.conversation),
    ...opt("thread_id", r.thread_id),
    kind: r.kind as OutboxItem["kind"],
    text: body.text,
    body,
    state: r.state as OutboxItem["state"],
    attempts: Number(r.attempts),
    ...opt("error", r.error),
    ...opt("external_id", r.external_id),
    next_at: String(r.next_at),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
};

export const publicOutbox = ({ body: _b, next_at: _n, external_id: _e, ...o }: OutboxRow): OutboxItem => o;

const PAIRING_TTL_MS = 24 * 3600_000;

export function channelsRepo({ one, all, run }: Sql) {
  return {
    inbox: {
      /** Stores a message; false when this platform message was already stored (a redelivery). */
      add(channel: string, m: Inbound): string | undefined {
        const id = newId("in");
        const r = run(
          "INSERT OR IGNORE INTO channel_inbox (id, channel, external_id, conversation, sender, payload, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'received', ?)",
          id,
          channel,
          m.external_id,
          m.conversation,
          m.sender.id,
          JSON.stringify(m),
          now(),
        );
        return Number(r.changes) > 0 ? id : undefined;
      },
      pending(): InboxRow[] {
        return all("SELECT * FROM channel_inbox WHERE state = 'received' ORDER BY created_at").map((r) => ({
          id: String(r.id),
          channel: String(r.channel),
          payload: JSON.parse(String(r.payload)) as Inbound,
          state: String(r.state),
        }));
      },
      done(id: string, state: "done" | "ignored" | "failed", error?: string): void {
        run("UPDATE channel_inbox SET state = ?, error = ? WHERE id = ?", state, error ?? null, id);
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
          "INSERT INTO outbox (id, channel, conversation, thread_id, kind, body, state, next_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)",
          id,
          o.channel,
          o.conversation,
          o.thread_id ?? null,
          o.kind,
          JSON.stringify(o.body),
          (o.at ?? new Date()).toISOString(),
          ts,
          ts,
        );
        return toOut(one("SELECT * FROM outbox WHERE id = ?", id) as Row);
      },
      get(id: string): OutboxRow | undefined {
        const r = one("SELECT * FROM outbox WHERE id = ?", id);
        return r ? toOut(r) : undefined;
      },
      /** Queued items whose time came, oldest first. */
      due(limit = 20): OutboxRow[] {
        return all(
          "SELECT * FROM outbox WHERE state = 'queued' AND next_at <= ? ORDER BY next_at LIMIT ?",
          now(),
          limit,
        ).map(toOut);
      },
      /** The next time something queued is due, if anything is. */
      nextDue(): string | undefined {
        const r = one("SELECT MIN(next_at) AS at FROM outbox WHERE state = 'queued'");
        return r?.at ? String(r.at) : undefined;
      },
      /** Takes an item to send: only one sender wins it. */
      claim(id: string): boolean {
        return (
          Number(
            run(
              "UPDATE outbox SET state = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'queued'",
              now(),
              id,
            ).changes,
          ) > 0
        );
      },
      sent(id: string, externalId: string | undefined): void {
        run(
          "UPDATE outbox SET state = 'sent', external_id = ?, error = NULL, updated_at = ? WHERE id = ?",
          externalId ?? null,
          now(),
          id,
        );
      },
      retry(id: string, at: Date, error: string): void {
        run(
          "UPDATE outbox SET state = 'queued', next_at = ?, error = ?, updated_at = ? WHERE id = ?",
          at.toISOString(),
          error,
          now(),
          id,
        );
      },
      fail(id: string, state: "failed" | "uncertain", error: string): void {
        run("UPDATE outbox SET state = ?, error = ?, updated_at = ? WHERE id = ?", state, error, now(), id);
      },
      /** Boot: a send cut by a restart may or may not have reached the platform. */
      reconcile(): number {
        return Number(
          run(
            "UPDATE outbox SET state = 'uncertain', error = 'cut by a restart while sending', updated_at = ? WHERE state = 'sending'",
            now(),
          ).changes,
        );
      },
      recent(limit: number): OutboxRow[] {
        return all("SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?", limit).map(toOut);
      },
    },
    pairing: {
      /** The open request of this sender, or a new one with a fresh code. */
      request(r: { channel: string; external_id: string; conversation: string; name: string; text?: string }): {
        request: PairingRequest;
        fresh: boolean;
      } {
        const open = one(
          "SELECT * FROM pairing WHERE channel = ? AND external_id = ? AND state = 'pending' AND expires_at > ?",
          r.channel,
          r.external_id,
          now(),
        );
        if (open) return { request: toPairing(open), fresh: false };
        let code = "";
        do code = String(randomInt(100_000, 1_000_000));
        while (one("SELECT code FROM pairing WHERE code = ?", code));
        const at = new Date();
        run(
          "INSERT INTO pairing (code, channel, external_id, conversation, name, text, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
          code,
          r.channel,
          r.external_id,
          r.conversation,
          r.name,
          r.text?.slice(0, 500) ?? null,
          at.toISOString(),
          new Date(at.getTime() + PAIRING_TTL_MS).toISOString(),
        );
        return { request: toPairing(one("SELECT * FROM pairing WHERE code = ?", code) as Row), fresh: true };
      },
      open(): Array<PairingRequest & { conversation: string }> {
        return all("SELECT * FROM pairing WHERE state = 'pending' AND expires_at > ? ORDER BY created_at", now()).map(
          (r) => ({ ...toPairing(r), conversation: String(r.conversation) }),
        );
      },
      get(code: string): (PairingRequest & { conversation: string }) | undefined {
        const r = one("SELECT * FROM pairing WHERE code = ? AND state = 'pending' AND expires_at > ?", code, now());
        return r ? { ...toPairing(r), conversation: String(r.conversation) } : undefined;
      },
      close(code: string, state: "approved" | "denied"): void {
        run("UPDATE pairing SET state = ? WHERE code = ?", state, code);
      },
    },
  };
}

const toPairing = (r: Row): PairingRequest => ({
  code: String(r.code),
  channel: String(r.channel),
  external_id: String(r.external_id),
  name: String(r.name),
  ...opt("text", r.text),
  created_at: String(r.created_at),
  expires_at: String(r.expires_at),
});
