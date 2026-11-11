import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore, type Store } from "../domain/store.ts";
import { manualTimers, tempDir, waitFor } from "../testkit/platform.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { joinSplitContacts } from "./same-person.ts";
import type { AdapterIO, ChannelAdapter } from "./types.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const PHONE = "5491100000007@s.whatsapp.net";
const LID = "200000000000007@lid";
const line = { sameAs: async () => [{ from: LID, to: PHONE }] } as unknown as ChannelAdapter;
const text = (t: string): Part[] => [{ type: "text", text: t }];

/** A store of its own, with one person split in two (number and private id) and a chat under each address. */
async function split(fn: (s: Awaited<ReturnType<typeof setup>>) => Promise<void> | void): Promise<void> {
  const home = tempDir("apx-join-");
  const db = openDb(home.path);
  try {
    await fn(setup(createStore(db, createBus()), db));
  } finally {
    db.close();
    home.remove();
  }
}

function setup(store: Store, db: ReturnType<typeof openDb>) {
  const known = store.persons.create({ name: "Dana", role: "contact" });
  store.persons.link(known.id, { channel: "whatsapp", external_id: PHONE });
  const stranger = store.persons.create({ name: "Dana", role: "contact" });
  store.persons.link(stranger.id, { channel: "whatsapp", external_id: LID });
  const chat = (conversation: string, person_id: string) =>
    store.threads.create({
      kind: "channel",
      title: "Dana",
      agent_ids: ["superagent"],
      channel: { id: "whatsapp", conversation, person_id },
    });
  const byNumber = chat(PHONE, known.id);
  const byId = chat(LID, stranger.id);
  /** A finished turn in a chat at `at`, with what the model saw of it. */
  const turn = (thread_id: string, at: string, said: string, answer: string) => {
    const r = store.runs.create({
      thread_id,
      agent_id: "superagent",
      trigger: "channel",
      input: { origin: { kind: "user" }, text: said },
      deadline_at: "2099-01-01T00:00:00.000Z",
    });
    store.runs.setState(r, "completed");
    db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(at, r.id);
    const m = store.messages.add({
      thread_id,
      author: { kind: "person", id: stranger.id, name: "Dana", channel: "whatsapp" },
      parts: text(said),
      at,
    });
    store.modelLog.append(thread_id, r.id, [
      { role: "user", content: said },
      { role: "assistant", content: answer },
    ]);
    return { run: r, message: m };
  };
  return { store, db, known, stranger, byNumber, byId, turn };
}

const said = (store: Store, threadId: string) =>
  store.modelLog.list(threadId).map((e) => [e.seq, (e.item as { content: string }).content]);

test("what the model saw in the joined chat goes into the kept chat in the order it was said", () =>
  split(async ({ store, db, byNumber, byId, turn }) => {
    turn(byNumber.id, "2026-01-01T10:00:00.000Z", "Hi", "Hello Dana");
    const late = turn(byId.id, "2026-01-02T10:00:00.000Z", "Can we meet Friday?", "Friday works");
    turn(byNumber.id, "2026-01-03T10:00:00.000Z", "See you", "See you then");
    store.memoryWork.enqueue({
      id: "mw_1",
      kind: "capture",
      agent_id: "superagent",
      thread_id: byId.id,
      run_id: late.run.id,
    });
    store.memoryWork.episode({
      run_id: late.run.id,
      thread_id: byId.id,
      agent_id: "superagent",
      project_id: null,
      message_id: late.message.id,
      text: "Dana wants to meet Friday",
      created_at: "2026-01-02T10:00:00.000Z",
    });

    assert.equal(await joinSplitContacts(store, "whatsapp", line), 1);

    assert.equal(store.threads.get(byId.id), undefined, "one chat");
    assert.deepEqual(said(store, byNumber.id), [
      [1, "Hi"],
      [2, "Hello Dana"],
      [3, "Can we meet Friday?"],
      [4, "Friday works"],
      [5, "See you"],
      [6, "See you then"],
    ]);
    assert.deepEqual(store.modelLog.forRun(late.run.id), [
      { role: "user", content: "Can we meet Friday?" },
      { role: "assistant", content: "Friday works" },
    ]);
    // The next entry goes after the joined history.
    assert.equal(store.modelLog.append(byNumber.id, undefined, [{ role: "user", content: "next" }]), 7);
    assert.equal(store.memoryWork.get("mw_1")?.thread_id, byNumber.id, "memory work still to do follows the chat");
    assert.equal(
      db.prepare("SELECT thread_id FROM memory_episodes WHERE run_id = ?").get(late.run.id)?.thread_id,
      byNumber.id,
      "what the agent remembers of it stays",
    );
  }));

