// Sending through the outbox: one worker drains due items in order; a send that surely did not go out is retried with
// backoff (from the part where it stopped, for long replies); one that may have gone out is marked uncertain and
// never repeated.
import { withoutAppLinks } from "@apx/protocol";
import type { OutboxRow, Presentation } from "../domain/channels.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { type ChannelAdapter, SendError } from "./types.ts";

const MAX_ATTEMPTS = 6;
const NOT_RUNNING_RETRY_MS = 30_000;

export type Target = { adapter: ChannelAdapter; running: boolean } | undefined;

export function createDelivery(deps: {
  store: Store;
  log: Log;
  /** The live adapter of a channel, if it is configured and started. */
  target(channel: string): Target;
  /** Whether a channel is still configured (an item for a removed one fails). */
  configured(channel: string): boolean;
  /** A media file's bytes, by id. */
  media(id: string): { mime: string; data: Buffer } | undefined;
  /** An item that surely did not go out and will not be tried again on its channel. */
  failed?(o: OutboxRow): void;
}) {
  const { store, log } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining = false;
  let again = false;
  let stopped = false;

  function kick(delay = 0): void {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void drain(), delay);
    timer.unref?.();
  }

  async function drain(): Promise<void> {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        for (const o of store.channels.outbox.due()) await sendOne(o);
      } while (again && !stopped);
    } finally {
      draining = false;
    }
    const next = store.channels.outbox.nextDue();
    if (next) kick(Math.max(50, Date.parse(next) - Date.now()));
  }

  async function sendOne(o: OutboxRow): Promise<void> {
    const target = deps.target(o.channel);
    if (!target?.running) {
      if (!deps.configured(o.channel)) {
        store.channels.outbox.fail(o.id, "failed", "channel removed");
        if (o.message_id) store.messages.setDelivery(o.message_id, "failed");
        deps.failed?.(o);
      } else store.channels.outbox.retry(o.id, new Date(Date.now() + NOT_RUNNING_RETRY_MS), "channel is not running");
      return;
    }
    if (!store.channels.outbox.claim(o.id)) return;
    // Answered elsewhere while it waited to go out: its buttons would ask nothing.
    const input = o.kind === "input" && o.body.input_id ? store.inputs.get(o.body.input_id) : undefined;
    if (input && input.state !== "pending") {
      store.channels.outbox.fail(o.id, "failed", `not sent: already ${input.state}`);
      return;
    }
    try {
      const files = (o.body.media ?? []).flatMap((m) => {
        const f = deps.media(m.id);
        return f ? [{ kind: m.kind, mime: f.mime, data: f.data, ...(m.name ? { name: m.name } : {}) }] : [];
      });
      const r = await target.adapter.send(o.conversation, o.body, files);
      store.channels.outbox.sent(o.id, r.external_id);
      if (o.message_id) store.messages.setDelivery(o.message_id, "sent");
    } catch (err) {
      settleFailure(o, err);
    }
  }

  function settleFailure(o: OutboxRow, err: unknown): void {
    const msg = errorMessage(err, 300);
    if (err instanceof SendError && err.kind === "retry" && o.attempts + 1 < MAX_ATTEMPTS) {
      const wait = err.retryAfterMs ?? 2000 * 2 ** o.attempts;
      // Parts already delivered are skipped next time.
      const body: Presentation | undefined = err.sentParts
        ? { ...o.body, skip: (o.body.skip ?? 0) + err.sentParts }
        : undefined;
      store.channels.outbox.retry(o.id, new Date(Date.now() + wait), msg, body);
      return;
    }
    // An error we cannot classify may have happened after the platform took the message.
    const state = err instanceof SendError && err.kind === "fatal" ? "failed" : "uncertain";
    store.channels.outbox.fail(o.id, state, msg);
    if (o.message_id) store.messages.setDelivery(o.message_id, "failed");
    log.warn({ channel: o.channel, outbox: o.id, err: msg, state }, "channel send did not go through");
    if (state === "failed") deps.failed?.({ ...o, error: msg });
  }

  return {
    /** Queues a send; returns its outbox id, to follow how it went. */
    enqueue(o: Parameters<Store["channels"]["outbox"]["add"]>[0]): string {
      // A link into the app means nothing on a channel: its label goes.
      const row = store.channels.outbox.add({ ...o, body: { ...o.body, text: withoutAppLinks(o.body.text) } });
      if (o.message_id) store.messages.sentOn(o.message_id, o.channel);
      kick();
      return row.id;
    },
    /** The platform says a sent message reached their device or was seen. */
    receipt(channel: string, externalId: string, state: "delivered" | "read"): void {
      const o = store.channels.outbox.byExternal(channel, externalId);
      if (o?.message_id) store.messages.setDelivery(o.message_id, state);
    },
    kick,
    stop(): void {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export type Delivery = ReturnType<typeof createDelivery>;
