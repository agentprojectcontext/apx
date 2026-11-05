import assert from "node:assert/strict";
import test from "node:test";
import { readZip } from "../core/src/skills/zip.ts";
import { extensionBundle } from "./bundle.ts";
import { writeZip } from "./zip.ts";

test("the store upload is the unpacked bundle without the pinned key, as a readable zip", () => {
  const unpacked = extensionBundle();
  const store = extensionBundle(7440, { store: true });
  const manifest = JSON.parse(store["manifest.json"]);
  assert.equal(manifest.key, undefined);
  const { key: _key, ...rest } = JSON.parse(unpacked["manifest.json"]);
  assert.deepEqual(manifest, rest);

  const zip = writeZip(store);
  const { files, skipped } = readZip(zip, { entries: 100, bytes: 10_000_000 });
  assert.deepEqual(skipped, []);
  assert.deepEqual(files.map((file) => file.path).sort(), Object.keys(store).sort());
  for (const file of files) assert.deepEqual(file.data, Buffer.from(store[file.path] ?? ""));
  assert.deepEqual(writeZip(store), zip, "the same bundle zips to the same bytes");
});