test("a draft, a message held for the hours and a flow's link in the joined chat stay with the kept chat", () =>
  split(async ({ store, db, known, stranger, byNumber, byId }) => {
    const draft = store.suggestions.add({
      person_id: stranger.id,
      thread_id: byId.id,
      channel: "whatsapp",
      agent_id: "superagent",
      said: ["Are you there?"],
      text: "Yes, tell me",
    });
    store.channels.held.mark({
      thread_id: byId.id,
      channel: "whatsapp",
      conversation: LID,
      sender: LID,
      person_id: stranger.id,
    });
    db.prepare("INSERT INTO projects (id, name, created_at) VALUES ('p_acme', 'Acme', '2026-01-01')").run();
    db.prepare(
      "INSERT INTO flows (id, project_id, enabled, predicates, table_key) VALUES ('f_1', 'p_acme', 1, '[]', 'k')",
    ).run();
    db.prepare(
      "INSERT INTO flow_events (flow_id, event_id, state, created_at, thread_id) VALUES ('f_1', 'e_1', 'done', '2026-01-01', ?)",
    ).run(byId.id);

    assert.equal(await joinSplitContacts(store, "whatsapp", line), 1);

    assert.equal(store.threads.get(byId.id), undefined, "one chat");
    assert.deepEqual(
      store.suggestions.pendingIn(byNumber.id).map((s) => [s.id, s.person_id]),
      [[draft.id, known.id]],
      "the draft still waits for the owner",
    );
    const held = store.channels.held.get(byNumber.id);
    assert.equal(held?.person_id, known.id, "their message still waits for the hours");
    assert.equal(held?.conversation, PHONE, "and is answered under their number");
    assert.equal(held?.sender, PHONE);
    assert.equal(db.prepare("SELECT thread_id FROM flow_events WHERE event_id = 'e_1'").get()?.thread_id, byNumber.id);
  }));

test("a message held in both chats waits once, since the earlier of the two", () =>
  split(async ({ store, db, known, stranger, byNumber, byId }) => {
    const hold = (thread_id: string, conversation: string, person_id: string, since: string) => {
      store.channels.held.mark({ thread_id, channel: "whatsapp", conversation, sender: conversation, person_id });
      db.prepare("UPDATE channel_held SET since = ? WHERE thread_id = ?").run(since, thread_id);
    };
    hold(byNumber.id, PHONE, known.id, "2026-01-02T08:00:00.000Z");
    hold(byId.id, LID, stranger.id, "2026-01-01T23:00:00.000Z");

    assert.equal(await joinSplitContacts(store, "whatsapp", line), 1);

    assert.deepEqual(
      store.channels.held.list().map((h) => [h.thread_id, h.conversation, h.since]),
      [[byNumber.id, PHONE, "2026-01-01T23:00:00.000Z"]],
    );
  }));

test("when the owner decided about both contacts, the joined one keeps the stricter of each decision", () =>
  split(async ({ store, known, stranger }) => {
    store.persons.update(known.id, { perms: { appointments: true, requests: true, notes: false, any_hour: true } });
    store.persons.update(stranger.id, { muted: true, perms: { appointments: true, requests: false, notes: true } });

    assert.equal(await joinSplitContacts(store, "whatsapp", line), 1);

    const dana = store.persons.get(known.id);
    assert.equal(dana?.muted, true, "silenced under either address, silenced");
    assert.equal(dana?.supervised, false);
    // Answered at any hour was set only for one: it follows the account, as it did for the other.
    assert.deepEqual(dana?.perms, { appointments: true, requests: false, notes: false }, "only what both may do");
    assert.equal(dana?.unreviewed, false);
  }));

