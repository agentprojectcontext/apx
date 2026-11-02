// The storage screen's core: the home by area from a bounded walk that never follows a link, clearing only what APX
// makes again by itself, and the low-disk check that tells the panel only when the state flips.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { testConfig } from "./config.ts";
import { createCore } from "./server.ts";
import { areaOf, clearable, clearStorage, createStorage, isLow, LOW_DISK_BYTES, measureStorage } from "./storage.ts";
import { removeDir, type TempDir, tempDir, waitFor } from "./testkit/platform.ts";

const KB = 1024;
const DAY = 86_400_000;
const NOW = Date.parse("2026-06-01T12:00:00Z");
const LIMITS = { maxEntries: 10_000, deadlineMs: 60_000, now: () => NOW };

let dir: TempDir;
before(() => {
  dir = tempDir("apx-storage-");
});
after(async () => {
  await dir.remove();
});

let n = 0;
/** A fresh home under the test's folder. */
function home(): string {
  const h = path.join(dir.path, `home-${++n}`);
  fs.mkdirSync(h, { recursive: true });
  return h;
}

function write(h: string, rel: string, bytes: number, ageDays = 0): string {
  const p = path.join(h, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  const at = (NOW - ageDays * DAY) / 1000;
  fs.utimesSync(p, at, at);
  return p;
}

test("areas by path: caches inside the media folder, databases at the top, the rest by folder", () => {
  assert.equal(areaOf("apx.db"), "data");
  assert.equal(areaOf("apx.db-wal"), "data");
  assert.equal(areaOf("media/2026-01-01/a.jpg"), "data");
  assert.equal(areaOf("media/posters/m1.jpg"), "caches");
  assert.equal(areaOf("media/open/m1/doc.md"), "caches");
  assert.equal(areaOf("codex-images/x.png"), "caches");
  assert.equal(areaOf("computer/lima/disk"), "computers");
  assert.equal(areaOf("jobs/job_1.log"), "logs");
  assert.equal(areaOf("projects/acme/notes.md"), "projects");
  assert.equal(areaOf("backups/apx-before.db"), "backups");
  assert.equal(areaOf("channels/whatsapp/creds.json"), "other");
  assert.equal(areaOf("projects/old.db"), "projects", "a database inside a folder is that folder's");
});

test("what clearing may remove: posters, old copies, rotated and old logs, old command output; never the live log", () => {
  const age = (days: number) => NOW - days * DAY;
  assert.equal(clearable("media/posters/m1.jpg", age(0), NOW), true);
  assert.equal(clearable("media/open/m1/doc.md", age(0), NOW), false, "a copy just opened may still be open");
  assert.equal(clearable("media/open/m1/doc.md", age(2), NOW), true);
  assert.equal(clearable("logs/core.log", age(400), NOW), false);
  assert.equal(clearable("logs/core.log.1", age(0), NOW), true);
  assert.equal(clearable("logs/whisper.log", age(3), NOW), false);
  assert.equal(clearable("logs/whisper.log", age(15), NOW), true);
  assert.equal(clearable("jobs/job_1.log", age(10), NOW), false);
  assert.equal(clearable("jobs/job_1.log", age(31), NOW), true);
  for (const kept of [
    "apx.db",
    "media/2026-01-01/a.jpg",
    "media/uploads/2026-01-01/b.pdf",
    "projects/acme/AGENTS.md",
    "secrets.json",
    "backups/apx-before.db",
    "computer/lima/disk",
    "logs/sub/old.log",
    "jobs/sub/job.log",
  ])
    assert.equal(clearable(kept, age(1000), NOW), false, kept);
});

test("the measure sums each area, says what clearing frees, and lists the biggest first", async () => {
  const h = home();
  write(h, "apx.db", 64 * KB);
  write(h, "media/2026-01-01/a.jpg", 32 * KB, 90);
  write(h, "media/posters/m1.jpg", 8 * KB);
  write(h, "logs/core.log", 4 * KB, 90);
  write(h, "logs/core.log.1", 16 * KB);
  write(h, "jobs/job_old.log", 8 * KB, 40);
  write(h, "jobs/job_new.log", 8 * KB, 1);
  write(h, "computer/disk.img", 128 * KB);
  const m = await measureStorage(h, LIMITS);
  const by = Object.fromEntries(m.areas.map((a) => [a.id, a]));
  assert.equal(m.partial, undefined);
  assert.ok((by.data?.bytes ?? 0) >= 96 * KB, "the database and chat files");
  assert.equal(by.data?.freeable_bytes, 0);
  assert.ok((by.caches?.bytes ?? 0) >= 8 * KB);
  assert.equal(by.caches?.freeable_bytes, by.caches?.bytes);
  assert.ok((by.logs?.freeable_bytes ?? 0) >= 24 * KB, "the rotated log and the old command output");
  assert.ok((by.logs?.freeable_bytes ?? 0) < (by.logs?.bytes ?? 0), "not the live log nor recent output");
  assert.equal(m.freeable_bytes, (by.caches?.freeable_bytes ?? 0) + (by.logs?.freeable_bytes ?? 0));
  assert.equal(
    m.total_bytes,
    m.areas.reduce((s, a) => s + a.bytes, 0),
  );
  assert.deepEqual(
    m.areas.map((a) => a.bytes),
    [...m.areas.map((a) => a.bytes)].sort((a, b) => b - a),
  );
});

test("the walk stops at its entry cap and at its deadline, and says it is partial", async () => {
  const h = home();
  for (let i = 0; i < 30; i++) write(h, `jobs/job_${i}.log`, KB);
  const capped = await measureStorage(h, { ...LIMITS, maxEntries: 10 });
  assert.equal(capped.partial, true);
  assert.ok(capped.total_bytes < 30 * KB, "it stopped before reading every file");
  // The clock passes the deadline after the first folder is read.
  let reads = 0;
  const late = await measureStorage(h, { maxEntries: 10_000, deadlineMs: 60_000, now: () => NOW + reads++ * 60_000 });
  assert.equal(late.partial, true);
  assert.equal((await measureStorage(h, LIMITS)).partial, undefined, "within both, the whole home");
});

test("links are never followed: what one points to is neither counted nor cleared", async (t) => {
  const outside = path.join(dir.path, "outside");
  const target = write(outside, "big.bin", 256 * KB);
  const old = write(outside, "posters/x.jpg", 4 * KB, 90);
  const h = home();
  try {
    fs.symlinkSync(outside, path.join(h, "work"), "dir");
    fs.mkdirSync(path.join(h, "media"), { recursive: true });
    fs.symlinkSync(path.join(outside, "posters"), path.join(h, "media", "posters"), "dir");
  } catch (err) {
    // Windows without the right to make links: nothing to follow.
    t.diagnostic(`no links here: ${String(err)}`);
    return;
  }
  write(h, "apx.db", 4 * KB);
  const m = await measureStorage(h, LIMITS);
  assert.ok(m.total_bytes < 64 * KB, `only the home's own files: ${m.total_bytes}`);
  assert.equal(m.freeable_bytes, 0);
  const r = await clearStorage(h, LIMITS);
  assert.equal(r.files, 0);
  assert.ok(fs.existsSync(target) && fs.existsSync(old), "the link's targets stay");
});

test("clearing removes only what APX rebuilds, never chats, memory, secrets, projects or backups", async () => {
  const h = home();
  const kept = [
    write(h, "apx.db", 8 * KB, 400),
    write(h, "apx.db-wal", 8 * KB, 400),
    write(h, "media/2026-01-01/a.jpg", 8 * KB, 400),
    write(h, "media/uploads/2026-01-01/b.pdf", 8 * KB, 400),
    write(h, "media/sent/2026-01-01/c.ogg", 8 * KB, 400),
    write(h, "artifacts/global/x/memory.json", 8 * KB, 400),
    write(h, "projects/acme/.apc/memory.md", 8 * KB, 400),
    write(h, "skills/notes/SKILL.md", 8 * KB, 400),
    write(h, "secrets.json", KB, 400),
    write(h, "backups/apx-before.db", 8 * KB, 400),
    write(h, "computer/lima/disk", 8 * KB, 400),
    write(h, "browser/shared/Default/Cookies", 8 * KB, 400),
    write(h, "models/ggml-base.bin", 8 * KB, 400),
    write(h, "logs/core.log", 8 * KB, 400),
    write(h, "logs/whisper.log", 8 * KB, 2),
    write(h, "jobs/job_new.log", 8 * KB, 2),
    write(h, "media/open/m2/fresh.md", 8 * KB, 0),
  ];
  const gone = [
    write(h, "media/posters/m1.jpg", 8 * KB),
    write(h, "media/open/m1/doc.md", 8 * KB, 3),
    write(h, "codex-images/old.png", 8 * KB, 3),
    write(h, "logs/core.log.1", 8 * KB),
    write(h, "logs/whisper-old.log", 8 * KB, 20),
    write(h, "jobs/job_old.log", 8 * KB, 40),
  ];
  const before = await measureStorage(h, LIMITS);
  const r = await clearStorage(h, LIMITS);
  assert.equal(r.files, gone.length);
  assert.equal(r.freed_bytes, before.freeable_bytes, "it frees what the screen said it would");
  for (const p of kept) assert.ok(fs.existsSync(p), `kept: ${path.relative(h, p)}`);
  for (const p of gone) assert.ok(!fs.existsSync(p), `cleared: ${path.relative(h, p)}`);
  assert.ok(!fs.existsSync(path.join(h, "media", "open", "m1")), "an emptied copy folder goes");
  assert.ok(fs.existsSync(path.join(h, "media", "posters")), "the cache folder itself stays");
  assert.equal((await measureStorage(h, LIMITS)).freeable_bytes, 0);
});

test("low disk: under the threshold; the check tells the panel only when the state flips", async () => {
  assert.equal(isLow(LOW_DISK_BYTES - 1), true);
  assert.equal(isLow(LOW_DISK_BYTES), false);
  let free = 50 * LOW_DISK_BYTES;
  let told = 0;
  const s = createStorage({
    home: home(),
    disk: async () => ({ free, total: 100 * LOW_DISK_BYTES }),
    onChange: () => told++,
  });
  const at = new Date(NOW);
  await s.check.run(at);
  assert.equal(told, 0, "room to spare at start says nothing");
  free = LOW_DISK_BYTES / 2;
  await s.check.run(at);
  assert.equal(told, 1);
  assert.deepEqual(await s.disk(), {
    free_bytes: free,
    total_bytes: 100 * LOW_DISK_BYTES,
    low: true,
    threshold_bytes: LOW_DISK_BYTES,
  });
  await s.check.run(at);
  assert.equal(told, 1, "still low: not told again");
  free = 2 * LOW_DISK_BYTES;
  await s.check.run(at);
  assert.equal(told, 2, "room again");
  // A core that starts on a full disk says so on its first look.
  const full = createStorage({ home: home(), disk: async () => ({ free: 1, total: 2 }), onChange: () => told++ });
  await full.check.run(at);
  assert.equal(told, 3);
});

test("through the protocol: the home by area, the disk's state, and clearing", async () => {
  const h = home();
  const core = await createCore(testConfig({ home: h }), {
    quiet: true,
    storageDisk: async () => ({ free: KB, total: 100 * LOW_DISK_BYTES }),
  });
  try {
    const owner = new ApxClient({ url: core.url });
    write(h, "media/posters/m1.jpg", 16 * KB);
    assert.equal((await owner.call("storage.status", {})).low, true);
    assert.equal((await owner.call("storage.usage", { refresh: true })).measuring, true);
    const u = await waitFor(async () => {
      const r = await owner.call("storage.usage", {});
      return !r.measuring && r.areas.some((a) => a.id === "caches") ? r : undefined;
    }, "the home measured with its posters");
    assert.ok(u.freeable_bytes >= 16 * KB);
    assert.equal(u.disk?.low, true);
    const r = await owner.call("storage.clear", {});
    assert.ok(r.freed_bytes >= 16 * KB);
    assert.ok(!fs.existsSync(path.join(h, "media", "posters", "m1.jpg")));
    assert.ok(fs.existsSync(path.join(h, "apx.db")), "the core's database stays");
  } finally {
    await core.close();
    await removeDir(path.join(h));
  }
});
