// Sending through the outbox: one worker drains due items in order; a send that surely did not go out is retried with
// backoff (from the part where it stopped, for long replies); one that may have gone out is marked uncertain and
// never repeated.
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
      if (!deps.configured(o.channel)) store.channels.outbox.fail(o.id, "failed", "channel removed");
      else store.channels.outbox.retry(o.id, new Date(Date.now() + NOT_RUNNING_RETRY_MS), "channel is not running");
      return;
    }
    if (!store.channels.outbox.claim(o.id)) return;
    try {
      const r = await target.adapter.send(o.conversation, o.body);
      store.channels.outbox.sent(o.id, r.external_id);
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
    log.warn({ channel: o.channel, outbox: o.id, err: msg, state }, "channel send did not go through");
  }

  return {
    enqueue(o: Parameters<Store["channels"]["outbox"]["add"]>[0]): void {
      store.channels.outbox.add(o);
      kick();
    },
    kick,
    stop(): void {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export type Delivery = ReturnType<typeof createDelivery>;
