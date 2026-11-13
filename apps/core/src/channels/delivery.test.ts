import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore, type Store } from "../domain/store.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { createDelivery } from "./delivery.ts";
import { type ChannelAdapter, SendError } from "./types.ts";

const quiet = { info() {}, warn() {}, error() {} };

/** A store of its own and an outbox worker whose channel answers each send with the next of `outcomes`. */
async function withDelivery(
  outcomes: Array<"ok" | SendError>,
  fn: (o: { store: Store; delivery: ReturnType<typeof createDelivery>; ids: string[] }) => Promise<void>,
): Promise<void> {
  const home = tempDir("apx-delivery-");
  const db = openDb(home.path);
  const ids: string[] = [];
  const adapter = {
    caps: { typing: false, buttons: false },
    start: async () => ({ account: "+1" }),
    stop: async () => {},
    send: async () => {
      const next = outcomes.shift() ?? "ok";
      if (next !== "ok") throw next;
      const id = `EXT-${ids.length + 1}`;
      ids.push(id);
      return { external_id: id };
    },
  } as unknown as ChannelAdapter;
  const store = createStore(db, createBus());
  const delivery = createDelivery({
    store,
    log: quiet,
    target: () => ({ adapter, running: true }),
    configured: () => true,
    media: () => undefined,
  });
  try {
    await fn({ store, delivery, ids });
  } finally {
    delivery.stop();
    db.close();
    home.remove();
  }
}

/** One answer of the agent that went out in two sends: its first words, then the rest once it finished. */
function answer(store: Store) {
  const thread = store.threads.create({ kind: "loose", title: "Home", agent_ids: ["superagent"] });
  return store.messages.add({
    thread_id: thread.id,
    author: { kind: "agent", id: "superagent" },
    parts: [{ type: "text", text: "Looking into it." }],
  });
}

const send = (delivery: ReturnType<typeof createDelivery>, message: string, text: string) =>
  delivery.enqueue({ channel: "whatsapp", conversation: "me", message_id: message, kind: "reply", body: { text } });

test("a later send that may not have arrived shows on the message, and the first send's receipt does not cover it", async () => {
  await withDelivery(["ok", new SendError("uncertain", "socket hung up")], async ({ store, delivery, ids }) => {
    const m = answer(store);
    send(delivery, m.id, "Looking into it.");
    await waitFor(() => store.messages.get(m.id)?.delivery === "sent", "the first words taken");
    const second = send(delivery, m.id, "It is under review.");
    await waitFor(() => store.channels.outbox.get(second)?.state === "uncertain", "the second send cut");
    assert.equal(store.messages.get(m.id)?.delivery, "failed");

    // The owner reads the first words on the phone: the message still says its last words may not have arrived.
    delivery.receipt("whatsapp", ids[0] ?? "", "read");
    assert.equal(store.messages.get(m.id)?.delivery, "failed");
  });
});

test("a send waiting to go again shows as waiting, and goes up as that send arrives", async () => {
  await withDelivery(["ok", new SendError("retry", "Connection Closed", 10)], async ({ store, delivery, ids }) => {
    const m = answer(store);
    send(delivery, m.id, "Looking into it.");
    await waitFor(() => store.messages.get(m.id)?.delivery === "sent", "the first words taken");
    send(delivery, m.id, "It is under review.");
    await waitFor(() => ids.length === 2, "the second send, after its retry");
    await waitFor(() => store.messages.get(m.id)?.delivery === "sent", "the last send taken");
    delivery.receipt("whatsapp", ids[0] ?? "", "read");
    assert.equal(store.messages.get(m.id)?.delivery, "sent", "the first send's receipt is not the last one's");
    delivery.receipt("whatsapp", ids[1] ?? "", "read");
    assert.equal(store.messages.get(m.id)?.delivery, "read");
  });
});