test("a joined contact blocked or supervised under one address stays so", () =>
  split(async ({ store, known, stranger }) => {
    store.persons.update(known.id, { supervised: true });
    store.persons.update(stranger.id, { role: "blocked" });

    assert.equal(await joinSplitContacts(store, "whatsapp", line), 1);

    const dana = store.persons.get(known.id);
    assert.equal(dana?.role, "blocked");
    assert.equal(dana?.supervised, true, "not answered on their own");
    assert.equal(dana?.muted, false);
  }));

test("a stranger's defaults never loosen the contact the owner reviewed", () =>
  split(async ({ store, known }) => {
    const other = store.persons.create({ name: "Dana", role: "contact", unreviewed: true });
    store.persons.update(known.id, { perms: { notes: true } });
    const lid = "200000000000008@lid";
    store.persons.link(other.id, { channel: "whatsapp", external_id: lid });
    const pair = { sameAs: async () => [{ from: lid, to: PHONE }] } as unknown as ChannelAdapter;

    assert.equal(await joinSplitContacts(store, "whatsapp", pair), 1);

    const dana = store.persons.get(known.id);
    assert.equal(dana?.muted, false, "a stranger is kept silenced only until the owner decides, and they had");
    assert.equal(dana?.unreviewed, false);
    assert.equal(dana?.perms.notes, true);
  }));

test("contacts already joined are not joined again on the next connect, and one left with a chat still is", () =>
  split(async ({ store, known, byNumber, byId }) => {
    assert.equal(await joinSplitContacts(store, "whatsapp", line), 1);
    let tries = 0;
    const counted = {
      ...store,
      threads: {
        ...store.threads,
        joinChats: (...a: Parameters<Store["threads"]["joinChats"]>) => {
          tries++;
          return store.threads.joinChats(...a);
        },
      },
    };
    assert.equal(await joinSplitContacts(counted, "whatsapp", line), 0);
    assert.equal(tries, 0, "nothing left to join under the private id");

    // A chat a turn kept under the private id last time is joined now.
    const left = store.threads.create({
      kind: "channel",
      title: "Dana",
      agent_ids: ["superagent"],
      channel: { id: "whatsapp", conversation: LID, person_id: known.id },
    });
    assert.equal(await joinSplitContacts(counted, "whatsapp", line), 1);
    assert.equal(store.threads.get(left.id), undefined);
    assert.ok(store.threads.get(byNumber.id));
    assert.equal(store.threads.get(byId.id), undefined);
  }));

test("a line whose id store stops answering gives up on the lookup instead of waiting forever", async () => {
  const fake = fakeWhatsApp();
  const home = tempDir("apx-wa-lookup-");
  const timers = manualTimers();
  const adapter = whatsappAdapter({ dir: home.path, lib: async () => fake.lib, timers });
  try {
    let up = false;
    const io: AdapterIO = {
      receive: () => {},
      action: () => {},
      status: () => {},
      qr: (code) => code && fake.scan(),
      identified: () => {
        up = true;
      },
      signal: new AbortController().signal,
    };
    await adapter.start(io);
    await waitFor(() => up, "linked");
    fake.knows({ phone: PHONE, name: "Dana", lid: LID });
    fake.stallLookups();
    let pairs: Array<{ from: string; to: string }> | undefined;
    void adapter.sameAs?.([LID]).then((p) => {
      pairs = p;
    });
    await waitFor(() => timers.pending() > 0, "a lookup with its deadline");
    assert.equal(pairs, undefined, "still asking");
    timers.tick(60_000);
    await waitFor(() => pairs !== undefined, "the lookup given up");
    assert.deepEqual(pairs, [], "nothing known is joined");
  } finally {
    await adapter.stop();
    home.remove();
  }
});
