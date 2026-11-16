import assert from "node:assert/strict";
import { test } from "node:test";
import { createSkillFileReader } from "./file-info.ts";

const document = (body = "Body", description = "A description.") =>
  `---\nname: example\ndescription: ${description}\n---\n${body}`;
const initial = { dev: 1n, ino: 1n, size: 100n, mtimeNs: 1n, ctimeNs: 1n };

test("unchanged skill metadata is reused without rereading its body, including linked aliases", () => {
  let reads = 0;
  let stats = 0;
  const read = createSkillFileReader({
    read: () => {
      reads++;
      return document("A long body".repeat(1000));
    },
    stat: () => {
      stats++;
      return initial;
    },
  });
  const first = read("skill");
  for (let i = 0; i < 60; i++) assert.equal(read("linked-alias"), first);
  assert.equal(reads, 1);
  assert.equal(stats, 62);
  assert.deepEqual(Object.keys(first).sort(), ["description", "hash", "name"]);
  assert.equal(first.description, "A description.");
  assert.equal(first.name, "example");
  assert.equal(Object.isFrozen(first), true);
});

test("every identity or change-stamp field invalidates the cached metadata", () => {
  for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) {
    let stamp = { ...initial };
    let text = document();
    let reads = 0;
    const read = createSkillFileReader({
      stat: () => stamp,
      read: () => {
        reads++;
        return text;
      },
    });
    const first = read("skill");
    stamp = { ...stamp, [field]: 2n };
    text = document("New body", "New description.");
    const next = read("skill");
    assert.equal(reads, 2, field);
    assert.equal(next.description, "New description.", field);
    assert.notEqual(next.hash, first.hash, field);
  }
});

test("same-name copies compare full contents rather than only frontmatter", () => {
  const read = createSkillFileReader({
    stat: (file) => ({ ...initial, ino: file === "first" ? 1n : file === "copy" ? 2n : 3n }),
    read: (file) => document(file === "different" ? "Changed body" : "Original body"),
  });
  assert.equal(read("first").hash, read("copy").hash);
  assert.notEqual(read("first").hash, read("different").hash);
});

test("a file changed during the read is not cached", () => {
  let stamp = { ...initial };
  let reads = 0;
  const read = createSkillFileReader({
    stat: () => stamp,
    read: () => {
      reads++;
      stamp = { ...stamp, mtimeNs: stamp.mtimeNs + 1n };
      return document();
    },
  });
  read("skill");
  read("skill");
  assert.equal(reads, 2);
});

test("failed stat and read operations are not hidden by an earlier cache hit", () => {
  let failStat = false;
  let failRead = false;
  let stamp = { ...initial };
  const read = createSkillFileReader({
    stat: () => {
      if (failStat) throw new Error("missing");
      return stamp;
    },
    read: () => {
      if (failRead) throw new Error("denied");
      return document();
    },
  });
  read("skill");
  failStat = true;
  assert.throws(() => read("skill"), /missing/);
  failStat = false;
  failRead = true;
  stamp = { ...stamp, ctimeNs: 2n };
  assert.throws(() => read("skill"), /denied/);
  failRead = false;
  assert.equal(read("skill").name, "example");
});

test("least recently used entries are evicted at the entry bound", () => {
  const reads: string[] = [];
  const read = createSkillFileReader({
    maxEntries: 2,
    stat: (file) => ({ ...initial, ino: BigInt(file) }),
    read: (file) => {
      reads.push(file);
      return document();
    },
  });
  for (const file of ["1", "2", "1", "3", "1", "2"]) read(file);
  assert.deepEqual(reads, ["1", "2", "3", "2"]);
});

test("the byte bound evicts old entries and refuses oversized metadata", () => {
  const reads: string[] = [];
  const read = createSkillFileReader({
    maxBytes: 650,
    stat: (file) => ({ ...initial, ino: BigInt(file) }),
    read: (file) => {
      reads.push(file);
      return document("Body", file === "3" ? "x".repeat(1000) : "A description.");
    },
  });
  for (const file of ["1", "2", "2", "1", "3", "3"]) read(file);
  assert.deepEqual(reads, ["1", "2", "1", "3", "3"]);
});

test("missing filesystem identity and explicitly disabled caches always reread", () => {
  for (const options of [{ maxEntries: 0 }, { maxBytes: 0 }, { stat: () => ({ ...initial, ino: 0n }) }]) {
    let reads = 0;
    const read = createSkillFileReader({
      stat: () => initial,
      ...options,
      read: () => {
        reads++;
        return document();
      },
    });
    read("skill");
    read("skill");
    assert.equal(reads, 2);
  }
});
