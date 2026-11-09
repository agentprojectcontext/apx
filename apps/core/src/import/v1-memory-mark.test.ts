import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import { recallFor } from "../engine/recall.ts";
import { tempDir } from "../testkit/platform.ts";
import { markV1Notes } from "./v1-memory-mark.ts";

test("notes the v1 import saved as the owner's are marked as brought over, once, and leave the standing notes", async () => {
  await using home = tempDir("apx-v1-mark-");
  await using v1 = tempDir("apx-v1-home-");
  fs.writeFileSync(
    path.join(v1.path, "memory.md"),
    "# Notes\n- Northwind ships on Fridays.\n- Acme's logo is green.\n",
  );
  const db = openDb(home.path);
  try {
    const store = createStore(db, createBus());
    const imported = store.memories.add({ scope: "global", text: "Northwind ships on Fridays.", source: "owner" });
    const own = store.memories.add({ scope: "global", text: "I answer mail after lunch.", source: "owner" });
    const tagged = store.memories.add({ scope: "global", text: "[v1 · Acme] Deploys go through CI.", source: "owner" });
    // The same words written in a v2 chat came from v2: they stay as they are.
    const inChat = store.memories.add({
      scope: "global",
      text: "Acme's logo is green.",
      source: "owner",
      thread_id: "thr_x",
    });

    assert.deepEqual(markV1Notes(store, v1.path), { marked: 2 });
    assert.equal(store.memories.get(tagged.id)?.source, "imported", "an earlier setup's tagged note too");
    assert.equal(store.memories.get(imported.id)?.source, "imported");
    assert.equal(store.memories.get(own.id)?.source, "owner");
    assert.equal(store.memories.get(inChat.id)?.source, "owner");
    assert.equal(markV1Notes(store, v1.path), undefined, "runs once per install");

    const byWords = async (o: { query: string; limit: number }) => store.memories.list(o);
    const first = await recallFor(store, byWords, "superagent", {}, "", {}, 0);
    assert.match(first.text ?? "", /mail after lunch/);
    assert.doesNotMatch(first.text ?? "", /Fridays/, "a v1 note does not stand in every chat");
    const asked = await recallFor(store, byWords, "superagent", {}, "when does Northwind ship", {}, 0);
    assert.match(asked.text ?? "", /Fridays/, "it is still found when it comes up");
    assert.match(asked.text ?? "", /from APX v1, may be outdated/);

    const vouched = store.memories.confirm(imported.id);
    assert.equal(vouched?.source, "owner", "the owner's OK makes it theirs");
  } finally {
    db.close();
  }
});
