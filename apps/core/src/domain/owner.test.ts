import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { adoptAccountName, ownerIdentity, saveOwnerIdentity } from "./owner.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

test("the account's name names an owner who has none, and never replaces one they typed", async () => {
  const dir = tempDir("apx-owner-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store);
  try {
    assert.equal(ownerIdentity(store).name, "");
    assert.equal(adoptAccountName(store, "  "), false);
    assert.equal(adoptAccountName(store, "Ana Acme"), true);
    assert.equal(ownerIdentity(store).name, "Ana Acme");
    saveOwnerIdentity(store, { name: "Ani" });
    assert.equal(adoptAccountName(store, "Ana Acme"), false);
    assert.equal(ownerIdentity(store).name, "Ani");
  } finally {
    db.close();
    await dir.remove();
  }
});
