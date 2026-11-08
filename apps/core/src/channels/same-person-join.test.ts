import assert from "node:assert/strict";
import { test } from "node:test";
import type { Part } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore, type Store } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { joinSplitContacts } from "./same-person.ts";
import type { ChannelAdapter } from "./types.ts";

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
