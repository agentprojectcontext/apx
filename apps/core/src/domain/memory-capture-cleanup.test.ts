import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Memory } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { CAPTURE_CLEANUP_REASON, cleanUpCapturedNotes } from "./memory-capture-cleanup.ts";
import { createStore, type Store } from "./store.ts";

function tempStore() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-capture-cleanup-"));
  const db = openDb(home);
  return { home, db, store: createStore(db, createBus()) };
}

/** What v2.7.0's capture saved: the agent's private note, the owner's words as evidence. */
const captured = (store: Store, text: string, quote = text, kind: Memory["kind"] = "project") =>
  store.memories.add({
    scope: "agent",
    agent_id: "roby",
    text,
    source: "agent",
    author_agent: "roby",
    kind,
    evidence: [{ message_id: `msg_${Math.random().toString(36).slice(2)}`, quote }],
  });

function seedNotes(store: Store) {
  return {
    request: captured(store, "dale, revisá el deploy de Acme ahora"),
    question: captured(store, "genial, ¿podés cerrar esa review de Northwind?", undefined, "reference"),
    unsupported: captured(store, "Northwind deploys happen on Fridays.", "I never deploy Northwind on Fridays."),
    durable: captured(store, "Always use the JADE label for Acme reports.", undefined, "feedback"),
    remembered: store.memories.add({
      scope: "agent",
      agent_id: "roby",
      text: "dale, revisá el build de Acme",
      source: "agent",
      author_agent: "roby",
    }),
    owner: store.memories.add({ scope: "global", text: "dale, terminá esa tarea", source: "owner" }),
    edited: (() => {
      const note = captured(store, "dale, mirá el ticket de Acme ahora");
      return store.memories.edit(note.id, note.text, { tainted: false, pending: false }) as Memory;
    })(),
    procedure: captured(
      store,
      "Restart the Acme worker\n1. run the restart",
      "reiniciá el worker de Acme",
      "procedure",
    ),
  };
}

test("the capture cleanup retires noisy captured notes, keeps durable ones and touches nothing else", () => {
  const { home, db, store } = tempStore();
  try {
    const notes = seedNotes(store);
    const result = cleanUpCapturedNotes(store);
    assert.deepEqual(result, { retired: 3, kept: 1 });
    for (const note of [notes.request, notes.question, notes.unsupported]) {
      const now = store.memories.get(note.id);
      assert.ok(now?.forgotten_at, `${note.text} is retired`);
      assert.equal(store.memories.history(note.id)[0]?.reason, CAPTURE_CLEANUP_REASON);
    }
    for (const note of [notes.durable, notes.remembered, notes.owner, notes.edited, notes.procedure]) {
      const now = store.memories.get(note.id);
      assert.equal(now?.forgotten_at, undefined, `${note.text} stays`);
      assert.equal(now?.revision, note.revision, `${note.text} is untouched`);
    }
    // Retiring leaves no exclusion: the owner can teach the same thing again.
    assert.equal(store.memories.excluded({ agent_id: "roby" }, notes.request.text), false);

    // Restorable from the forgotten list, with its history intact.
    const restored = store.memories.restore(notes.request.id);
    assert.equal(restored?.forgotten_at, undefined);
    assert.deepEqual(
      store.memories.history(notes.request.id).map((v) => v.reason),
      ["restored", CAPTURE_CLEANUP_REASON, "created"],
    );
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the capture cleanup runs once: notes captured after it are never revisited", () => {
  const { home, db, store } = tempStore();
  try {
    assert.deepEqual(cleanUpCapturedNotes(store), { retired: 0, kept: 0 });
    const later = captured(store, "dale, revisá el deploy de Acme ahora");
    assert.equal(cleanUpCapturedNotes(store), undefined);
    assert.equal(store.memories.get(later.id)?.forgotten_at, undefined);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a core starting on a v2.7.0 store retires its noisy captures once, restorable over the protocol", async () => {
  const { home, db, store } = tempStore();
  const notes = seedNotes(store);
  db.close();
  const llm = scriptedLlm(() => say("ok"));
  let env = await startCore({ llm, home });
  try {
    const forgotten = (await env.client.call("memory.list", { forgotten: true })).memories.map((m) => m.id);
    assert.deepEqual(forgotten.sort(), [notes.request.id, notes.question.id, notes.unsupported.id].sort());
    await env.client.call("memory.restore", { id: notes.question.id });
    await env.core.close();

    env = await startCore({ llm, home });
    const live = (await env.client.call("memory.list", {})).memories.map((m) => m.id);
    assert.ok(live.includes(notes.question.id), "a second start does not retire a restored note again");
    assert.ok(live.includes(notes.durable.id));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
