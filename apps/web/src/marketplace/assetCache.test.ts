import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssetCache } from "./assetCache.ts";

test("catalog and installed views share the same successful avatar without requesting the package icon", async () => {
  const calls: string[] = [];
  const load = createAssetCache(async (id, file) => {
    calls.push(`${id}/${file}`);
    return "avatar";
  });
  assert.deepEqual(
    await Promise.all([load("acme", "@icon", "v1", "icon.svg"), load("acme", "@icon", "v1", "icon.svg")]),
    ["avatar", "avatar"],
  );
  assert.deepEqual(calls, ["acme/@icon"]);
  await load("acme", "@icon", "v2", "icon.svg");
  assert.equal(calls.length, 2);
});

test("a failed avatar falls back to the package and is not retained as a permanent failure", async () => {
  let available = false;
  const load = createAssetCache(async (_id, file) => {
    if (file !== "@icon") return "package";
    if (!available) throw new Error("unavailable");
    return "avatar";
  });
  assert.equal(await load("acme", "@icon", "v1", "icon.svg"), "package");
  available = true;
  assert.equal(await load("acme", "@icon", "v1", "icon.svg"), "avatar");
});

test("a missing avatar with no package icon remains absent and the image cache is bounded", async () => {
  let calls = 0;
  const load = createAssetCache(async (_id, file) => {
    calls++;
    return file === "missing" ? undefined : "image";
  }, 1);
  assert.equal(await load("acme", "missing", "v1"), undefined);
  await load("acme", "first", "v1");
  await load("acme", "second", "v1");
  await load("acme", "first", "v1");
  assert.equal(calls, 4);
});
